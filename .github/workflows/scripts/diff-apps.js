// .github/workflows/scripts/diff-apps.js
// Usage: node diff-apps.js <oldFile> <newFile>
// Emits JSON to stdout: {added: [...], removed: [...], updated: [{label, repository, branch, oldCommit, newCommit}, ...]}

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

const key = a => `${a.repository}@@${a.label}`
const oldByKey = new Map(oldApps.map(a => [key(a), a]))
const newByKey = new Map(newApps.map(a => [key(a), a]))

const added = []
const removed = []
const updated = []

for (const [k, a] of newByKey) {
    if (!oldByKey.has(k)) {
        added.push(a)
    } else {
        const prev = oldByKey.get(k)
        if (prev.commit !== a.commit || prev.branch !== a.branch) {
            updated.push({
                label: a.label,
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
