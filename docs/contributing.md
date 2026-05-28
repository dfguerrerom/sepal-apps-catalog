# Contributing to the SEPAL Apps Catalog

This catalog determines exactly which version of each app SEPAL will build and run. SEPAL does **not** auto-pull from the tip of any branch — every deployed commit is reviewed and pinned here.

## Adding a new app

1. Open a PR adding an entry to `apps.test.json` with the format below. `commit` must be a full 40-character SHA.

```json
{
  "id": "my-app",
  "endpoint": "docker",
  "label": "My App",
  "repository": "https://github.com/me/my-sepal-app",
  "branch": "main",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "port": 8769,
  "path": "/api/app-launcher/my-app",
  "description": "Optional short description",
  "tags": ["change-detection"]
}
```

### Docker app rules (enforced by CI)

- **`port`** is mandatory and must be unique across `apps.test.json` and `apps.prod.json`. New apps take the next free port — `max(existing_ports) + 1`. To find it locally, run `node .github/workflows/scripts/check-docker-rules.js apps.test.json apps.prod.json` — it prints `Next free port: N`.
- **`path`** is mandatory and must equal exactly `/api/app-launcher/<id>` (same `<id>` as the entry's `id` field). The schema enforces the prefix; `check-docker-rules.js` enforces the id↔path coupling.

2. The `Validate catalog` and `Review helper` workflows will run automatically. The bot will post a compare link comment. (See [ci.md](./ci.md) for what each check does.)
3. A SEPAL maintainer will review and merge. Once merged, the app appears on test.sepal.io within minutes.
4. Once you're happy with how it behaves on test.sepal.io, promote to prod — see [Promoting to production](#promoting-to-production) below.

## Updating an existing app

Open a PR changing the `commit` field (and optionally `branch`) of the entry in `apps.test.json`. The bot will post a compare link showing exactly what changed upstream. Once reviewed and merged, the change is live on test.sepal.io. Promote to prod with one of the methods below.

## Promoting to production

Two options — pick whichever fits:

- **Self-service `/promote` comment (recommended).** This repo has a single pinned issue titled "Promotion requests — comment `/promote <app-id>` here" (labeled `promote-request`). Find it in the [Issues tab](../../../issues?q=is%3Aissue+is%3Aopen+label%3Apromote-request) — there is only ever one. Comment `/promote <your-app-id>` on it. The `Promote app on /promote comment` workflow verifies you own the app's source repo (User-type owner) or are a **public** member of its organization, then copies the pinned `commit` from `apps.test.json` to `apps.prod.json` and opens the PR. A maintainer still merges. If your org membership is private, make it public at `https://github.com/orgs/<org>/people` or use the manual-PR path below. See issue #40 and [ci.md](./ci.md#self-service-promotion-one-time-maintainer-setup).
- **Manual PR.** Open a PR copying the `commit` field of your entry from `apps.test.json` to `apps.prod.json`. Same CI runs; a maintainer merges.

## File formatting

`apps.test.json`, `apps.prod.json`, and `apps.schema.json` use canonical Node `JSON.stringify(..., null, 2)` formatting (2-space indent, one-element arrays expanded across multiple lines, trailing newline). This avoids diff churn from editors with their own formatting opinions.

A `.prettierignore` keeps Prettier (and VSCode "format on save" via Prettier) off these files. CI runs `node .github/workflows/scripts/check-format.js` and rejects PRs whose files don't match the canonical form. To re-canonicalize a file before pushing:

```bash
node -e 'const fs=require("fs"); for (const f of ["apps.test.json","apps.prod.json"]) fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f,"utf8")),null,2)+"\n")'
```

## Why this exists

Until 2026, SEPAL auto-pulled the tip of each app's branch. A compromised contributor GitHub account could ship arbitrary code to SEPAL with no review. This catalog ensures every deployed commit was explicitly approved by a SEPAL maintainer.
