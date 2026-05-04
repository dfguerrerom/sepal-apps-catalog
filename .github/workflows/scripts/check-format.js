// .github/workflows/scripts/check-format.js
// Usage: node check-format.js <file> [<file>...]
//
// Verifies each JSON file is byte-identical to the canonical
// `JSON.stringify(parsed, null, 2) + "\n"` form. This keeps editor-specific
// formatters (prettier, vscode auto-format) from causing diff churn.

import {readFileSync} from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
    console.error('Usage: node check-format.js <file> [<file>...]')
    process.exit(2)
}

let bad = 0
for (const file of files) {
    const actual = readFileSync(file, 'utf8')
    const canonical = JSON.stringify(JSON.parse(actual), null, 2) + '\n'
    if (actual === canonical) {
        console.log(`${file}: canonical`)
    } else {
        bad++
        console.error(`${file}: NOT canonical`)
        console.error(`  Run: node -e 'const fs=require("fs");fs.writeFileSync("${file}",JSON.stringify(JSON.parse(fs.readFileSync("${file}","utf8")),null,2)+"\\n")'`)
    }
}
process.exit(bad ? 1 : 0)
