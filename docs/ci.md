# CI workflows, checks, and scripts

This repository is guarded by a set of GitHub Actions workflows and Node scripts. This page documents what each one does, when it runs, and how to run the equivalent checks locally.

## Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Validate catalog | `.github/workflows/validate.yml` | PRs and pushes to `main` that touch `apps.*.json`, `apps.schema.json`, or the workflow/scripts | Blocking gate: unit tests, formatting, schema, and commit reachability |
| Review helper | `.github/workflows/review-helper.yml` | PRs that touch `apps.test.json` / `apps.prod.json` / `apps.dev.json` or the scripts | Posts (and updates) a single PR comment with a per-app diff and risk flags |
| Promote app to production | `.github/workflows/promote-app.yml` | Manual (`workflow_dispatch`, pick an app) | Copies an app's pinned SHA from `apps.test.json` into `apps.prod.json` and opens a PR. Requires write access on this repo |
| Promote app on `/promote` comment | `.github/workflows/promote-request.yml` | `issue_comment` (`/promote <app-id>` on an issue labeled `promote-request`) | Self-service variant of the above. Any user can comment; the workflow verifies the commenter owns / is a public org member of the app's source repo, then opens the same PR. A maintainer still merges. See issue #40 |
| Update catalog from source-repo release | `.github/workflows/update-from-release.yml` | `repository_dispatch` (`bump-app`) sent by a source repo on release | Bumps an app's `commit` in `apps.test.json` and opens a PR |
| Sync dev catalog from test | `.github/workflows/sync-dev.yml` | Push to `main` touching `apps.test.json` / `dev-apps.txt`, or manual (`workflow_dispatch`) | Regenerates `apps.dev.json` from `apps.test.json` and opens a PR. One-directional: it can only write `apps.dev.json` |

## Self-service promotion: one-time maintainer setup

The `promote-request.yml` workflow fires only on comments to issues that **already carry the `promote-request` label**. There is no auto-labeling — a maintainer creates the label once and creates one pinned issue that contributors can comment on forever.

Run these once after the workflow lands:

```bash
# 1. Create the label
gh label create promote-request \
  --description "Self-service docker app promotion requests (see docs/ci.md)" \
  --color BFD4F2

# 2. Open the single pinned issue
gh issue create \
  --title "Promotion requests — comment /promote <app-id> here" \
  --label promote-request \
  --body-file - <<'EOF'
This is the single, persistent intake for self-service production promotions.

## How to use

Comment on this issue with:

```
/promote <app-id>
```

(Example: `/promote se.plan`)

The [`promote-request.yml`](../blob/main/.github/workflows/promote-request.yml) workflow will:

1. Look up the app in `apps.test.json` and read the source repository.
2. Verify you are the owner of that repository (User-owned repos) or a **public** member of its GitHub organization (org-owned repos). If your org membership is private, make it public at `https://github.com/orgs/<org>/people` or use the manual-PR path described in [docs/contributing.md](../blob/main/docs/contributing.md).
3. Copy the pinned commit SHA from `apps.test.json` to `apps.prod.json` and open a PR.
4. A SEPAL maintainer reviews and merges the PR. Once merged, the app updates on sepal.io within minutes.

The workflow comments back on this issue with a link to the PR (or with the reason your request was denied).

## What this does *not* do

- It does **not** introduce new code. Only SHAs already merged into `apps.test.json` (and therefore already reviewed by a maintainer) can be promoted.
- It does **not** auto-merge. A maintainer still has to approve the PR via CODEOWNERS.

Do not close this issue — it is the long-lived intake. Open a separate issue for bugs, questions, or anything else.
EOF

