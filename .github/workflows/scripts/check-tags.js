// .github/workflows/scripts/check-tags.js
// Usage: node check-tags.js <catalog> [<catalog>...]
//
// Keeps the root `tags` vocabulary and the tags apps actually carry in step,
// in both directions:
//
//   1. Every tag an app uses must be declared. The GUI builds its tag filter
//      from the root list (modules/gui/src/apps.js), so an undeclared tag has
//      no label to filter by, and sync-dev.js throws outright when it projects
//      an app carrying one.
//   2. Every declared tag must be used by at least one app, so the filter bar
//      never offers a tag that matches nothing.
//
// Nested apps count: a multiapp parent's children carry their own tags, and
// those are as real as any other.
//
// A tag whose only users are hidden apps is reported but NOT an error. Hiding
// is how an app gets its environment built without appearing in the app grid,
// so the entry is legitimately there and the tag matters again the moment it
// is unhidden. Failing on it would churn the vocabulary every time an app is
// hidden or restored.

import {readFileSync} from 'node:fs'

function collect(apps, hiddenParent = false, out = new Map(), parent = '') {
    for (const app of apps) {
        const hidden = hiddenParent || Boolean(app.hidden)
        const id = parent + (app.id ?? '?')
        for (const tag of app.tags ?? []) {
            if (!out.has(tag)) {
                out.set(tag, {all: [], visible: []})
            }
            out.get(tag).all.push(id)
            if (!hidden) {
                out.get(tag).visible.push(id)
            }
        }
        if (Array.isArray(app.apps)) {
            collect(app.apps, hidden, out, `${id}/`)
        }
    }
    return out
}

export function checkTags(filesWithData) {
    const errors = []
    const notes = []

    for (const {file, data} of filesWithData) {
        const declared = (data?.tags ?? []).map(tag => tag.value)
        const declaredSet = new Set(declared)
        const used = collect(data?.apps ?? [])

        for (const [tag, {all}] of used) {
            if (!declaredSet.has(tag)) {
                errors.push(
                    `${file}: tag "${tag}" is used by ${all.join(', ')} but not declared in the root "tags" list`
                )
            }
        }

        for (const tag of declared) {
            const entry = used.get(tag)
            if (!entry) {
                errors.push(`${file}: tag "${tag}" is declared but no app uses it`)
            } else if (entry.visible.length === 0) {
                notes.push(
                    `${file}: tag "${tag}" is only used by hidden apps (${entry.all.join(', ')}), so the filter matches nothing`
                )
            }
        }

        const seen = new Set()
        for (const tag of declared) {
            if (seen.has(tag)) {
                errors.push(`${file}: tag "${tag}" is declared more than once`)
            }
            seen.add(tag)
        }
    }

    return {errors, notes}
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const files = process.argv.slice(2)
    if (files.length === 0) {
        console.error('Usage: node check-tags.js <catalog> [<catalog>...]')
        process.exit(2)
    }
    const filesWithData = files.map(file => ({
        file,
        data: JSON.parse(readFileSync(file, 'utf8'))
    }))
    const {errors, notes} = checkTags(filesWithData)
    for (const n of notes) console.log(`  note: ${n}`)
    if (errors.length === 0) {
        console.log('tags: OK')
        process.exit(0)
    }
    console.error(`tags: FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'})`)
    for (const e of errors) console.error(`  • ${e}`)
    process.exit(1)
}
