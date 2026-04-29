# sepal-apps-catalog

This repository holds SHA-pinned catalogs of SEPAL docker apps consumed by SEPAL's `app-launcher`. It currently ships two catalogs:

- `apps.test.json` — apps available in the test environment
- `apps.prod.json` — apps available in the production environment

## Why SHA-pinning

Historically, SEPAL's app-launcher trusted contributor branches (e.g. `main`/`master`) at runtime. That means any subsequent commit to a contributor repository — malicious or accidental — would be picked up without review, exposing SEPAL users to supply-chain risk.

To mitigate this, every entry in these catalogs pins to a specific commit SHA of the contributor's repository. The app-launcher will only run code at that exact SHA. Updating an app to a new version requires opening a pull request against this repository.

## Review process

Pull requests that change app entries are reviewed via an automated risk-flag workflow that inspects the diff between the previously pinned SHA and the proposed new SHA, surfacing notable changes (new dependencies, network calls, shell-outs, etc.) to help maintainers review safely. Maintainers still make the final call.

## Ownership

This repository is currently owned by [`dfguerrerom`](https://github.com/dfguerrerom) for bootstrapping purposes. It will be transferred to the [`openforis`](https://github.com/openforis) organization once the workflow is stabilized.

## License

MIT — see [LICENSE](./LICENSE).
