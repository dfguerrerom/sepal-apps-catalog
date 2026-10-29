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

test('a jupyter app can set cacheVenv', () => {
    const {valid, errors} = check(app({endpoint: 'jupyter', cacheVenv: true}))
    assert.deepEqual(errors, [])
    assert.equal(valid, true)
})

test('cacheVenv must be a real boolean', () => {
    assert.equal(check(app({endpoint: 'jupyter', cacheVenv: 'true'})).valid, false)
})

test('an app that is not jupyter cannot set cacheVenv, naming the field and the app', () => {
    for (const endpoint of [{endpoint: 'shiny'}, {endpoint: 'rstudio'}, {}]) {
        const {valid, errors} = check(app({...endpoint, cacheVenv: true}))
        assert.equal(valid, false, JSON.stringify(endpoint))
        assert.match(report({errors}), /\/apps\/0\/cacheVenv/)
        assert.match(report({errors}), /id="foo" label="Foo"/)
    }
})

test('a multiapp child cannot set cacheVenv', () => {
    const {valid, errors} = check(
        app({endpoint: 'jupyter', id: 'bundle', label: 'Bundle', apps: [{id: 'child', label: 'Child', cacheVenv: true}]})
    )
    assert.equal(valid, false)
    assert.match(report({errors}), /id="child" label="Child"/)
})

test('the legacy skip flag is rejected, naming the field and the app', () => {
    const {valid, errors} = check(app({endpoint: 'jupyter', skip: true}))
    assert.equal(valid, false)
    assert.match(report({errors}), /\/apps\/0\/skip/)
    assert.match(report({errors}), /id="foo" label="Foo"/)
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

test('an app with requirements is valid', () => {
    const {valid, errors} = check(app({endpoint: 'jupyter', requirements: {minCpuCount: 4, minRamGiB: 16, minGpuCount: 1}}))
    assert.deepEqual(errors, [])
    assert.equal(valid, true)
})

test('a misspelt requirement is rejected, naming the field and the app', () => {
    const {valid, errors} = check(app({requirements: {minRamGB: 16}}))
    assert.equal(valid, false)
    assert.match(report({errors}), /unexpected property: minRamGB/)
    assert.match(report({errors}), /id="foo" label="Foo"/)
})

test('fractional CPU or GPU counts and negative requirements are rejected', () => {
    assert.equal(check(app({requirements: {minCpuCount: 1.5}})).valid, false)
    assert.equal(check(app({requirements: {minGpuCount: 0.5}})).valid, false)
    assert.equal(check(app({requirements: {minRamGiB: -1}})).valid, false)
})

test('a fractional memory requirement is valid', () => {
    assert.equal(check(app({requirements: {minRamGiB: 0.5}})).valid, true)
})

test('requirements on a multiapp child are valid', () => {
    const {valid, errors} = check(
        app({
            id: 'bundle',
            label: 'Bundle',
            requirements: {minRamGiB: 8},
            apps: [{id: 'child', label: 'Child', requirements: {minRamGiB: 32}}]
        })
    )
    assert.deepEqual(errors, [])
    assert.equal(valid, true)
})

test('a docker app cannot set requirements', () => {
    const docker = app({
        endpoint: 'docker',
        repository: 'https://github.com/me/foo',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        port: 8769,
        path: '/api/app-launcher/foo'
    })
    assert.equal(check(docker).valid, true)
    const {valid, errors} = check({...docker, requirements: {minRamGiB: 16}})
    assert.equal(valid, false)
    assert.match(report({errors}), /\/apps\/0\/requirements/)
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
    const files = ['apps.test.json', 'apps.prod.json', 'apps.dev.json'].map(file => ({
        file,
        data: JSON.parse(readFileSync(fileURLToPath(new URL(file, root)), 'utf8'))
    }))
    for (const result of validateCatalogs(SCHEMA, files)) {
        assert.equal(result.valid, true, `${result.file}:\n${result.errors.join('\n')}`)
    }
})
