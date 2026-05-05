// .github/workflows/scripts/risk-flags.js
// Usage: node risk-flags.js (reads diff-apps JSON from stdin, writes markdown to stdout)
// Env: GITHUB_TOKEN (must be set; use the workflow's GITHUB_TOKEN)

import {readFileSync} from 'node:fs'

const token = process.env.GITHUB_TOKEN
if (!token) {
    console.error('GITHUB_TOKEN is required')
    process.exit(1)
}

const input = JSON.parse(readFileSync(0, 'utf8'))

const parseRepo = url => {
    const m = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/)
    return m ? {owner: m[1], repo: m[2]} : null
}

const compare = async (owner, repo, base, head) => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
        }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    return res.json()
}

const RISK_PATTERNS = [
    {pattern: /privileged\s*:\s*true/i, label: 'privileged container'},
    {pattern: /network_mode\s*:\s*host/i, label: 'host network mode'},
    {pattern: /cap_add\s*:/i, label: 'added Linux capabilities'},
    {pattern: /\/var\/run\/docker\.sock/i, label: 'docker socket mount'},
    {pattern: /EE_PRIVATE_KEY|SEPAL_ADMIN_PASSWORD|EE_ACCOUNT/, label: 'references SEPAL/GEE secrets'},
    {pattern: /^\s*-\s*\/(?:etc|root|home)\b/m, label: 'sensitive host path mount'}
]

const INFRA_FILES = /^(Dockerfile|docker-compose\.ya?ml|requirements\.txt|package\.json|Pipfile|environment\.ya?ml)$/

const repoLink = (label, url) => url ? `[${label}](${url})` : `\`${label}\``

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
                flags.push(`\`${f.filename}\`: ${label}`)
            }
        }
    }

    out.push(`### ${upd.label}`)
    out.push(``)
    out.push(`- [Compare upstream](${compareUrl})`)
    out.push(`- ${files.length} files changed (${cmp.ahead_by} commits ahead, ${cmp.behind_by} behind)`)
    if (infraFiles.length) {
        out.push(`- ⚠️ **Infra/dependency files touched:** ${infraFiles.map(f => `\`${f.filename}\``).join(', ')}`)
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
    out.push(`- ⚠️ First-time addition — review the entire Dockerfile and docker-compose.yml manually.`)
    out.push(``)
}

for (const a of input.removed) {
    out.push(`### REMOVED: ${a.label}`)
    out.push(`- Repo: ${repoLink(a.repository || '(no repository)', a.repository)}`)
    out.push(``)
}

process.stdout.write(out.join('\n'))
