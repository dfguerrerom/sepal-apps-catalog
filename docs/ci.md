# CI workflows, checks, and scripts

This repository is guarded by a set of GitHub Actions workflows and Node scripts. This page documents what each one does, when it runs, and how to run the equivalent checks locally.

## Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Validate catalog | `.github/workflows/validate.yml` | PRs and pushes to `main` that touch `apps.*.json`, `apps.schema.json`, or the workflow/scripts | Blocking gate: unit tests, formatting, schema, and commit reachability |
| Review helper | `.github/workflows/review-helper.yml` | PRs that touch `apps.test.json` / `apps.prod.json` or the scripts | Posts (and updates) a single PR comment with a per-app diff and risk flags |
| Promote app to production | `.github/workflows/promote-app.yml` | Manual (`workflow_dispatch`, pick an app) | Copies an app's pinned SHA from `apps.test.json` into `apps.prod.json` and opens a PR |
| Update catalog from source-repo release | `.github/workflows/update-from-release.yml` | `repository_dispatch` (`bump-app`) sent by a source repo on release | Bumps an app's `commit` in `apps.test.json` and opens a PR |

## `Validate catalog` checks

Every step is **blocking** — a failure fails the PR. Steps run in order:

1. **Run script unit tests** — `npm test` (`node --test`) over `.github/workflows/scripts`. See [Tests](#tests).
2. **Check canonical JSON formatting** — `check-format.js` verifies each file is byte-identical to canonical `JSON.stringify(parsed, null, 2) + "\n"`. Prevents diff churn from editor formatters.
3. **Validate schema** — `validate.js` validates `apps.test.json` and `apps.prod.json` against `apps.schema.json` (ajv, draft 2020-12).
4. **Verify each docker commit is reachable from its declared branch** — for every `endpoint: docker` entry, calls the GitHub compare API (`/repos/{owner}/{repo}/compare/{branch}...{commit}`) and requires `ahead_by == 0`. This guarantees the pinned `commit` is an ancestor of (or equal to) the `branch` tip — exactly what the app-launcher needs, since it does `git fetch origin <branch>` then `git checkout --detach <commit>`. A non-200 means the branch or commit does not exist; `ahead_by > 0` means the commit lives on a different branch.

> The reachability check (4) needs network + a GitHub token, so it runs in CI only — not in the local pre-commit hook.

## Scripts

All scripts live in `.github/workflows/scripts` (ESM, Node 22, only dependency is `ajv`).

| Script | Used by | What it does |
| --- | --- | --- |
| `check-format.js <files…>` | validate.yml, promote/update (verify step), pre-commit (CI) | Fails if a file is not in canonical form |
| `fix-format.js <files…>` | pre-commit hook | Rewrites files into canonical form (auto-fixer) |
| `validate.js <schema> <files…>` | validate.yml, pre-commit | Schema-validates catalogs; prints offending app by index/id/label |
| `diff-apps.js <old> <new>` | review-helper.yml | Emits `{added, removed, updated}` JSON; only docker entries are tracked for SHA `updated` |
| `risk-flags.js` (stdin → stdout) | review-helper.yml | Turns a diff into a markdown risk report (needs `GITHUB_TOKEN`) |
| `bump-app.js` | promote-app.yml, update-from-release.yml | Mutates one app's `commit` in a catalog file, preserving canonical format. **Note: only updates `commit`, never `branch`** |

## Tests

Unit tests use the built-in Node test runner (`node --test`), run via `npm test --prefix .github/workflows/scripts`. They cover `bump-app.js`:

- happy path: updates `commit` for the matching docker app
- app id not found → throws
- endpoint is not `docker` → throws
- repository mismatch → throws
- invalid SHA → throws
- already at target SHA → returns `changed=false`, file untouched
- output is canonical (2-space indent + trailing newline)

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

# formatting + schema (what pre-commit runs)
node .github/workflows/scripts/check-format.js apps.test.json apps.prod.json apps.schema.json
node .github/workflows/scripts/validate.js apps.schema.json apps.test.json apps.prod.json

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
```
