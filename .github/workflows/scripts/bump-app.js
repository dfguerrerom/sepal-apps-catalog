// .github/workflows/scripts/bump-app.js
// Usage (CLI): APP_ID=foo EXPECTED_REPOSITORY=https://github.com/x/foo \
//              NEW_COMMIT=<40-hex> CATALOG_FILE=apps.test.json \
//              node bump-app.js
//
// Library: export {bumpApp}. Mutates one app's `commit` field in a catalog file,
// preserving canonical formatting (2-space indent + trailing newline).

import {readFileSync, writeFileSync} from 'node:fs'

export function bumpApp({appId, expectedRepository, newCommit, file}) {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const app = data.apps.find(a => a.id === appId)
    app.commit = newCommit
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
    return {changed: true}
}
