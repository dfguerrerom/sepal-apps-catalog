// .github/workflows/scripts/diff-apps.js
// Usage: node diff-apps.js <oldFile> <newFile>
// Emits JSON to stdout: {added: [...], removed: [...], updated: [{label, endpoint, repository, branch, oldCommit, newCommit}, ...]}
//
// Scope: docker entries, and jupyter entries pinned on either side, are tracked for "updated"
// (SHA bumps need upstream review). Other added/removed entries are still surfaced; their
// metadata edits are not.

import {readFileSync} from 'node:fs'

const [oldPath, newPath] = process.argv.slice(2)

const load = path => {
    try {
        return JSON.parse(readFileSync(path, 'utf8')).apps || []
    } catch {
        return []
    }
}

const oldApps = load(oldPath)
const newApps = load(newPath)

const key = a => a.id
const oldByKey = new Map(oldApps.map(a => [key(a), a]))
const newByKey = new Map(newApps.map(a => [key(a), a]))

const isPinnable = (a, prev) =>
    a.endpoint === 'docker' || (a.endpoint === 'jupyter' && Boolean(a.commit || prev.commit))

const added = []
const removed = []
const updated = []

for (const [k, a] of newByKey) {
    if (!oldByKey.has(k)) {
        added.push(a)
    } else if (isPinnable(a, oldByKey.get(k))) {
        const prev = oldByKey.get(k)
        if (prev.commit !== a.commit || prev.branch !== a.branch) {
            updated.push({
                label: a.label,
                endpoint: a.endpoint,
                repository: a.repository,
                branch: a.branch,
                oldBranch: prev.branch,
                oldCommit: prev.commit,
                newCommit: a.commit
            })
        }
    }
}

for (const [k, a] of oldByKey) {
    if (!newByKey.has(k)) removed.push(a)
}

process.stdout.write(JSON.stringify({added, removed, updated}, null, 2))
