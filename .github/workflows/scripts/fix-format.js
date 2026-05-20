// .github/workflows/scripts/fix-format.js
// Usage: node fix-format.js <file> [<file>...]
//
// Rewrites each JSON file in canonical
// `JSON.stringify(parsed, null, 2) + "\n"` form, matching check-format.js.
// Exits non-zero (and reports the files) when any file needed changes, so
// it can be used as a pre-commit auto-fixer that re-stages on second run.

import {readFileSync, writeFileSync} from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
    console.error('Usage: node fix-format.js <file> [<file>...]')
    process.exit(2)
}

let changed = 0
for (const file of files) {
    const actual = readFileSync(file, 'utf8')
    const canonical = JSON.stringify(JSON.parse(actual), null, 2) + '\n'
    if (actual === canonical) {
        console.log(`${file}: canonical`)
    } else {
        writeFileSync(file, canonical)
        changed++
        console.error(`${file}: reformatted`)
    }
}
process.exit(changed ? 1 : 0)
