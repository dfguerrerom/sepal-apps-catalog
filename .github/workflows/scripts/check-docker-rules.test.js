import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkDockerRules} from './check-docker-rules.js'

const docker = (id, port, path) => ({
    id,
    label: id,
    endpoint: 'docker',
    repository: `https://github.com/x/${id}`,
    branch: 'main',
    commit: '0'.repeat(40),
    port,
    path: path ?? `/api/app-launcher/${id}`
})

test('clean catalogs: no errors, suggests max+1', () => {
    const {errors, nextPort} = checkDockerRules([
        {file: 'test.json', data: {apps: [docker('a', 8765), docker('b', 8766)]}},
        {file: 'prod.json', data: {apps: [docker('a', 8765)]}}
    ])
    assert.deepEqual(errors, [])
    assert.equal(nextPort, 8767)
})

test('detects duplicate port within a single file', () => {
    const {errors} = checkDockerRules([
        {file: 'test.json', data: {apps: [docker('a', 8765), docker('b', 8765)]}}
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /port 8765 already used/)
    assert.match(errors[0], /Next free port: 8766/)
})

test('detects duplicate port across files', () => {
    const {errors} = checkDockerRules([
        {file: 'test.json', data: {apps: [docker('a', 8765)]}},
        {file: 'prod.json', data: {apps: [docker('b', 8765)]}}
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /port 8765 already used/)
})

test('same id across test+prod with same port is NOT a collision', () => {
    // app present in both catalogs is the normal case (promotion)
    const {errors} = checkDockerRules([
        {file: 'test.json', data: {apps: [docker('a', 8765)]}},
        {file: 'prod.json', data: {apps: [docker('a', 8765)]}}
    ])
    // NOTE: current impl flags this — we need to dedupe by id
    // This test documents the expected (post-fix) behavior.
    assert.deepEqual(errors, [])
})

test('rejects path that does not match /api/app-launcher/<id>', () => {
    const {errors} = checkDockerRules([
        {file: 'test.json', data: {apps: [docker('a', 8765, '/api/app-launcher/wrong')]}}
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /path must equal "\/api\/app-launcher\/a"/)
})

test('ignores non-docker apps', () => {
    const {errors} = checkDockerRules([
        {
            file: 'test.json',
            data: {
                apps: [
                    {id: 'r', label: 'R', endpoint: 'rstudio', path: '/sandbox/rstudio/'},
                    docker('a', 8765)
                ]
            }
        }
    ])
    assert.deepEqual(errors, [])
})
