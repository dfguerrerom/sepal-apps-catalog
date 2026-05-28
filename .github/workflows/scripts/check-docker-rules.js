// .github/workflows/scripts/check-docker-rules.js
// Usage: node check-docker-rules.js <catalog> [<catalog>...]
//
// Cross-cutting docker-app rules that the JSON Schema cannot express:
//   1. `path` must equal exactly `/api/app-launcher/<id>`.
//   2. `port` must be unique across ALL docker entries in ALL files passed.
// On any collision/missing port, prints the next free port (max+1) as a suggestion.
//
// The schema (apps.schema.json) already enforces that docker apps have `port`
// and a `path` matching `^/api/app-launcher/...$`. This script adds the
// id↔path coupling and global uniqueness that draft-2020-12 schemas can't.

import {readFileSync} from 'node:fs'

export function checkDockerRules(filesWithData) {
    // filesWithData: [{file, data}]
    const errors = []
    const ports = [] // {file, idx, id, port}
    const portMap = new Map() // port -> first occurrence

    for (const {file, data} of filesWithData) {
        const apps = data?.apps ?? []
        apps.forEach((app, idx) => {
            if (app.endpoint !== 'docker') return
            const where = `${file} apps[${idx}] id="${app.id ?? '?'}"`

            // 1. path must equal /api/app-launcher/<id>
            const expectedPath = `/api/app-launcher/${app.id}`
            if (app.path !== expectedPath) {
                errors.push(`${where}: path must equal "${expectedPath}" (got "${app.path ?? ''}")`)
            }

            // 2. collect ports for uniqueness check
            if (typeof app.port === 'number') {
                ports.push({file, idx, id: app.id, port: app.port})
            }
        })
    }

    // Uniqueness — same id appearing in test+prod with the same port is
    // the normal case (apps are promoted); only flag when ids differ.
    for (const entry of ports) {
        const prev = portMap.get(entry.port)
        if (prev && prev.id !== entry.id) {
            const next = Math.max(...ports.map((p) => p.port)) + 1
            errors.push(
                `${entry.file} apps[${entry.idx}] id="${entry.id}": port ${entry.port} already used by ${prev.file} apps[${prev.idx}] id="${prev.id}". Next free port: ${next}`
            )
        } else if (!prev) {
            portMap.set(entry.port, entry)
        }
    }

    return {errors, nextPort: ports.length ? Math.max(...ports.map((p) => p.port)) + 1 : 1}
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const files = process.argv.slice(2)
    if (files.length === 0) {
        console.error('Usage: node check-docker-rules.js <catalog> [<catalog>...]')
        process.exit(2)
    }
    const filesWithData = files.map((file) => ({
        file,
        data: JSON.parse(readFileSync(file, 'utf8'))
    }))
    const {errors, nextPort} = checkDockerRules(filesWithData)
    if (errors.length === 0) {
        console.log(`docker rules: OK (next free port: ${nextPort})`)
        process.exit(0)
    }
    console.error(`docker rules: FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'})`)
    for (const e of errors) console.error(`  • ${e}`)
    console.error(`\nNext free port (for new docker apps): ${nextPort}`)
    process.exit(1)
}
