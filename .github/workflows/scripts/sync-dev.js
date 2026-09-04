// .github/workflows/scripts/sync-dev.js
// Usage (CLI): node sync-dev.js [--check | --validate]
//
// Library: export {syncDev}. Projects apps.dev.json from dev-apps.txt +
// apps.test.json: every id in the list is replaced by the top-level entry of
// the same id in apps.test.json, verbatim.
//
// The CLI takes no path arguments and reads no path env vars — apps.dev.json
// is the only file it can write, which is what keeps the sync one-directional.
// Paths are parameters of the exported function so the tests can run against
// fixtures.

import {readFileSync, writeFileSync} from 'node:fs'

const LIST_FILE = 'dev-apps.txt'
const TEST_FILE = 'apps.test.json'
const DEV_FILE = 'apps.dev.json'

// Same id pattern the schema enforces, so a typo in the list fails here with a
// useful message rather than as "app not found".
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/

export function parseList(text) {
    const ids = []
    const seen = new Set()
    text.split('\n').forEach((raw, i) => {
        const line = raw.replace(/#.*$/, '').trim()
        if (!line) {
            return
        }
        if (!ID_PATTERN.test(line)) {
            throw new Error(`Invalid app id "${line}" at ${LIST_FILE}:${i + 1}`)
        }
        if (seen.has(line)) {
            throw new Error(`Duplicate app id "${line}" at ${LIST_FILE}:${i + 1}`)
        }
        seen.add(line)
        ids.push(line)
    })
    return ids
}

function collectTagValues(apps, out = new Set()) {
    for (const app of apps) {
        for (const tag of app.tags ?? []) {
            out.add(tag)
        }
        if (Array.isArray(app.apps)) {
            collectTagValues(app.apps, out)
        }
    }
    return out
}

export function project({ids, test}) {
    const apps = ids.map(id => {
        const entry = test.apps.find(app => app.id === id)
        if (!entry) {
            throw new Error(`App id "${id}" is listed in ${LIST_FILE} but absent from ${TEST_FILE}`)
        }
        return structuredClone(entry)
    })
    const used = collectTagValues(apps)
    const defined = new Set((test.tags ?? []).map(tag => tag.value))
    for (const value of used) {
        if (!defined.has(value)) {
            throw new Error(`Tag "${value}" is used by a projected app but not defined in ${TEST_FILE}`)
        }
    }
    const tags = (test.tags ?? []).filter(tag => used.has(tag.value)).map(tag => structuredClone(tag))
    return {apps, tags}
}

export function loadProjection({listFile = LIST_FILE, testFile = TEST_FILE} = {}) {
    const ids = parseList(readFileSync(listFile, 'utf8'))
    const test = JSON.parse(readFileSync(testFile, 'utf8'))
    return project({ids, test})
}

export function syncDev({listFile = LIST_FILE, testFile = TEST_FILE, devFile = DEV_FILE, check = false} = {}) {
    const canonical = JSON.stringify(loadProjection({listFile, testFile}), null, 2) + '\n'
    let current = null
    try {
        current = readFileSync(devFile, 'utf8')
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e
        }
    }
    if (current === canonical) {
        return {changed: false}
    }
    if (!check) {
        writeFileSync(devFile, canonical)
    }
    return {changed: true}
}

// CLI entry point: only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    const check = process.argv.slice(2).includes('--check')
    const validate = process.argv.slice(2).includes('--validate')
    try {
        if (validate) {
            loadProjection()
            console.log(`${LIST_FILE} + ${TEST_FILE} produce a valid dev projection`)
        } else {
            const {changed} = syncDev({check})
            if (!changed) {
                console.log(`${DEV_FILE} is in sync with ${TEST_FILE}`)
            } else if (check) {
                console.error(`${DEV_FILE} does not match the projection of ${LIST_FILE} + ${TEST_FILE}.`)
                console.error(`${DEV_FILE} is generated — regenerate it with:`)
                console.error('  node .github/workflows/scripts/sync-dev.js')
                process.exit(1)
            } else {
                console.log(`regenerated ${DEV_FILE} from ${LIST_FILE} + ${TEST_FILE}`)
            }
        }
    } catch (e) {
        console.error(`sync-dev: ${e.message}`)
        process.exit(1)
    }
}
