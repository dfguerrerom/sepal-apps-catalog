import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {copyFileSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describeApp, validateCatalogs} from './validate.js'

const SCHEMA = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../apps.schema.json', import.meta.url)), 'utf8')
)

const app = (extra = {}) => ({id: 'foo', label: 'Foo', tagline: 'A tagline', description: 'A description', ...extra})
const check = (...apps) => validateCatalogs(SCHEMA, [{file: 'apps.test.json', data: {apps}}])[0]
const report = result => result.errors.join('\n')

test('catalog without translations is valid', () => {
    const {valid} = check(app())
    assert.equal(valid, true)
})

test('catalog with es and fr translations is valid', () => {
    const {valid, errors} = check(
        app({
            translations: {
                es: {tagline: 'Un lema', description: 'Una descripción'},
                fr: {tagline: 'Une accroche'}
            }
        })
    )
    assert.deepEqual(errors, [])
    assert.equal(valid, true)
})

test('uppercase language key is rejected, naming the key and the app', () => {
    const {valid, errors} = check(app({translations: {ES: {tagline: 'Un lema'}}}))
    assert.equal(valid, false)
    assert.match(report({errors}), /invalid property name: ES/)
    assert.match(report({errors}), /id="foo" label="Foo"/)
})

test('an en key is rejected - English belongs at the entry root', () => {
    const {valid, errors} = check(app({translations: {es: {tagline: 'Un lema'}, en: {tagline: 'A tagline'}}}))
    assert.equal(valid, false)
    assert.match(report({errors}), /invalid property name: en/)
})

test('three-letter language key is rejected and the app is identified', () => {
    const {valid, errors} = check(app({translations: {spa: {tagline: 'Un lema'}}}))
    assert.equal(valid, false)
    assert.match(report({errors}), /id="foo" label="Foo"/)
})

test('unknown field inside a language block is rejected', () => {
    const {valid, errors} = check(app({translations: {es: {taglien: 'Un lema'}}}))
    assert.equal(valid, false)
    assert.match(report({errors}), /unexpected property: taglien/)
    assert.match(report({errors}), /id="foo" label="Foo"/)
})

test('empty translated string is rejected', () => {
    const {valid} = check(app({translations: {es: {description: ''}}}))
    assert.equal(valid, false)
})

test('non-string translated value is rejected', () => {
    const {valid} = check(app({translations: {es: {tagline: 42}}}))
    assert.equal(valid, false)
})

test('translations on a multiapp child are valid', () => {
    const {valid, errors} = check(
        app({
            id: 'bundle',
            label: 'Bundle',
            apps: [{id: 'child', label: 'Child', translations: {fr: {tagline: 'Une accroche'}}}]
        })
    )
    assert.deepEqual(errors, [])
    assert.equal(valid, true)
})

test('a bad child translation names both the parent and the child', () => {
    const {valid, errors} = check(
        app({
            id: 'bundle',
            label: 'Bundle',
            apps: [{id: 'child', label: 'Child', translations: {es: {taglien: 'Un lema'}}}]
        })
    )
    assert.equal(valid, false)
    assert.match(report({errors}), /id="bundle"/)
    assert.match(report({errors}), /id="child" label="Child"/)
})

test('describeApp names the app for a translations path', () => {
    const data = {apps: [app({id: 'a'}), app({id: 'b', label: 'Bee'})]}
    assert.equal(describeApp(data, '/apps/1/translations/es'), '[apps[1] id="b" label="Bee"]')
})

test('describeApp names the child for a nested translations path', () => {
    const data = {apps: [{id: 'bundle', label: 'Bundle', apps: [{id: 'kid', label: 'Kid'}]}]}
    assert.equal(
        describeApp(data, '/apps/0/apps/0/translations/es'),
        '[apps[0] id="bundle" label="Bundle" → apps[0] id="kid" label="Kid"]'
    )
})

test('describeApp returns no context for a non-app path', () => {
    assert.equal(describeApp({apps: []}, '/tags/0/value'), '')
})

test('the validator CLI runs when its path contains spaces', () => {
    const scriptsDir = dirname(fileURLToPath(import.meta.url))
    const tempDir = mkdtempSync(join(scriptsDir, 'validate cli '))
    const validatorPath = join(tempDir, 'validate.js')
    try {
        copyFileSync(fileURLToPath(new URL('./validate.js', import.meta.url)), validatorPath)
        const result = spawnSync(process.execPath, [validatorPath], {encoding: 'utf8'})
        assert.equal(
            result.status,
            2,
            `expected missing CLI arguments to exit 2\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
        )
        assert.match(result.stderr, /Usage: node validate\.js/)
    } finally {
        rmSync(tempDir, {recursive: true, force: true})
    }
})

test('the shipped catalogs validate against the shipped schema', () => {
    const root = new URL('../../../', import.meta.url)
    const files = ['apps.test.json', 'apps.prod.json'].map(file => ({
        file,
        data: JSON.parse(readFileSync(fileURLToPath(new URL(file, root)), 'utf8'))
    }))
    for (const result of validateCatalogs(SCHEMA, files)) {
        assert.equal(result.valid, true, `${result.file}:\n${result.errors.join('\n')}`)
    }
})
