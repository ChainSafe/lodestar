# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for the full project guide — build commands, code style, architecture patterns, testing, and PR guidelines.

## Quick Reference

```bash
# Build
pnpm build

# Lint (biome)
pnpm lint
pnpm lint:fix

# Type check
pnpm check-types

# Unit tests
pnpm test:unit

# Run specific test
pnpm vitest run --project unit test/unit/path/to/test.test.ts

# Spec tests (download first)
pnpm download-spec-tests
pnpm test:spec

# Docs lint (markdown)
pnpm docs:lint
pnpm docs:lint:fix
```

## Key Conventions

- **Default branch:** `unstable` (all PRs target this)
- **Import extensions:** Always use `.js` for relative imports (even for `.ts` files)
- **No default exports:** Named exports only
- **Metrics:** Prometheus naming, always suffix with units (`_seconds`, `_bytes`, `_total`)
- **Fork order:** phase0 → altair → bellatrix → capella → deneb → electra → fulu → gloas
- **Commit style:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, etc.)
- **AI disclosure:** Required in PR descriptions when AI-assisted
