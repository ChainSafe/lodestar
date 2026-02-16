# AGENTS.md

## Project overview

Lodestar is a TypeScript implementation of the Ethereum consensus client
(beacon node and validator client). It is maintained by ChainSafe Systems
and serves as:

- **Production beacon node** for Ethereum's proof-of-stake consensus layer
- **Validator client** for stakers running validators
- **Light client** implementation with browser support
- **Reference implementation** for TypeScript/JavaScript ecosystem

## Directory structure

```
/packages/
  api/              # REST API client and server
  beacon-node/      # Beacon chain node implementation
  cli/              # Command-line interface
  config/           # Network configuration (mainnet, sepolia, etc.)
  db/               # Database abstraction (LevelDB)
  era/              # Era file handling for historical data
  flare/            # CLI debugging/testing tool
  fork-choice/      # Fork choice implementation (proto-array)
  light-client/     # Light client implementation
  logger/           # Logging utilities
  params/           # Consensus parameters and presets
  prover/           # Execution API prover
  reqresp/          # libp2p request/response protocol
  spec-test-util/   # Test harness for consensus spec tests
  state-transition/ # State transition functions
  test-utils/       # Shared utilities for testing
  types/            # SSZ type definitions
  utils/            # Shared utilities
  validator/        # Validator client

/configs/          # Network configuration files
/docs/             # Documentation source
/scripts/          # Build and release scripts
/dashboards/       # Grafana dashboard JSON files
```

## Build commands

All commands use `pnpm` as the package manager.

```bash
# Install dependencies
corepack enable
pnpm install

# Build all packages
pnpm build

# Run linter (biome)
pnpm lint

# Fix lint issues automatically
pnpm lint:fix

# Type check all packages
pnpm check-types

# Run unit tests (fast, minimal preset)
pnpm test:unit

# Run specific test file (faster - run from package directory)
cd packages/beacon-node
pnpm vitest run test/unit/path/to/test.test.ts

# Run tests matching a pattern
pnpm vitest run -t "pattern"

# Run spec tests (requires downloading first)
pnpm download-spec-tests
pnpm test:spec

# Run e2e tests (requires docker environment)
./scripts/run_e2e_env.sh start
pnpm test:e2e
```

## Code style

