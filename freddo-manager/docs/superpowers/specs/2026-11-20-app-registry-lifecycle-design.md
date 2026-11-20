# App Registry and Lifecycle Design

## Goal

Give Frappe apps a first-class rail in freddo-manager. Operators can maintain app
repositories and compatible releases, validate and test them, select only tested
releases during deploy, and install, update, or remove apps from existing benches.

## Current state

The deploy form accepts comma-separated app names. The Executor allows only a
hard-coded app list and Frappe version list. Frappe-Manager validates app repositories
when creating benches, but its `update` command does not manage apps. The installed
Frappe-Manager exposes `AppConfig` repository validation, and its `shell` command can
run commands in a bench container.

## Design

- Add a persistent app registry to the existing SQLite state DB. Each app has a unique
  Python package name, HTTPS repository URL, enabled/archive state, and releases keyed
  by supported Frappe version. Each release stores its branch/tag/ref, latest repository
  validation result, latest isolated test result, timestamps, and the commit tested.
- Seed the core apps (`frappe`, `erpnext`, `hrms`) as unverified registry entries. A
  release becomes selectable only after its repository/ref validates and its isolated
  app tests pass. Changing its URL or ref invalidates those results.
- Add a protected **Apps** rail with app/release CRUD, repository validation, isolated
  test jobs, history/status, and app lifecycle actions on existing benches. Deployment
  uses a multi-select of enabled, tested apps compatible with the selected Frappe
  version; free-form app input is removed.
- Run validation and all bench commands through the existing Executor job queue. The
  Executor re-reads the registry and verifies app/release IDs, refs, and test status;
  browser-supplied URLs or command strings are never executed directly.
- Test an app in a disposable, local Frappe-Manager bench using the selected Frappe
  release, install the app, and run `bench --site <test-site> run-tests --app <app>`.
  Always attempt to delete that bench after completion and persist job output/status.
  A test must never target a production bench.
- On existing benches, support install, update to a configured release, and uninstall.
  Back up before update or uninstall. Uninstall has a dry-run/impact preview and a
  second confirmation naming the bench and app because Frappe removes the app's data.
  Leave shared app source in a bench when another site still depends on it.
- Keep the manager local, use the existing Docker/Podman-compatible Executor, and do
  not add Cloudflare API integration.

## App and release validation

- App names must be valid Python package identifiers and unique.
- Repositories must be HTTPS URLs without embedded username/password or query secrets.
- Release refs must be nonempty branch/tag names from a conservative allowlist; resolved
  commit SHA is stored when validation/test completes.
- Only an exact successful test result for the selected Frappe version, ref, and commit
  makes a release deployable. A failed or stale test remains visible but cannot be
  selected for a new public deploy.
- Public repositories are supported in this slice. Private-repository credentials are
  explicitly out of scope; app URLs must not contain credentials.

## Frappe command behavior

- Repository check: Frappe-Manager `AppConfig` validation (`git ls-remote`).
- Isolated test: create a temporary bench with Frappe and the selected app release,
  run the app's test suite, then delete the temporary bench in a `finally` cleanup.
- Install: fetch the configured repository/ref into the target bench, then
  `bench --site <site> install-app <app>`.
- Update: back up the target site, switch the app to the configured ref, and migrate.
- Uninstall: run Frappe's uninstall dry-run, create a backup, uninstall the app, and
  remove bench source only when no site in that bench still uses it.

Frappe documentation describes `uninstall-app` as removing the app's linked doctypes
and modules, and documents its `--dry-run` option. It also documents app-scoped
`run-tests` and the install/uninstall commands:

- https://docs.frappe.io/framework/user/en/bench/reference/uninstall-app
- https://docs.frappe.io/framework/user/en/testing
- https://docs.frappe.io/framework/user/en/frappe-commands

## Out of scope

- Cloudflare API calls or routes.
- Private Git repository credentials.
- Automatically changing an app's code or ref to make tests pass.
- Running an app test suite against an existing production site.
- Removing app data without an explicit operator confirmation and backup.

## Acceptance criteria

1. Operators can add/edit/archive apps and releases without editing JSON or source.
2. Repository/ref validation and isolated test results persist across restarts.
3. Deploy only offers releases with an exact passing test for the chosen Frappe version.
4. Install, update, test, and uninstall run as observable Executor jobs on the local host.
5. Uninstall shows impact, takes a backup, and never removes shared app source still in use.
6. Existing Docker and Podman support remains intact; Freddo itself stays loopback-only.
