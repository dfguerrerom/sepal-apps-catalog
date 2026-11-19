// .github/workflows/scripts/prune-retired.js
// Usage (CLI): node prune-retired.js
//
// Removes retired apps from apps.test.json and apps.prod.json once SEPAL has
// stopped listing them, and drops their ids from dev-apps.txt so the dev
// projection keeps resolving. Prints a markdown list of what it removed;
// prints nothing and writes nothing when no app has expired.
//
// The CLI takes no path arguments, so it can only write those three files.
// dev-fixtures.json is never touched. Paths and `now` are parameters of the
// exported function so the tests can run against fixtures.

import {readFileSync, writeFileSync} from 'node:fs'
import {basename} from 'node:path'

const TEST_FILE = 'apps.test.json'
const PROD_FILE = 'apps.prod.json'
const LIST_FILE = 'dev-apps.txt'

// Must match SEPAL's GUI (modules/gui/src/appAvailability.js in sepal-private):
// a retired app stays listed until 00:00 UTC, 60 days after retiredOn, and a
// date that is not a real calendar day means the app is not retired at all.
const RETIRED_LISTING_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000
const CATALOG_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function removalTime(retiredOn) {
    const match = typeof retiredOn === 'string' && CATALOG_DATE.exec(retiredOn)
    if (!match) {
        return null
    }
    const [year, month, day] = match.slice(1).map(Number)
    const time = Date.UTC(year, month - 1, day)
    return new Date(time).getUTCDate() === day ? time + RETIRED_LISTING_DAYS * DAY_MS : null
}

const isExpired = (retiredOn, now) => {
    const removal = removalTime(retiredOn)
    return removal !== null && now.getTime() >= removal
}

const report = (app, parent, retiredOn) => {
    const removal = removalTime(retiredOn)
    return {
        id: app.id,
        parent: parent?.id ?? null,
        retiredOn: retiredOn ?? null,
        removedOn: removal === null ? null : new Date(removal).toISOString().slice(0, 10)
    }
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

export function pruneCatalog(catalog, now) {
    const apps = []
    const removed = []
    for (const app of catalog.apps) {
        if (!Array.isArray(app.apps) || app.apps.length === 0) {
            if (isExpired(app.retiredOn, now)) {
                removed.push(report(app, null, app.retiredOn))
            } else {
                apps.push(app)
            }
            continue
        }
        // A child with its own retiredOn follows only that date, as in SEPAL.
        const childDate = child => (child.retiredOn !== undefined ? child.retiredOn : app.retiredOn)
        const children = app.apps.filter(child => !isExpired(childDate(child), now))
        if (children.length === 0) {
            // An empty multiapp lists nothing, so the parent goes with its last child.
            removed.push(report(app, null, app.retiredOn))
        } else if (children.length === app.apps.length) {
            apps.push(app)
        } else {
            for (const child of app.apps.filter(child => !children.includes(child))) {
                removed.push(report(child, app, childDate(child)))
            }
            apps.push({...app, apps: children})
        }
    }
    if (removed.length === 0) {
        return {catalog, removed, droppedTags: []}
    }
    const used = collectTagValues(apps)
    const droppedTags = (catalog.tags ?? []).filter(tag => !used.has(tag.value)).map(tag => tag.value)
    const pruned = {...catalog, apps}
    if (catalog.tags) {
        pruned.tags = catalog.tags.filter(tag => used.has(tag.value))
    }
    return {catalog: pruned, removed, droppedTags}
}

const listedId = line => line.replace(/#.*$/, '').trim()

export function pruneList(text, ids) {
    const lines = text.split('\n')
    const kept = lines.filter(line => !ids.includes(listedId(line)))
    const removed = lines.map(listedId).filter(id => ids.includes(id))
    return {text: kept.join('\n'), removed}
}

function describe(file, {id, parent, retiredOn, removedOn}) {
    const name = parent ? `\`${parent}\` › \`${id}\`` : `\`${id}\``
    const dates = removedOn ? `retired ${retiredOn}, unlisted since ${removedOn}` : 'none of its apps is listed any more'
    return `- \`${file}\`: removed ${name} (${dates})`
}

export function pruneRetired({testFile = TEST_FILE, prodFile = PROD_FILE, listFile = LIST_FILE, now = new Date()} = {}) {
    const lines = []
    let removedFromTest = []
    for (const file of [testFile, prodFile]) {
        const {catalog, removed, droppedTags} = pruneCatalog(JSON.parse(readFileSync(file, 'utf8')), now)
        if (removed.length === 0) {
            continue
        }
        writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n')
        lines.push(...removed.map(entry => describe(basename(file), entry)))
        lines.push(...droppedTags.map(tag => `- \`${basename(file)}\`: dropped tag \`${tag}\`, no app carries it any more`))
        if (file === testFile) {
            removedFromTest = removed.filter(entry => entry.parent === null).map(entry => entry.id)
        }
    }
    // Only test removals matter here: apps.dev.json is projected from test.
    const list = pruneList(readFileSync(listFile, 'utf8'), removedFromTest)
    if (list.removed.length > 0) {
        writeFileSync(listFile, list.text)
        lines.push(...list.removed.map(id => `- \`${basename(listFile)}\`: removed \`${id}\``))
    }
    return {changed: lines.length > 0, summary: lines.join('\n')}
}

// CLI entry point: only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const {changed, summary} = pruneRetired()
        if (changed) {
            console.log(summary)
        } else {
            console.error('prune-retired: no retired app has reached its removal date')
        }
    } catch (e) {
        console.error(`prune-retired: ${e.message}`)
        process.exit(1)
    }
}
