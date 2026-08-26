## What changes

- [ ] Adding a new app
- [ ] Bumping an existing app's commit SHA
- [ ] Editing app metadata (label, description, tags)
- [ ] Adding or updating translations
- [ ] Removing an app
- [ ] Promoting test → prod

## Upstream review

Wait for the `Review helper` bot comment to post the compare link(s) before requesting review.

## Reviewer checklist

- [ ] All status checks green
- [ ] Compare link reviewed for each updated app
- [ ] Any infra/dependency-file changes inspected manually
- [ ] Text metadata and `translations` updated in **both** catalogs where the app appears
- [ ] No risk flags raised (privileged, host network, secrets, host mounts, etc.)
