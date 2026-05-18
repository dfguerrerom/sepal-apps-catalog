import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {bumpApp} from './bump-app.js'

const FIXTURE = {
    apps: [
        {
            id: 'foo',
            label: 'Foo',
            endpoint: 'docker',
            repository: 'https://github.com/x/foo',
            branch: 'main',
            commit: '0000000000000000000000000000000000000000'
        },
        {
            id: 'bar',
            label: 'Bar',
            endpoint: 'rstudio',
            single: true,
            path: '/sandbox/rstudio/'
        }
    ]
}

function mkFile() {
    const dir = mkdtempSync(join(tmpdir(), 'bump-app-test-'))
    const file = join(dir, 'apps.test.json')
    writeFileSync(file, JSON.stringify(FIXTURE, null, 2) + '\n')
    return {file, cleanup: () => rmSync(dir, {recursive: true, force: true})}
}

test('happy path: updates commit for the matching docker app', () => {
    const {file, cleanup} = mkFile()
    try {
        const result = bumpApp({
            appId: 'foo',
            expectedRepository: 'https://github.com/x/foo',
            newCommit: 'a'.repeat(40),
            file
        })
        assert.equal(result.changed, true)
        const data = JSON.parse(readFileSync(file, 'utf8'))
        assert.equal(data.apps[0].commit, 'a'.repeat(40))
        assert.equal(data.apps[1].endpoint, 'rstudio', 'unrelated entry untouched')
    } finally {
        cleanup()
    }
})
