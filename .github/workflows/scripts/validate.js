// .github/workflows/scripts/validate.js
// Usage: node validate.js <schemaPath> <dataPath> [<dataPath>...]
//
// Validates each data file against the JSON Schema and prints human-friendly
// errors that identify the offending app by index, id, and label. Uses
// ajv@8 with draft 2020-12 support directly to avoid the deprecated
// transitive deps (inflight, glob@7) bundled with ajv-cli@5.

import {readFileSync} from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'

export const describeApp = (data, instancePath) => {
    const m = instancePath.match(/^\/apps\/(\d+)(?:\/apps\/(\d+))?/)
    if (!m) return ''
    const idx = +m[1]
    const app = data.apps?.[idx]
    if (!app) return `[apps[${idx}] — not found in data]`
    const name = (entry, i) => `apps[${i}] id="${entry.id ?? '?'}" label="${entry.label ?? '?'}"`
    if (m[2] === undefined) return `[${name(app, idx)}]`
    const childIdx = +m[2]
    const child = app.apps?.[childIdx]
    if (!child) return `[${name(app, idx)} → apps[${childIdx}] — not found in data]`
    return `[${name(app, idx)} → ${name(child, childIdx)}]`
}

const formatError = (data, err) => {
    const where = err.instancePath || '(root)'
    const ctx = describeApp(data, err.instancePath)
    const lines = [`  • ${ctx ? `${where}  ${ctx}` : where}`, `      ${err.message}`]
    const p = err.params ?? {}
    if (p.missingProperty) lines.push(`      missing property: ${p.missingProperty}`)
    if (p.additionalProperty) lines.push(`      unexpected property: ${p.additionalProperty}`)
    if (p.propertyName) lines.push(`      invalid property name: ${p.propertyName}`)
    if (p.allowedValues) lines.push(`      allowed values: ${JSON.stringify(p.allowedValues)}`)
    if (p.pattern) lines.push(`      pattern: ${p.pattern}`)
    if (p.type) lines.push(`      expected type: ${p.type}`)
    return lines.join('\n')
}

export const validateCatalogs = (schema, filesWithData) => {
    const ajv = new Ajv2020({strict: false, allErrors: true})
    const validate = ajv.compile(schema)
    return filesWithData.map(({file, data}) => {
        const valid = validate(data)
        return {
            file,
            valid,
            errors: valid ? [] : (validate.errors ?? []).map((err) => formatError(data, err))
        }
    })
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const [schemaPath, ...dataPaths] = process.argv.slice(2)
    if (!schemaPath || dataPaths.length === 0) {
        console.error('Usage: node validate.js <schemaPath> <dataPath> [<dataPath>...]')
        process.exit(2)
    }
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const filesWithData = dataPaths.map((file) => ({
        file,
        data: JSON.parse(readFileSync(file, 'utf8'))
    }))
    let hadErrors = false
    for (const {file, valid, errors} of validateCatalogs(schema, filesWithData)) {
        if (valid) {
            console.log(`${file}: valid`)
            continue
        }
        hadErrors = true
        console.error(`\n${file}: INVALID (${errors.length} error${errors.length === 1 ? '' : 's'})`)
        for (const e of errors) console.error(e)
    }
    process.exit(hadErrors ? 1 : 0)
}
