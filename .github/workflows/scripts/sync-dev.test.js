import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {syncDev, parseList, project} from './sync-dev.js'

const TEST_CATALOG = {
    apps: [
        {id: 'rstudio', label: 'RStudio', endpoint: 'rstudio', single: true, tags: ['TOOLS']},
        {
            id: 'foo',
            label: 'Foo',
            endpoint: 'docker',
            tags: ['RESTORATION'],
            repository: 'https://github.com/x/foo',
            branch: 'main',
            commit: 'a'.repeat(40)
        },
        {
            id: 'bundle',
            label: 'Bundle',
            tags: [],
            apps: [{id: 'child', label: 'Child', endpoint: 'jupyter', tags: ['NESTED']}]
        },
        {id: 'unlisted', label: 'Unlisted', endpoint: 'jupyter', tags: ['OTHER']}
    ],
    tags: [
        {value: 'TOOLS', label: {en: 'Tools'}},
        {value: 'NESTED', label: {en: 'Nested'}},
        {value: 'RESTORATION', label: {en: 'Restoration'}},
        {value: 'OTHER', label: {en: 'Other'}}
    ]
}
const SCRIPT_FILE = fileURLToPath(new URL('./sync-dev.js', import.meta.url))

function mkWorkspace({list = 'rstudio\nfoo\n', catalog = TEST_CATALOG, dev = null} = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'sync-dev-test-'))
    const listFile = join(dir, 'dev-apps.txt')
    const testFile = join(dir, 'apps.test.json')
    const devFile = join(dir, 'apps.dev.json')
    writeFileSync(listFile, list)
    writeFileSync(testFile, JSON.stringify(catalog, null, 2) + '\n')
    if (dev !== null) {
        writeFileSync(devFile, dev)
    }
    return {dir, listFile, testFile, devFile, cleanup: () => rmSync(dir, {recursive: true, force: true})}
}

function runCli(ws, ...args) {
    const env = {...process.env}
    delete env.NODE_TEST_CONTEXT
    return spawnSync(process.execPath, [SCRIPT_FILE, ...args], {cwd: ws.dir, env, encoding: 'utf8'})
}

test('happy path: projects the listed ids in list order', () => {
    const ws = mkWorkspace({list: 'foo\nrstudio\n'})
    try {
        const result = syncDev(ws)
        assert.equal(result.changed, true)
        const data = JSON.parse(readFileSync(ws.devFile, 'utf8'))
        assert.deepEqual(data.apps.map(a => a.id), ['foo', 'rstudio'])
        assert.deepEqual(data.apps[0], TEST_CATALOG.apps[1])
    } finally {
        ws.cleanup()
    }
})

test('an id absent from apps.test.json throws and names it', () => {
    const ws = mkWorkspace({list: 'rstudio\nghost\n'})
    try {
        assert.throws(() => syncDev(ws), /ghost/)
    } finally {
        ws.cleanup()
    }
})

test('a duplicate id throws and names the line', () => {
    const ws = mkWorkspace({list: 'rstudio\nfoo\nrstudio\n'})
    try {
        assert.throws(() => syncDev(ws), /Duplicate app id "rstudio" at dev-apps.txt:3/)
    } finally {
        ws.cleanup()
    }
})

test('an id that violates the schema pattern throws', () => {
    const ws = mkWorkspace({list: 'not a valid id\n'})
    try {
        assert.throws(() => syncDev(ws), /Invalid app id/)
    } finally {
        ws.cleanup()
    }
})

test('comments, blank lines and surrounding whitespace are ignored', () => {
    assert.deepEqual(parseList('# header\n\n  rstudio  \nfoo # trailing\n\n'), ['rstudio', 'foo'])
})

test('tags are filtered to the values actually used, in apps.test.json order', () => {
    const {tags} = project({ids: ['foo', 'rstudio'], test: TEST_CATALOG})
    assert.deepEqual(tags.map(t => t.value), ['TOOLS', 'RESTORATION'])
})

test('a multiapp parent is copied whole and its children tags are counted', () => {
    const {apps, tags} = project({ids: ['bundle'], test: TEST_CATALOG})
    assert.deepEqual(apps[0], TEST_CATALOG.apps[2])
    assert.deepEqual(tags.map(t => t.value), ['NESTED'])
})

test('a tag used but not defined in apps.test.json throws', () => {
    const catalog = structuredClone(TEST_CATALOG)
    catalog.tags = catalog.tags.filter(t => t.value !== 'TOOLS')
    const ws = mkWorkspace({list: 'rstudio\n', catalog})
    try {
        assert.throws(() => syncDev(ws), /Tag "TOOLS"/)
    } finally {
        ws.cleanup()
    }
})

test('output is canonical (2-space indent + trailing newline)', () => {
    const ws = mkWorkspace()
    try {
        syncDev(ws)
        const actual = readFileSync(ws.devFile, 'utf8')
        assert.equal(actual, JSON.stringify(JSON.parse(actual), null, 2) + '\n')
    } finally {
        ws.cleanup()
    }
})

test('re-running on an in-sync file reports no change', () => {
    const ws = mkWorkspace()
    try {
        assert.equal(syncDev(ws).changed, true)
        assert.equal(syncDev(ws).changed, false)
    } finally {
        ws.cleanup()
    }
})

test('check mode reports drift without writing', () => {
    const ws = mkWorkspace()
    try {
        assert.equal(syncDev({...ws, check: true}).changed, true)
        assert.equal(existsSync(ws.devFile), false)
        syncDev(ws)
        assert.equal(syncDev({...ws, check: true}).changed, false)
    } finally {
        ws.cleanup()
    }
})

test('validate mode checks inputs without reading or writing apps.dev.json', () => {
    const ws = mkWorkspace()
    try {
        mkdirSync(ws.devFile)
        const result = runCli(ws, '--validate')
        assert.equal(result.status, 0, result.stderr)
        assert.equal(statSync(ws.devFile).isDirectory(), true)
    } finally {
        ws.cleanup()
    }
})

test('validate mode rejects invalid inputs without creating apps.dev.json', () => {
    const ws = mkWorkspace({list: 'ghost\n'})
    try {
        const result = runCli(ws, '--validate')
        assert.equal(result.status, 1)
        assert.equal(existsSync(ws.devFile), false)
    } finally {
        ws.cleanup()
    }
})
