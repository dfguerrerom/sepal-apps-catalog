// .github/workflows/scripts/validate.js
// Usage: node validate.js <schemaPath> <dataPath> [<dataPath>...]
//
// Validates each data file against the JSON Schema and prints human-friendly
// errors that identify the offending app by index, id, and label. Uses
// ajv@8 with draft 2020-12 support directly to avoid the deprecated
// transitive deps (inflight, glob@7) bundled with ajv-cli@5.

import {readFileSync} from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'

const [schemaPath, ...dataPaths] = process.argv.slice(2)
if (!schemaPath || dataPaths.length === 0) {
    console.error('Usage: node validate.js <schemaPath> <dataPath> [<dataPath>...]')
    process.exit(2)
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const ajv = new Ajv2020({strict: false, allErrors: true})
const validate = ajv.compile(schema)

const describeApp = (data, instancePath) => {
    const m = instancePath.match(/^\/apps\/(\d+)/)
    if (!m) return ''
    const idx = +m[1]
    const app = data.apps?.[idx]
    if (!app) return `[apps[${idx}] — not found in data]`
    return `[apps[${idx}] id="${app.id ?? '?'}" label="${app.label ?? '?'}"]`
}

let hadErrors = false
for (const dataPath of dataPaths) {
    const data = JSON.parse(readFileSync(dataPath, 'utf8'))
    if (validate(data)) {
        console.log(`${dataPath}: valid`)
        continue
    }
    hadErrors = true
    const errors = validate.errors ?? []
    console.error(`\n${dataPath}: INVALID (${errors.length} error${errors.length === 1 ? '' : 's'})`)
    for (const err of errors) {
        const where = err.instancePath || '(root)'
        const ctx = describeApp(data, err.instancePath)
        const head = ctx ? `${where}  ${ctx}` : where
        console.error(`  • ${head}`)
        console.error(`      ${err.message}`)
        const p = err.params ?? {}
        if (p.missingProperty) console.error(`      missing property: ${p.missingProperty}`)
        if (p.additionalProperty) console.error(`      unexpected property: ${p.additionalProperty}`)
        if (p.allowedValues) console.error(`      allowed values: ${JSON.stringify(p.allowedValues)}`)
        if (p.pattern) console.error(`      pattern: ${p.pattern}`)
        if (p.type) console.error(`      expected type: ${p.type}`)
    }
}
process.exit(hadErrors ? 1 : 0)
