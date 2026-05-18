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

test('app id not found → throws', () => {
    const {file, cleanup} = mkFile()
    try {
        assert.throws(
            () => bumpApp({
                appId: 'nope',
                expectedRepository: 'https://github.com/x/nope',
                newCommit: 'a'.repeat(40),
                file
            }),
            /App not found: nope/
        )
    } finally {
        cleanup()
    }
})

test('endpoint is not docker → throws', () => {
    const {file, cleanup} = mkFile()
    try {
        assert.throws(
            () => bumpApp({
                appId: 'bar',
                expectedRepository: 'https://github.com/x/bar',
                newCommit: 'a'.repeat(40),
                file
            }),
            /endpoint is rstudio, not docker/
        )
    } finally {
        cleanup()
    }
})

test('repository mismatch → throws', () => {
    const {file, cleanup} = mkFile()
    try {
        assert.throws(
            () => bumpApp({
                appId: 'foo',
                expectedRepository: 'https://github.com/x/different',
                newCommit: 'a'.repeat(40),
                file
            }),
            /Repository mismatch for foo/
        )
    } finally {
        cleanup()
    }
})

test('invalid SHA → throws', () => {
    const {file, cleanup} = mkFile()
    try {
        assert.throws(
            () => bumpApp({
                appId: 'foo',
                expectedRepository: 'https://github.com/x/foo',
                newCommit: 'nothex',
                file
            }),
            /Invalid SHA/
        )
    } finally {
        cleanup()
    }
})

test('already at target SHA → returns changed=false and does not rewrite file', () => {
    const {file, cleanup} = mkFile()
    try {
        const sha = 'a'.repeat(40)
        bumpApp({appId: 'foo', expectedRepository: 'https://github.com/x/foo', newCommit: sha, file})
        const before = readFileSync(file, 'utf8')
        const result = bumpApp({appId: 'foo', expectedRepository: 'https://github.com/x/foo', newCommit: sha, file})
        assert.equal(result.changed, false)
        const after = readFileSync(file, 'utf8')
        assert.equal(before, after, 'file content unchanged')
    } finally {
        cleanup()
    }
})
