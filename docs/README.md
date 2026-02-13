# Lodestar Documentation

This documentation is built using [Docusaurus](https://docusaurus.io/) and is published at [chainsafe.github.io/lodestar](https://chainsafe.github.io/lodestar/).

## Versioning

Documentation supports versioning so users can view docs for specific releases. The version dropdown in the navbar allows switching between versions.

### How it works

Versioned docs are **not stored in source control** — they're maintained on a separate `docs-versions` branch and fetched at build time by CI:

- **`docs-version.yml`**: Triggers on stable release tags. Builds the docs at that tag, creates a Docusaurus version snapshot, prunes old versions (keeps last 5), and pushes to the `docs-versions` branch.
- **`docs.yml`**: Before building, fetches versioned content from the `docs-versions` branch so the deployed site includes all versions.

The config reads `versions.json` dynamically — when no versions exist (e.g. local dev), the site builds without versioning.

### Manual versioning (if needed)

```bash
# 1. Generate docs (from repo root)
pnpm docs:build

# 2. Create version snapshot (from docs/)
cd docs
npx docusaurus docs:version <VERSION>
```

## Development & Build

From the repository root, set up the docs environment:

```bash
cd docs
pnpm install
```

Start the local development server:

```bash
pnpm start
```

Build the static site:

```bash
pnpm build
```
