// .github/workflows/scripts/risk-flags.js
// Usage: node risk-flags.js (reads diff-apps JSON from stdin, writes markdown to stdout)
// Env: GITHUB_TOKEN (must be set; use the workflow's GITHUB_TOKEN)
//      CI_DEADLINE (optional Unix time in seconds; wait until then for upstream workflow runs to finish)

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

const token = process.env.GITHUB_TOKEN
if (!token) {
    console.error('GITHUB_TOKEN is required')
    process.exit(1)
}

const input = JSON.parse(readFileSync(0, 'utf8'))

// Repository and commits come from the PR and are spliced into authenticated API paths, so only
// shapes that cannot climb out of /repos/{owner}/{repo} get through.
const parseRepo = url => {
    const m = url.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
    return m && !/^\.+$/.test(m[2]) ? {owner: m[1], repo: m[2]} : null
}

const SHA = /^[0-9a-f]{40}$/

const api = async path => {
    const res = await fetch(`https://api.github.com/repos/${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
        }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    return res.json()
}

const compare = async (owner, repo, base, head) => {
    if (!SHA.test(base) || !SHA.test(head)) throw new Error('commit is not a full 40-character SHA')
    return api(`${owner}/${repo}/compare/${base}...${head}`)
}

// A release starts the upstream CI only seconds before the auto-bump PR that triggers this job,
// so the runs are polled until CI_DEADLINE instead of being reported as still running.
const CI_DEADLINE = Number(process.env.CI_DEADLINE) || 0
const CI_POLL_MS = 20_000

const latestRuns = async (owner, repo, sha) => {
    const {workflow_runs: runs} = await api(`${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100&exclude_pull_requests=true`)
    const latest = new Map()
    for (const run of runs) {
        // GitHub's own dependency-graph runs say nothing about the release.
        if (run.path?.startsWith('dynamic/dependabot/')) continue
        const prev = latest.get(run.workflow_id)
        if (!prev || run.created_at > prev.created_at) latest.set(run.workflow_id, run)
    }
    return [...latest.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

const upstreamRuns = async (owner, repo, sha) => {
    if (!SHA.test(sha)) throw new Error('commit is not a full 40-character SHA')
    for (;;) {
        const runs = await latestRuns(owner, repo, sha)
        const waitMs = CI_DEADLINE * 1000 - Date.now()
        if (runs.every(r => r.status === 'completed') || waitMs <= 0) return runs
        await new Promise(resolve => setTimeout(resolve, Math.min(CI_POLL_MS, waitMs)))
    }
}

const RUN_ICONS = {
    success: '✅',
    failure: '❌',
    timed_out: '❌',
    startup_failure: '❌',
    skipped: '⚪',
    neutral: '⚪'
}
const runIcon = run => run.status !== 'completed' ? '⏳' : RUN_ICONS[run.conclusion] || '⚠️'

// Workflow names come from the upstream repo; a code span keeps them from rendering as markdown
// or @-mentioning anyone.
const codeSpan = s => `\`${s.replace(/`/g, "'").replace(/\s+/g, ' ').trim()}\``

const upstreamCi = async (owner, repo, sha) => {
    const commit = `[\`${sha.slice(0, 7)}\`](https://github.com/${owner}/${repo}/commit/${sha})`
    let runs
    try {
        runs = await upstreamRuns(owner, repo, sha)
    } catch (e) {
        return `- ⚠️ **Upstream CI** on ${commit}: failed to fetch workflow runs: ${e.message}`
    }
    if (!runs.length) return `- ⚪ **Upstream CI** on ${commit}: no workflow runs`
    const icons = runs.map(runIcon)
    const overall = ['❌', '⏳', '⚠️'].find(i => icons.includes(i)) || '✅'
    const stillRunning = overall === '⏳' ? ' (still running when this comment was written; re-run the Review helper to refresh)' : ''
    const list = runs.map((run, i) => `${icons[i]} [${codeSpan(run.name || run.path)}](${run.html_url})`).join(' · ')
    return `- ${overall} **Upstream CI** on ${commit}${stillRunning}: ${list}`
}

const RISK_PATTERNS = [
    {pattern: /privileged\s*:\s*true/i, label: 'privileged container'},
    {pattern: /network_mode\s*:\s*host/i, label: 'host network mode'},
    {pattern: /cap_add\s*:/i, label: 'added Linux capabilities'},
    {pattern: /\/var\/run\/docker\.sock/i, label: 'docker socket mount'},
    {pattern: /EE_PRIVATE_KEY|SEPAL_ADMIN_PASSWORD|EE_ACCOUNT/, label: 'references SEPAL/GEE secrets'},
    {pattern: /^\s*-\s*\/(?:etc|root|home)\b/m, label: 'sensitive host path mount'}
]

const INFRA_FILES = /^(Dockerfile|docker-compose\.ya?ml|requirements\.txt|package\.json|Pipfile|(?:sepal_)?environment\.ya?ml)$/

const repoLink = (label, url) => url ? `[${label}](${url})` : `\`${label}\``

// GitHub anchors each file in a compare view at #diff-<sha256 of its path>.
const fileDiffLink = (compareUrl, filename) =>
    `[\`${filename}\`](${compareUrl}#diff-${createHash('sha256').update(filename).digest('hex')})`

const FIRST_REVIEW = {
    docker: 'the entire Dockerfile and docker-compose.yml',
    jupyter: '`sepal_environment.yml` / `requirements.txt` (app-manager builds them as root) and the notebooks'
}

const out = []

for (const upd of input.updated) {
    const r = parseRepo(upd.repository)
    if (!r) {
        out.push(`- ⚠️ **${upd.label}**: cannot parse repo URL \`${upd.repository}\``)
        continue
    }
    if (!upd.oldCommit || !upd.newCommit) {
        const missing = !upd.oldCommit && !upd.newCommit ? 'oldCommit and newCommit'
            : !upd.oldCommit ? 'oldCommit'
            : 'newCommit'
        out.push(`### ${upd.label}`)
        out.push(``)
        out.push(`- ⚠️ Missing ${missing} — cannot generate upstream compare. Fix the catalog entry's \`commit\` field.`)
        out.push(``)
        continue
    }
    let cmp
    try {
        cmp = await compare(r.owner, r.repo, upd.oldCommit, upd.newCommit)
    } catch (e) {
        out.push(`- ❌ **${upd.label}**: failed to fetch compare: ${e.message}`)
        continue
    }

    const compareUrl = `https://github.com/${r.owner}/${r.repo}/compare/${upd.oldCommit}...${upd.newCommit}`
    const files = cmp.files || []
    const infraFiles = files.filter(f => INFRA_FILES.test(f.filename.split('/').pop()))

    const flags = []
    for (const f of files) {
        const patch = f.patch || ''
        for (const {pattern, label} of RISK_PATTERNS) {
            if (pattern.test(patch)) {
                flags.push(`${fileDiffLink(compareUrl, f.filename)}: ${label}`)
            }
        }
    }

    out.push(`### ${upd.label}`)
    out.push(``)
    out.push(`- [Compare upstream](${compareUrl})`)
    out.push(`- ${files.length} files changed (${cmp.ahead_by} commits ahead, ${cmp.behind_by} behind)`)
    out.push(await upstreamCi(r.owner, r.repo, upd.newCommit))
    if (infraFiles.length) {
        out.push(`- ⚠️ **Infra/dependency files touched:** ${infraFiles.map(f => fileDiffLink(compareUrl, f.filename)).join(', ')}`)
    }
    if (flags.length) {
        out.push(`- 🚨 **Risk flags:**`)
        for (const f of flags) out.push(`  - ${f}`)
    }
    out.push(``)
}

for (const a of input.added) {
    out.push(`### NEW APP: ${a.label}`)
    const repo = repoLink(a.repository || '(no repository)', a.repository)
    const commitSuffix = a.commit ? ` @ \`${a.commit}\`` : ''
    out.push(`- Repo: ${repo}${commitSuffix}`)
    const r = a.repository && parseRepo(a.repository)
    if (r && a.commit) out.push(await upstreamCi(r.owner, r.repo, a.commit))
    if (a.repository) {
        out.push(`- ⚠️ First-time addition — review ${FIRST_REVIEW[a.endpoint] || 'the repository'} manually.`)
    }
    out.push(``)
}

for (const a of input.removed) {
    out.push(`### REMOVED: ${a.label}`)
    out.push(`- Repo: ${repoLink(a.repository || '(no repository)', a.repository)}`)
    out.push(``)
}

if (!input.updated.length && !input.added.length && !input.removed.length) {
    out.push('_No changes._')
    out.push(``)
}

process.stdout.write(out.join('\n'))
