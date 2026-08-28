# sepal-apps-catalog

This repository holds SHA-pinned catalogs of SEPAL docker apps consumed by SEPAL's `app-launcher`. It currently ships three catalogs:

- `apps.test.json` — apps available in the test environment
- `apps.prod.json` — apps available in the production environment
- `apps.dev.json` — a minimal catalog for local/dev deployments: RStudio, Jupyter Notebook, Jupyter Lab, one voila app and one docker app

## Why SHA-pinning

Historically, SEPAL's app-launcher trusted contributor branches (e.g. `main`/`master`) at runtime. That means any subsequent commit to a contributor repository — malicious or accidental — would be picked up without review, exposing SEPAL users to supply-chain risk.

To mitigate this, every entry in these catalogs pins to a specific commit SHA of the contributor's repository. The app-launcher will only run code at that exact SHA. Updating an app to a new version requires opening a pull request against this repository.

## Review process

Pull requests that change app entries are reviewed via an automated risk-flag workflow that inspects the diff between the previously pinned SHA and the proposed new SHA, surfacing notable changes (new dependencies, network calls, shell-outs, etc.) to help maintainers review safely. Maintainers still make the final call.

For the full set of CI workflows, checks, scripts, and tests, see [docs/ci.md](./docs/ci.md).

## Translations

App `tagline` and `description` can carry per-language overrides in an optional `translations` block, so SEPAL can show them in the language the user selected. English stays in the existing flat fields and is the fallback for anything untranslated. See [docs/contributing.md](./docs/contributing.md#translations).

## Local setup

Install [pre-commit](https://pre-commit.com/) once and the validator dependencies for the CI scripts. The pre-commit hooks mirror the JSON checks in `.github/workflows/validate.yml` (canonical formatting + schema validation) so problems are caught before they fail CI.

```bash
pip install pre-commit  # or: pipx install pre-commit
pre-commit install
npm install --prefix .github/workflows/scripts
```

## Ownership

This repository is currently owned by [`dfguerrerom`](https://github.com/dfguerrerom) for bootstrapping purposes. It will be transferred to the [`openforis`](https://github.com/openforis) organization once the workflow is stabilized.

## License

MIT — see [LICENSE](./LICENSE).