Lodestar uses [Biome](https://biomejs.dev/) for linting and formatting.

### General conventions

- **ES modules**: All code uses ES module syntax (`import`/`export`)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for classes,
  `UPPER_SNAKE_CASE` for constants
- **Quotes**: Use double quotes (`"`) not single quotes
- **Types**: All functions must have explicit parameter and return types
- **No `any`**: Avoid TypeScript `any` type
- **Private fields**: No underscore prefix (use `private dirty`, not `private _dirty`)

### Import organization

Imports are auto-sorted by Biome in this order:

1. Node.js/Bun built-ins
2. External packages
3. `@chainsafe/*` and `@lodestar/*` packages
4. Relative paths

Always use `.js` extension for relative imports (even for `.ts` files):

```typescript
import {something} from "./utils.js";
```

### Comments

- Use `//` for implementation comments
- Use `/** */` JSDoc format for documenting public APIs
- Add comments when code behavior is non-obvious or deviates from standards
- Whitespace helps readability in complex code

### Metrics

Metrics are critical for production monitoring:

- Follow [Prometheus naming conventions](https://prometheus.io/docs/practices/naming/)
- Always suffix metric names with units: `_seconds`, `_bytes`, `_total`
- Do NOT suffix code variables with units (no `Sec` suffix)
- Time-based metrics must use seconds

## Testing guidelines

### Test organization

Tests live alongside source code in `test/` directories:

```
packages/beacon-node/
  src/
  test/
    unit/           # Unit tests
    e2e/            # End-to-end tests
    perf/           # Performance benchmarks
    spec/           # Consensus spec tests
```

### Test requirements

- Tests must be deterministic (no external live resources)
- Do not pull from external APIs (run local nodes instead)
- Use pinned Docker tags and git commits (not branches)
- Add assertion messages for loops or repeated assertions:

```typescript
for (const block of blocks) {
  expect(block.status).equals("processed", `wrong status for block ${block.slot}`);
}
```

### Running specific tests

For faster iteration, run tests from the package directory:

```bash
cd packages/beacon-node
pnpm vitest run test/unit/chain/validation/block.test.ts -t "should reject"
```

For spec tests with minimal preset (faster):

```bash
LODESTAR_PRESET=minimal pnpm vitest run --config vitest.spec.config.ts
```

## Pull request guidelines

### Branch naming

If contributing from the main repository:

```
username/short-description
```

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new features
- `fix:` bug fixes
- `refactor:` code changes that don't add features or fix bugs
- `perf:` performance improvements
- `test:` adding or updating tests
- `chore:` maintenance tasks
- `docs:` documentation changes

Examples:

```
feat: add lodestar prover for execution api
fix: ignore known block in publish blinded block flow
refactor(reqresp)!: support byte based handlers
```

### AI assistance disclosure

**Required**: Disclose any AI assistance in your PR description:

```
> This PR was written primarily by Claude Code.
> I consulted Claude Code to understand the codebase, but the solution
> was fully authored manually by myself.
```

### PR etiquette

- Keep PRs as drafts until ready for review
- Don't force push after review starts (use incremental commits)
- Close stale PRs rather than letting them sit
- Respond to review feedback promptly

## Common tasks

### Adding a new feature

1. Create a feature branch from `unstable`
2. Implement the feature with tests
3. Run `pnpm lint` and `pnpm check-types`
4. Run `pnpm test:unit` to verify tests pass
5. Open PR with clear description and any AI disclosure

### Fixing a bug

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify the test passes
4. Run full test suite: `pnpm test:unit`

### Adding a new SSZ type

1. Add the type definition in the relevant fork file (e.g., `packages/types/src/phase0/sszTypes.ts`)
2. Export the new type from that file's `ssz` object
3. The type will be automatically aggregated (no central `sszTypes` to modify)
4. Run `pnpm check-types` to verify

## Style learnings from reviews

### Prefer inline logic over helper functions

For simple validation logic, inline the check rather than creating a helper:

```typescript
// Preferred
if (error.code === RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE) {
  return GossipAction.REJECT;
}

// Avoid (unless logic is complex and reused)
function shouldReject(error: Error): boolean {
  return error.code === RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE;
}
```

### Match existing comment style

When adding comments to containers or functions modified across forks,
follow the existing style in that file. Don't add unnecessary markers.

### Error handling patterns

Use specific error codes when available:

```typescript
// Preferred
throw new BlockError(block, {code: BlockErrorCode.PARENT_UNKNOWN});

// Avoid generic errors when specific ones exist
throw new Error("Parent not found");
```

### Config value coercion

When reading optional config values, handle undefined explicitly:

```typescript
const peers = config.directPeers ?? [];
const trimmed = value?.trim() ?? "";
```

## Implementing consensus specs

The primary reference for implementing consensus specs is the
[Ethereum consensus-specs repository](https://github.com/ethereum/consensus-specs).
Additionally, [eth2book.info](https://eth2book.info) is a valuable resource for
understanding phase0, altair, bellatrix, and capella specs and how the spec
evolved over time (though no longer actively maintained).

When implementing changes from the consensus specs, the mapping is typically:

| Spec Document                | Lodestar Package                             |
| ---------------------------- | -------------------------------------------- |
| beacon-chain.md (containers) | `@lodestar/types`                            |
| beacon-chain.md (functions)  | `@lodestar/state-transition`                 |
| p2p-interface.md             | `@lodestar/beacon-node` (networking, gossip) |
| validator.md                 | `@lodestar/validator`                        |
| fork-choice.md               | `@lodestar/fork-choice`                      |

### Fork organization

Specs and code are organized by fork: `phase0`, `altair`, `bellatrix`,
`capella`, `deneb`, `electra`, `fulu`, `gloas`.

- **@lodestar/types/src/** - Each fork has its own directory with SSZ type definitions
- **@lodestar/state-transition/src/block/** - Block processing functions
  (e.g., `processAttestations`, `processDeposit`, `processWithdrawals`)
- **@lodestar/state-transition/src/epoch/** - Epoch processing functions
- **@lodestar/state-transition/src/slot/** - Slot processing functions

## Important notes

### Default branch is `unstable`

All PRs should target `unstable`. The `stable` branch is for releases only
(see RELEASE.md for details).

### Spec tests require download

Before running `pnpm test:spec`, download test vectors:

```bash
pnpm download-spec-tests
```

### E2E tests require Docker

Start the e2e environment before running e2e tests:

```bash
./scripts/run_e2e_env.sh start
pnpm test:e2e
./scripts/run_e2e_env.sh stop
```

### Generated files

Do not edit files in `packages/*/lib/` - these are build outputs.
Edit source files in `packages/*/src/` instead.

### Consensus spec references

The `specrefs/` directory contains pinned consensus spec versions.
When implementing spec changes, reference the exact spec version.
