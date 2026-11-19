import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {writeFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {pruneCatalog, pruneList, pruneRetired} from './prune-retired.js'

const SCRIPT_FILE = fileURLToPath(new URL('./prune-retired.js', import.meta.url))

// Retired on 2026-01-01, SEPAL lists the app until 2026-03-02T00:00Z.
const LAST_LISTED = new Date('2026-03-01T23:59:59Z')
const UNLISTED = new Date('2026-03-02T00:00:00Z')

const ids = apps => apps.map(app => app.id)

const BUNDLE = {
    id: 'bundle',
    label: 'Bundle',
    retiredOn: '2026-01-01',
    apps: [
        {id: 'a', label: 'A'},
        {id: 'b', label: 'B'}
    ]
}

test('an app is removed exactly when SEPAL stops listing it, 60 days after retiredOn', () => {
    const catalog = {apps: [{id: 'old', label: 'Old', retiredOn: '2026-01-01'}]}
    assert.deepEqual(ids(pruneCatalog(catalog, LAST_LISTED).catalog.apps), ['old'])
    assert.deepEqual(ids(pruneCatalog(catalog, UNLISTED).catalog.apps), [])
})

test('apps without a real calendar retiredOn are kept, since SEPAL never retires them', () => {
    const catalog = {
        apps: [
            {id: 'live', label: 'Live'},
            {id: 'typo', label: 'Typo', retiredOn: '2026-02-30'}
        ]
    }
    assert.deepEqual(ids(pruneCatalog(catalog, new Date('2030-01-01T00:00:00Z')).catalog.apps), ['live', 'typo'])
})

test('a removed app is reported with its retirement and removal days', () => {
    const {removed} = pruneCatalog({apps: [{id: 'old', label: 'Old', retiredOn: '2026-01-01'}]}, UNLISTED)
    assert.deepEqual(removed, [{id: 'old', parent: null, retiredOn: '2026-01-01', removedOn: '2026-03-02'}])
})

test('a multiapp whose children all inherit an expired retirement is removed whole', () => {
    const {catalog, removed} = pruneCatalog({apps: [BUNDLE]}, UNLISTED)
    assert.deepEqual(catalog.apps, [])
    assert.deepEqual(ids(removed), ['bundle'])
})

test('a child with its own later retiredOn outlives the parent date and keeps the parent', () => {
    const bundle = {...BUNDLE, apps: [{id: 'a', label: 'A'}, {id: 'b', label: 'B', retiredOn: '2026-02-01'}]}
    const {catalog, removed} = pruneCatalog({apps: [bundle]}, UNLISTED)
    assert.deepEqual(ids(catalog.apps), ['bundle'])
    assert.deepEqual(ids(catalog.apps[0].apps), ['b'])
    assert.deepEqual(removed, [{id: 'a', parent: 'bundle', retiredOn: '2026-01-01', removedOn: '2026-03-02'}])
})

test('a child retired on its own date leaves a live parent and its siblings in place', () => {
    const bundle = {id: 'bundle', label: 'Bundle', apps: [{id: 'a', label: 'A', retiredOn: '2026-01-01'}, {id: 'b', label: 'B'}]}
    const {catalog} = pruneCatalog({apps: [bundle]}, UNLISTED)
    assert.deepEqual(ids(catalog.apps[0].apps), ['b'])
})

test('tags left without any app are dropped and tags still in use stay', () => {
    const catalog = {
        apps: [
            {id: 'old', label: 'Old', retiredOn: '2026-01-01', tags: ['GONE', 'SHARED']},
            {id: 'live', label: 'Live', tags: ['SHARED']}
        ],
        tags: [{value: 'GONE'}, {value: 'SHARED'}]
    }
    const result = pruneCatalog(catalog, UNLISTED)
    assert.deepEqual(result.catalog.tags, [{value: 'SHARED'}])
    assert.deepEqual(result.droppedTags, ['GONE'])
})

test('a tag still carried by a multiapp child is kept', () => {
    const catalog = {
        apps: [
            {id: 'old', label: 'Old', retiredOn: '2026-01-01', tags: ['NESTED']},
            {id: 'bundle', label: 'Bundle', apps: [{id: 'a', label: 'A', tags: ['NESTED']}]}
        ],
        tags: [{value: 'NESTED'}]
    }
    assert.deepEqual(pruneCatalog(catalog, UNLISTED).catalog.tags, [{value: 'NESTED'}])
})

test('dev-apps.txt loses the lines of removed ids and keeps everything else', () => {
    const text = '# header\n\nrstudio\nold # retired\nse.plan\n'
    assert.deepEqual(pruneList(text, ['old']), {text: '# header\n\nrstudio\nse.plan\n', removed: ['old']})
})

function mkWorkspace({testCatalog, prodCatalog, list, format = data => JSON.stringify(data, null, 2) + '\n'}) {
    const dir = mkdtempSync(join(tmpdir(), 'prune-retired-test-'))
    const testFile = join(dir, 'apps.test.json')
    const prodFile = join(dir, 'apps.prod.json')
    const listFile = join(dir, 'dev-apps.txt')
    writeFileSync(testFile, format(testCatalog))
    writeFileSync(prodFile, format(prodCatalog))
    writeFileSync(listFile, list)
    return {dir, testFile, prodFile, listFile, cleanup: () => rmSync(dir, {recursive: true, force: true})}
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

test('prunes both catalogs and the dev list, writing canonical JSON', () => {
    const ws = mkWorkspace({
        testCatalog: {apps: [{id: 'rstudio', label: 'RStudio'}, {id: 'old', label: 'Old', retiredOn: '2026-01-01'}]},
        prodCatalog: {apps: [{id: 'old', label: 'Old', retiredOn: '2026-01-01'}, {id: 'prod-only', label: 'P', retiredOn: '2026-01-01'}]},
        list: 'rstudio\nold\n'
    })
    try {
        const result = pruneRetired({...ws, now: UNLISTED})
        assert.equal(result.changed, true)
        const testText = readFileSync(ws.testFile, 'utf8')
        assert.equal(testText, '{\n  "apps": [\n    {\n      "id": "rstudio",\n      "label": "RStudio"\n    }\n  ]\n}\n')
        assert.deepEqual(readJson(ws.prodFile).apps, [])
        assert.equal(readFileSync(ws.listFile, 'utf8'), 'rstudio\n')
        assert.match(result.summary, /`old`/)
        assert.match(result.summary, /`prod-only`/)
    } finally {
        ws.cleanup()
    }
})

test('an app removed from prod only stays in dev-apps.txt, since dev projects test', () => {
    const ws = mkWorkspace({
        testCatalog: {apps: [{id: 'keep', label: 'Keep'}]},
        prodCatalog: {apps: [{id: 'keep', label: 'Keep', retiredOn: '2026-01-01'}]},
        list: 'keep\n'
    })
    try {
        pruneRetired({...ws, now: UNLISTED})
        assert.equal(readFileSync(ws.listFile, 'utf8'), 'keep\n')
    } finally {
        ws.cleanup()
    }
})

test('nothing expired leaves every file untouched, even non-canonical ones', () => {
    const catalog = {apps: [{id: 'old', label: 'Old', retiredOn: '2026-01-01'}]}
    const ws = mkWorkspace({testCatalog: catalog, prodCatalog: catalog, list: 'old\n', format: JSON.stringify})
    try {
        const result = pruneRetired({...ws, now: LAST_LISTED})
        assert.equal(result.changed, false)
        assert.equal(readFileSync(ws.testFile, 'utf8'), JSON.stringify(catalog))
        assert.equal(readFileSync(ws.prodFile, 'utf8'), JSON.stringify(catalog))
        assert.equal(readFileSync(ws.listFile, 'utf8'), 'old\n')
    } finally {
        ws.cleanup()
    }
})

test('the CLI prunes the files in the working directory and prints what it removed', () => {
    const ws = mkWorkspace({
        testCatalog: {apps: [{id: 'rstudio', label: 'RStudio'}, {id: 'old', label: 'Old', retiredOn: '2000-01-01'}]},
        prodCatalog: {apps: [{id: 'rstudio', label: 'RStudio'}]},
        list: 'rstudio\nold\n'
    })
    try {
        const env = {...process.env}
        delete env.NODE_TEST_CONTEXT
        const result = spawnSync(process.execPath, [SCRIPT_FILE], {cwd: ws.dir, env, encoding: 'utf8'})
        assert.equal(result.status, 0, result.stderr)
        assert.match(result.stdout, /`old`/)
        assert.deepEqual(ids(readJson(ws.testFile).apps), ['rstudio'])
        assert.equal(readFileSync(ws.listFile, 'utf8'), 'rstudio\n')
    } finally {
        ws.cleanup()
    }
})