# 3. Pin the issue so contributors can find it
# (no gh shortcut — open the issue in the browser and click "Pin issue")
```

Once those three steps are done, the docs link from [contributing.md](./contributing.md) will resolve and contributors can self-serve.

## `Validate catalog` checks

Every step is **blocking** — a failure fails the PR. Steps run in order:

1. **Run script unit tests** — `npm test` (`node --test`) over `.github/workflows/scripts`. See [Tests](#tests).
2. **Check canonical JSON formatting** — `check-format.js` verifies each file is byte-identical to canonical `JSON.stringify(parsed, null, 2) + "\n"`. Prevents diff churn from editor formatters.
3. **Validate schema** — `validate.js` validates `apps.test.json`, `apps.prod.json` and `apps.dev.json` against `apps.schema.json` (ajv, draft 2020-12). For `endpoint: docker` apps the schema requires `port` and `path`, and `path` must match `^/api/app-launcher/[A-Za-z0-9_.-]+$`. Optional `translations` blocks are checked here too: language keys must be lowercase two-letter codes other than `en` (English belongs at the entry root) and may only hold `tagline` and `description` — see [contributing.md](./contributing.md#translations).
4. **Check docker rules** — `check-docker-rules.js` enforces cross-cutting docker rules the schema can't: `path` must equal `/api/app-launcher/<id>` exactly, and every docker `port` must be unique across all catalogs (same id appearing in several is fine; different ids sharing a port is not). On any violation it prints `Next free port: max(existing)+1` so contributors know which port to claim. See issue #41.
5. **Validate the dev projection inputs** — runs `sync-dev.js --validate` on every validation job. Invalid, duplicate or missing ids in `dev-apps.txt`, and tags used without a definition in `apps.test.json`, fail before merge without requiring the asynchronously generated catalog to be current.
6. **Check `apps.dev.json` matches the projection** — on pull requests that modify `apps.dev.json`, runs `sync-dev.js --check` and fails if the file is not exactly what `dev-apps.txt` + `apps.test.json` produce. The check is scoped to PRs that touch the file on purpose: running it unconditionally would fail every `apps.test.json` PR, since the dev projection is only replayed *after* that PR merges. A hand-edit is still caught, because a hand-edit necessarily puts `apps.dev.json` in the diff.
7. **Verify each docker commit is reachable from its declared branch** — for every `endpoint: docker` entry, calls the GitHub compare API (`/repos/{owner}/{repo}/compare/{branch}...{commit}`) and requires `ahead_by == 0`. This guarantees the pinned `commit` is an ancestor of (or equal to) the `branch` tip — exactly what the app-launcher needs, since it does `git fetch origin <branch>` then `git checkout --detach <commit>`. A non-200 means the branch or commit does not exist; `ahead_by > 0` means the commit lives on a different branch.

> The reachability check (7) needs network + a GitHub token, so it runs in CI only — not in the local pre-commit hook.

## Scripts

All scripts live in `.github/workflows/scripts` (ESM, Node 22, only dependency is `ajv`).

| Script | Used by | What it does |
| --- | --- | --- |
| `check-format.js <files…>` | validate.yml, promote/update (verify step), pre-commit (CI) | Fails if a file is not in canonical form |
| `fix-format.js <files…>` | pre-commit hook | Rewrites files into canonical form (auto-fixer) |
| `validate.js <schema> <files…>` | validate.yml, pre-commit | Schema-validates catalogs; prints offending app by index/id/label |
| `check-docker-rules.js <files…>` | validate.yml, pre-commit | Cross-file docker rules: port uniqueness across all files and `path == /api/app-launcher/<id>`. Prints next free port |
| `diff-apps.js <old> <new>` | review-helper.yml | Emits `{added, removed, updated}` JSON; only docker entries are tracked for SHA `updated` |
| `risk-flags.js` (stdin → stdout) | review-helper.yml | Turns a diff into a markdown risk report (needs `GITHUB_TOKEN`) |
| `bump-app.js` | promote-app.yml, update-from-release.yml | Mutates one app's `commit` in a catalog file, preserving canonical format. **Note: only updates `commit`, never `branch`** |
| `sync-dev.js [--check \| --validate]` | sync-dev.yml, validate.yml, pre-commit | Regenerates `apps.dev.json` from `dev-apps.txt` + `apps.test.json`. `--check` reports drift; `--validate` checks the inputs without reading or writing `apps.dev.json` |

> **Text metadata is never copied between `apps.test.json` and `apps.prod.json`.** `bump-app.js` — and therefore both `/promote` and the auto-bump workflow — only touches `commit`. `label`, `description`, `tagline`, `tags` and `translations` must be edited in `apps.test.json` and `apps.prod.json` explicitly. This has always been true of every metadata field; `translations` is no exception.
>
> **`apps.dev.json` is the deliberate exception.** It is not hand-maintained at all — it is generated wholesale from `apps.test.json` (see [The dev catalog is generated](#the-dev-catalog-is-generated)). The rule above exists because a description change in `apps.prod.json` is user-facing on sepal.io and deserves its own review. The dev catalog serves local deployments, where being a faithful smaller copy of test is the whole point.

## The dev catalog is generated

`apps.dev.json` is a build output. Its inputs are:

- **`dev-apps.txt`** — the hand-maintained list of app ids the dev catalog carries, one per line, `#` comments allowed. Line order is catalog order.
- **`apps.test.json`** — the source of every field. Each listed id is replaced by the top-level entry of the same id, verbatim, and the top-level `tags` array is rebuilt from test's definitions filtered to the values those entries actually use.

`sync-dev.js` performs the projection. Its CLI takes no path arguments and reads no path env vars — `apps.dev.json` is the only file it can write, which is what makes the sync one-directional by construction rather than by convention.

