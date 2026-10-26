import assert from 'node:assert/strict';
import test from 'node:test';

import { lagFor, matureRelease, planIssue } from './release-lag.js';

const now = new Date('2026-10-26T12:00:00Z');
const oldRelease = {
  tag_name: '1.2.4',
  published_at: '2026-10-20T10:00:00Z',
  draft: false,
  prerelease: false,
};

test('a fresh release does not hide an older overdue release', () => {
  const fresh = { ...oldRelease, tag_name: '1.2.5', published_at: '2026-10-25T10:00:00Z' };
  assert.equal(matureRelease([fresh, oldRelease], now).tag_name, '1.2.4');
});

test('pre-releases do not create production reminders', () => {
  assert.equal(matureRelease([{ ...oldRelease, prerelease: true }], now), null);
});

test('a release becomes overdue at exactly two days', () => {
  const atThreshold = { ...oldRelease, published_at: '2026-10-24T12:00:00Z' };
  const beforeThreshold = { ...oldRelease, published_at: '2026-10-24T12:00:01Z' };
  assert.equal(matureRelease([atThreshold], now), atThreshold);
  assert.equal(matureRelease([beforeThreshold], now), null);
});

test('creates one issue for a missing production release', () => {
  const lag = { appId: 'sepal_mgci', release: oldRelease, releaseSha: 'b'.repeat(40), prodSha: 'a'.repeat(40) };
  const planned = planIssue(null, lag);
  assert.equal(planned.action, 'create');
  assert.match(planned.body, /release-lag:sepal_mgci/);
  assert.match(planned.body, /1\.2\.4/);
});

test('an unchanged issue is left alone', () => {
  const lag = { appId: 'sepal_mgci', release: oldRelease, releaseSha: 'b'.repeat(40), prodSha: 'a'.repeat(40) };
  const created = planIssue(null, lag);
  assert.deepEqual(planIssue({ state: 'open', title: created.title, body: created.body }, lag), { action: 'none' });
});

test('resolved production lag closes its issue', () => {
  assert.deepEqual(planIssue({ state: 'open', number: 42 }, null), { action: 'close', number: 42 });
});

test('closing a resolved issue clears its hold before a future release', () => {
  const issue = { state: 'open', number: 42, labels: [{ name: 'release-lag' }, { name: 'release-hold' }] };
  assert.deepEqual(planIssue(issue, null), { action: 'close', number: 42, labels: ['release-lag'] });
});

test('a later release updates the same issue', () => {
  const first = { appId: 'sepal_mgci', release: oldRelease, releaseSha: 'b'.repeat(40), prodSha: 'a'.repeat(40) };
  const issue = { ...planIssue(null, first), state: 'open', number: 42 };
  const later = { ...first, release: { ...oldRelease, tag_name: '1.2.5' }, releaseSha: 'c'.repeat(40) };
  const planned = planIssue(issue, later);
  assert.equal(planned.action, 'update');
  assert.equal(planned.number, 42);
  assert.match(planned.title, /1\.2\.5/);
});

test('resolves the release SHA from the commit endpoint', async () => {
  const app = { id: 'sepal_mgci', repository: 'https://github.com/sepal-contrib/sepal_mgci', commit: 'a'.repeat(40) };
  const replies = new Map([
    ['/repos/sepal-contrib/sepal_mgci/releases?per_page=100', [{ ...oldRelease, html_url: 'https://github.com/sepal-contrib/sepal_mgci/releases/tag/1.2.4' }]],
    [`/repos/sepal-contrib/sepal_mgci/compare/${'a'.repeat(40)}...1.2.4`, { status: 'ahead', ahead_by: 1, commits: [{ sha: 'b'.repeat(40) }] }],
    ['/repos/sepal-contrib/sepal_mgci/commits/tags/1.2.4', { sha: 'b'.repeat(40) }],
  ]);
  const result = await lagFor(app, now, async (path) => replies.get(path));
  assert.equal(result.releaseSha, 'b'.repeat(40));
});
