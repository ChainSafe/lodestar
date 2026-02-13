# Lodestar Documentation

This documentation is built using [Docusaurus](https://docusaurus.io/) and is published at [chainsafe.github.io/lodestar](https://chainsafe.github.io/lodestar/).

## Versioning

Documentation supports versioning so users can view docs for specific releases. The version dropdown in the navbar allows switching between versions.

### Creating a new version

When cutting a new release, create a versioned snapshot of the current documentation:

```bash
# 1. Make sure generated docs are up to date (from the repo root)
pnpm docs:build

# 2. Create the version snapshot (from the docs/ directory)
cd docs
npx docusaurus docs:version <VERSION>
```

For example, to create docs for version `1.41.0`:

```bash
pnpm docs:build
cd docs
npx docusaurus docs:version 1.41.0
```

This will:
- Copy `docs/pages/` into `docs/versioned_docs/version-1.41.0/`
- Create `docs/versioned_sidebars/version-1.41.0-sidebars.json`
- Add the version to `docs/versions.json`

After creating a new version, update `lastVersion` in `docusaurus.config.ts` to point to the new version.

### Removing old versions

To keep the repository size manageable, remove versions older than the last 5 releases:

1. Remove the version from `versions.json`
2. Delete the `versioned_docs/version-<VERSION>/` directory
3. Delete the `versioned_sidebars/version-<VERSION>-sidebars.json` file

## Development

```bash
cd docs
pnpm install
pnpm start
```

## Build

```bash
cd docs
pnpm install
pnpm build
```
