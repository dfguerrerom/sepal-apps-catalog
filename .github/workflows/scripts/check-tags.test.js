import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkTags} from './check-tags.js'

const tag = value => ({value, label: {en: value}})
const app = (id, tags, extra = {}) => ({id, label: id, endpoint: 'jupyter', tags, ...extra})

const catalog = (tags, apps) => [{file: 'x.json', data: {tags, apps}}]

test('declared and used line up: no errors', () => {
    const {errors, notes} = checkTags(catalog([tag('TOOLS')], [app('a', ['TOOLS'])]))
    assert.deepEqual(errors, [])
    assert.deepEqual(notes, [])
})

test('a tag used but not declared is an error', () => {
    // 'a' also uses TOOLS so the declared-but-unused rule stays out of this one.
    const {errors} = checkTags(catalog([tag('TOOLS')], [app('a', ['TOOLS', 'FOREST'])]))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"FOREST" is used by a but not declared/)
})

test('both directions can fail at once', () => {
    const {errors} = checkTags(catalog([tag('TOOLS')], [app('a', ['FOREST'])]))
    assert.equal(errors.length, 2)
})

test('a tag declared but unused is an error', () => {
    const {errors} = checkTags(catalog([tag('TOOLS'), tag('GHOST')], [app('a', ['TOOLS'])]))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"GHOST" is declared but no app uses it/)
})

test('nested children count as users', () => {
    const parent = app('bundle', [], {apps: [app('child', ['FOREST'])]})
    const {errors} = checkTags(catalog([tag('FOREST')], [parent]))
    assert.deepEqual(errors, [])
})

test('a child tag that is undeclared is reported with its full path', () => {
    const parent = app('bundle', [], {apps: [app('child', ['SAR'])]})
    const {errors} = checkTags(catalog([], [parent]))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /bundle\/child/)
})

test('a tag used only by hidden apps is a note, not an error', () => {
    const {errors, notes} = checkTags(
        catalog([tag('DISASTER')], [app('damage', ['DISASTER'], {hidden: true})])
    )
    assert.deepEqual(errors, [])
    assert.equal(notes.length, 1)
    assert.match(notes[0], /only used by hidden apps/)
})

test('a hidden parent hides its children too', () => {
    const parent = app('bundle', [], {hidden: true, apps: [app('child', ['FOREST'])]})
    const {errors, notes} = checkTags(catalog([tag('FOREST')], [parent]))
    assert.deepEqual(errors, [])
    assert.match(notes[0], /only used by hidden apps/)
})

test('one visible user is enough to clear the note', () => {
    const {notes} = checkTags(
        catalog([tag('DISASTER')], [app('a', ['DISASTER'], {hidden: true}), app('b', ['DISASTER'])])
    )
    assert.deepEqual(notes, [])
})

test('a duplicated declaration is an error', () => {
    const {errors} = checkTags(catalog([tag('TOOLS'), tag('TOOLS')], [app('a', ['TOOLS'])]))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /declared more than once/)
})

test('each file is checked independently', () => {
    const {errors} = checkTags([
        {file: 'test.json', data: {tags: [tag('TOOLS')], apps: [app('a', ['TOOLS'])]}},
        {file: 'prod.json', data: {tags: [], apps: [app('a', ['TOOLS'])]}}
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^prod\.json/)
})
