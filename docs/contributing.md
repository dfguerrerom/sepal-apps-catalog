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

Optional per-language `tagline` / `description` overrides go in a `translations` block — see [Translations](#translations) below.

### Docker app rules (enforced by CI)

- **`port`** is mandatory and must be unique across `apps.test.json` and `apps.prod.json`. New apps take the next free port — `max(existing_ports) + 1`. To find it locally, run `node .github/workflows/scripts/check-docker-rules.js apps.test.json apps.prod.json` — it prints `Next free port: N`.
- **`path`** is mandatory and must equal exactly `/api/app-launcher/<id>` (same `<id>` as the entry's `id` field). The schema enforces the prefix; `check-docker-rules.js` enforces the id↔path coupling.

2. The `Validate catalog` and `Review helper` workflows will run automatically. The bot will post a compare link comment. (See [ci.md](./ci.md) for what each check does.)
3. A SEPAL maintainer will review and merge. Once merged, the app appears on test.sepal.io within minutes.
4. Once you're happy with how it behaves on test.sepal.io, promote to prod — see [Promoting to production](#promoting-to-production) below.

## Updating an existing app

Open a PR changing the `commit` field (and optionally `branch`) of the entry in `apps.test.json`. The bot will post a compare link showing exactly what changed upstream. Once reviewed and merged, the change is live on test.sepal.io. Promote to prod with one of the methods below.

## Translations

`tagline` and `description` can carry per-language overrides in an optional `translations` block, keyed by 2-letter language code. This is what lets SEPAL show an app in the language the user selected.

```json
{
  "id": "my-app",
  "label": "My App",
  "tagline": "Short one-liner",
  "description": "Longer **markdown** text",
  "translations": {
    "es": {
      "tagline": "Frase corta",
      "description": "Texto **markdown** más largo"
    },
    "fr": {
      "tagline": "Phrase courte"
    }
  }
}
```

- **English stays where it is.** The flat `tagline` / `description` fields remain the source of truth; `translations` only overrides them. An `en` key is **rejected by validation**, so an entry can never grow a second, diverging English text.
- **Partial translations are fine.** Any field you leave out falls back to the English one — the `fr` block above translates the tagline and inherits the English description.
- **Markdown must survive.** If the English `description` contains Markdown, the translation has to carry the same markup.
- **Multiapp children** carry their own `translations`, overriding the child's own English `tagline` / `description`. Children do **not** inherit those two fields from their parent the way they inherit `author`, `projectLink` or the logo — SEPAL falls back to the child's `label` for a missing `tagline` and to an empty string for a missing `description`. So a child that needs translating must carry its own block.
- **`label` is not translatable.** SEPAL's app-manager and app-launcher pass it through as a plain string. The block can grow to cover it later without breaking existing catalogs.
- Language codes must be lowercase two-letter codes other than `en` (`es`, not `ES`, `spa` or `en`), and `tagline` / `description` are the only fields allowed inside a language block. Anything else fails validation, with the offending app named in the error.

SEPAL's language selector currently offers `en`, `es` and `fr`, so those are the languages worth filling in. Other codes validate but nothing reads them yet.

Translations are text metadata, so **no automation copies them between catalogs** — `/promote` and the auto-bump workflow only move `commit`. Edit `apps.test.json` and `apps.prod.json` in the same PR so the two stay in sync.

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
