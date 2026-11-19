# Changesets

Every PR that changes a published package should include a changeset:

```sh
pnpm changeset
```

Pick the affected packages and the semver bump, and describe the change for the changelog.
On `main`, the release workflow opens a "Version Packages" PR; merging it publishes to npm.