**Do not edit `apps.dev.json` by hand.** CI rejects it: `validate.yml` always validates the projection inputs and runs `sync-dev.js --check` on any PR that touches the generated file; pre-commit hooks mirror both checks locally. To change what an app shows in dev, edit `apps.test.json`; to change which apps dev carries, edit `dev-apps.txt` and regenerate:

```bash
node .github/workflows/scripts/sync-dev.js
```

An id listed in `dev-apps.txt` but missing from `apps.test.json` fails loudly — test dropping an app the dev catalog still advertises is a bug worth surfacing, not something to silently absorb.

Between a merge to `main` that moves `apps.test.json` and the merge of the sync PR, `apps.dev.json` is knowingly stale. That window is the cost of syncing asynchronously, and it is bounded by how fast the sync PR gets merged.

## Tests

Unit tests use the built-in Node test runner (`node --test`), run via `npm test --prefix .github/workflows/scripts`.

`bump-app.js`:

- happy path: updates `commit` for the matching docker app
- app id not found → throws
- endpoint is not `docker` → throws
- repository mismatch → throws
- invalid SHA → throws
- already at target SHA → returns `changed=false`, file untouched
- output is canonical (2-space indent + trailing newline)

`sync-dev.js`:

- happy path: listed ids project in list order, entries copied verbatim
- an id absent from `apps.test.json` throws and names it
- a duplicate id, or one that violates the schema id pattern, throws
- `#` comments, blank lines and surrounding whitespace are ignored
- `tags` are filtered to the values actually used, in test's order
- a multiapp parent is copied whole and its children's tags are counted
- a tag used but not defined in `apps.test.json` throws
- output is canonical (2-space indent + trailing newline)
- re-running on an in-sync file reports `changed=false`
- `--check` reports drift without writing
- `--validate` checks inputs without reading or writing `apps.dev.json`

`validate.js`:

- a catalog validates both with and without a `translations` block
- a bad language key (`ES`, `spa`) is rejected, and the message names the key *and* the offending app
- an `en` key is rejected, since English lives at the entry root
- an unknown field inside a language block is rejected
- empty and non-string translated values are rejected
- an error on a multiapp child names both the parent and the child
- the shipped `apps.test.json` and `apps.prod.json` validate against the shipped `apps.schema.json`

`check-docker-rules.js`:

- clean catalogs report no errors and suggest `max(port)+1`
- duplicate ports are caught within a file and across files
- the same id in both catalogs sharing a port is not a collision
- `path` that does not equal `/api/app-launcher/<id>` is rejected
- non-docker apps are ignored

## Run the checks locally

Pre-commit mirrors the offline checks (formatting + schema). One-time setup:

```bash
pip install pre-commit  # or: pipx install pre-commit
pre-commit install
npm install --prefix .github/workflows/scripts
```

Run them on demand:

```bash
# unit tests
npm test --prefix .github/workflows/scripts

# formatting + schema + docker rules + dev projection (what pre-commit runs)
node .github/workflows/scripts/check-format.js apps.test.json apps.prod.json apps.dev.json apps.schema.json
node .github/workflows/scripts/validate.js apps.schema.json apps.test.json apps.prod.json apps.dev.json
node .github/workflows/scripts/check-docker-rules.js apps.test.json apps.prod.json apps.dev.json
node .github/workflows/scripts/sync-dev.js --validate
node .github/workflows/scripts/sync-dev.js --check

# reachability (CI-only; needs gh auth) — spot-check one app
gh api repos/<owner>/<repo>/compare/<branch>...<commit> --jq '.ahead_by'  # must be 0
```

## How the automation fits together

```
source repo release ──dispatch──▶ update-from-release.yml ──▶ PR (auto-bump label, apps.test.json)
                                                                  │
                                              validate.yml + review-helper.yml run, maintainer merges
                                                                  │
                                                          live on test.sepal.io
                                                                  │
                                  promote-app.yml (manual) ──▶ PR (promote label, apps.prod.json)
                                                                  │
                                              validate.yml + review-helper.yml run, maintainer merges
                                                                  │
                                                          live on sepal.io


apps.test.json merged to main ──▶ sync-dev.yml ──▶ PR (sync-dev label, apps.dev.json)
                                                                  │
                                              validate.yml + review-helper.yml run, maintainer merges
                                                                  │
                                                       local/dev deployments
```

## One-time maintainer setup for the dev sync

```bash
gh label create sync-dev \
  --description "Automated apps.dev.json sync from apps.test.json" \
  --color BFD4F2
```

`CATALOG_PR_TOKEN` is already configured and needs no change.
