import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const WATCHED_APPS = ['se.plan', 'sepal_mgci', 'sepal-gee-bundle'];
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const CATALOG_REPO = 'dfguerrerom/sepal-apps-catalog';
const PROMOTE_URL = `https://github.com/${CATALOG_REPO}/actions/workflows/promote-app.yml`;

export function matureRelease(releases, now) {
  return releases
    .filter((release) => !release.draft && !release.prerelease && release.published_at)
    .filter((release) => new Date(release.published_at).getTime() <= now.getTime() - GRACE_MS)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0] ?? null;
}

function marker(appId) {
  return `<!-- release-lag:${appId} -->`;
}

export function planIssue(existing, lag) {
  if (!lag) {
    if (existing?.state !== 'open') return { action: 'none' };
    const plan = { action: 'close', number: existing.number };
    if (Array.isArray(existing.labels)) {
      plan.labels = existing.labels.map((label) => label.name).filter((name) => name !== 'release-hold');
    }
    return plan;
  }
  const { appId, release, releaseSha, prodSha } = lag;
  const title = `Production release overdue: ${appId} ${release.tag_name}`;
  const body = `${marker(appId)}
**${appId} ${release.tag_name}** was published more than three days ago and is not in the production catalog.

- Release: ${release.html_url}
- Release commit: \`${releaseSha}\`
- Production commit: \`${prodSha}\`
- Promote: [open the promotion workflow](${PROMOTE_URL}) and select \`${appId}\`.

This issue closes when the production pin contains the release. Add the \`release-hold\` label to pause WhatsApp reminders for an intentional delay.
`;
  if (!existing) return { action: 'create', title, body };
  if (existing.state === 'open' && existing.title === title && existing.body === body) {
    return { action: 'none' };
  }
  return { action: 'update', number: existing.number, title, body, state: 'open' };
}

function sourceName(repository) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repository);
  if (!match) throw new Error(`Unsupported source repository: ${repository}`);
  return match[1];
}

async function github(path, { method = 'GET', body, missingOk = false } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'sepal-release-lag',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404 && missingOk) return null;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`GitHub ${method} ${path}: ${response.status} ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function ensureLabel(name, color, description) {
  const path = `/repos/${CATALOG_REPO}/labels/${encodeURIComponent(name)}`;
  if (await github(path, { missingOk: true })) return;
  await github(`/repos/${CATALOG_REPO}/labels`, {
    method: 'POST',
    body: { name, color, description },
  });
}

async function allIssues() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/repos/${CATALOG_REPO}/issues?state=all&labels=release-lag&per_page=100&page=${page}`,
    );
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) return issues;
  }
}

export async function lagFor(app, now, api = github) {
  const source = sourceName(app.repository);
  const releases = await api(`/repos/${source}/releases?per_page=100`);
  const release = matureRelease(releases, now);
  if (!release) return null;
  const comparison = await api(
    `/repos/${source}/compare/${app.commit}...${encodeURIComponent(release.tag_name)}`,
  );
  if (comparison.status === 'behind' || comparison.status === 'identical') return null;
  if (!['ahead', 'diverged'].includes(comparison.status) || comparison.ahead_by < 1) {
    throw new Error(`Unexpected comparison for ${app.id}: ${comparison.status}`);
  }
  const commit = await api(`/repos/${source}/commits/tags/${encodeURIComponent(release.tag_name)}`);
  return {
    appId: app.id,
    release,
    releaseSha: commit.sha,
    prodSha: app.commit,
  };
}

export async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
  if (process.env.GITHUB_REPOSITORY !== CATALOG_REPO) {
    throw new Error(`Expected GITHUB_REPOSITORY=${CATALOG_REPO}`);
  }
  const catalog = JSON.parse(await readFile('apps.prod.json', 'utf8'));
  const apps = new Map(catalog.apps.map((app) => [app.id, app]));
  await ensureLabel('release-lag', 'D93F0B', 'Published release overdue in production');
  await ensureLabel('release-hold', 'BFD4F2', 'Intentional production release delay');
  const issues = await allIssues();
  for (const appId of WATCHED_APPS) {
    const app = apps.get(appId);
    if (!app) throw new Error(`Watched app missing from apps.prod.json: ${appId}`);
    const existing = issues.find((issue) => issue.body?.includes(marker(appId)));
    const plan = planIssue(existing, await lagFor(app, new Date()));
    if (plan.action === 'create') {
      await github(`/repos/${CATALOG_REPO}/issues`, {
        method: 'POST',
        body: { title: plan.title, body: plan.body, labels: ['release-lag'] },
      });
    } else if (plan.action === 'update' || plan.action === 'close') {
      const body = plan.action === 'close'
        ? { state: 'closed', state_reason: 'completed', ...(plan.labels ? { labels: plan.labels } : {}) }
        : { title: plan.title, body: plan.body, state: 'open' };
      await github(`/repos/${CATALOG_REPO}/issues/${plan.number}`, { method: 'PATCH', body });
    }
    console.log(`${appId}: ${plan.action}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
