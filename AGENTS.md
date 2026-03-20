# AGENTS.md

## Critical rules

- **Target branch:** `unstable` (never `stable`)
- **Pre-push:** run `pnpm lint`, `pnpm check-types`, `pnpm test:unit` before every push
- **Relative imports:** use `.js` extension in TypeScript ESM imports
- **No `any`:** avoid `any` / `as any`; use proper types or justified `biome-ignore`
- **No `lib/` edits:** never edit `packages/*/lib/` — these are build outputs
- **Follow existing patterns** before introducing new abstractions
- **Structured logging** with specific error codes (not generic `Error`)
- **Incremental commits** after review starts — do not force push unless maintainer requests it

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

# Build a specific package (faster iteration)
pnpm --filter @lodestar/beacon-node build

# Run linter (biome)
pnpm lint

# Fix lint issues automatically
pnpm lint:fix

# Type check all packages
pnpm check-types

# Type check a specific package
pnpm --filter @lodestar/beacon-node check-types

# Run unit tests (fast, minimal preset)
pnpm test:unit

# Run specific test file with project filter
pnpm vitest run --project unit test/unit/path/to/test.test.ts

# Run tests matching a pattern
pnpm vitest run --project unit -t "pattern"

# Run spec tests (requires downloading first)
pnpm download-spec-tests
pnpm test:spec

# Run e2e tests (requires docker environment)
./scripts/run_e2e_env.sh start
pnpm test:e2e
```

**Tip:** For faster iteration, run tests from the specific package directory:

```bash
cd packages/beacon-node
pnpm vitest run test/unit/chain/validation/block.test.ts
```

## Code style

Lodestar uses [Biome](https://biomejs.dev/) for linting and formatting.

### General conventions

- **ES modules**: All code uses ES module syntax (`import`/`export`)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for classes,
  `UPPER_SNAKE_CASE` for constants
- **Quotes**: Use double quotes (`"`) not single quotes
- **Types**: Prefer explicit types on public APIs and complex functions
- **No `any` or `as any`**: Do not use `any` type or `as any` assertions to bypass
  the type system. In production code, find the proper type or interface. In test code,
  use public APIs rather than accessing private fields via `as any`. If genuinely
  unavoidable, add a suppression with the full rule ID and justification:
  `// biome-ignore lint/suspicious/noExplicitAny: <reason>`
- **Private fields**: No underscore prefix (use `private dirty`, not `private _dirty`)
- **Named exports only**: No default exports

### Import organization

Imports are auto-sorted by Biome in this order:

1. Node.js/Bun built-ins
2. External packages
3. `@chainsafe/*` and `@lodestar/*` packages
4. Relative paths

In TypeScript source and test files, use `.js` extension for relative ESM imports
(even though source files are `.ts`). This is required for Node.js ESM resolution.
This rule does **not** apply to non-TS files (e.g., `package.json`, `.mjs` config).

```typescript
// ✅ Correct
import {something} from "./utils.js";
import {IBeaconStateView} from "../stateView/interface.js";

// ❌ Wrong — will break at runtime
import {something} from "./utils.ts";
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

## Architecture patterns

### Fork-aware code

Code that varies by fork uses fork guards and type narrowing:

```typescript
import {isForkPostElectra, isForkPostFulu} from "@lodestar/params";

// Check fork before accessing fork-specific fields
if (isForkPostElectra(fork)) {
  // electra and later forks
}
```

The fork progression is: `phase0` → `altair` → `bellatrix` → `capella` →
`deneb` → `electra` → `fulu` → `gloas`.

### Configuration

`ChainForkConfig` combines base chain config with computed fork information:

```typescript
// Access config values
config.SLOTS_PER_EPOCH; // from params
config.getForkName(slot); // computed fork for a slot
config.getForkTypes(fork); // SSZ types for a fork
```

`@lodestar/params` holds constants (`SLOTS_PER_EPOCH`, etc.).
`@lodestar/config` holds runtime chain configuration.

### State access

- Get current state via `chain.getHeadState()` — returns a tree-backed state
- **Never hold references to old states** — they consume memory and can go stale
- For read-only access, use the state directly; for mutations, use `state.clone()`
- Beacon state is tree-backed (persistent data structure), making cloning cheap

### SSZ types

Types use `@chainsafe/ssz` and come in two forms:

- **Value types**: Plain JS objects. Easy to work with, higher memory usage.
- **View/ViewDU types**: Tree-backed. Memory-efficient, used for beacon state.

```typescript
// Type definition
const MyContainer = new ContainerType(
  {
    field1: UintNum64,
    field2: Root,
  },
  {typeName: "MyContainer"}
);

// Value usage
const value = MyContainer.defaultValue();
value.field1 = 42;

// View usage (tree-backed)
const view = MyContainer.toViewDU(value);
view.field1 = 42;
view.commit();
```

### Fork choice

The fork choice store uses proto-array for efficient head computation:

- `getHead()` returns a **cached** `ProtoBlock` — may be stale after mutations
- After modifying proto-array node state (e.g., execution status), call
  `recomputeForkChoiceHead()` to refresh the cache
- This applies to any code that modifies proto-array outside normal block import

### Logging

Use structured logging with metadata objects:

```typescript
this.logger.debug("Processing block", {slot, root: toRootHex(root)});
this.logger.warn("Peer disconnected", {peerId: peer.toString(), reason});
```

- Prefer structured fields over string concatenation
- Use appropriate levels: `error` > `warn` > `info` > `verbose` > `debug` > `trace`
- Include relevant context (slot, root, peer) as structured fields

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

See **Build commands** above for all test invocations. Use `--project unit`
for targeted runs and `LODESTAR_PRESET=minimal` for faster spec tests.

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
- Avoid force push after review starts unless a maintainer requests it (use incremental commits)
- Flag stale PRs to maintainers rather than letting them sit indefinitely
- Respond to review feedback promptly — reply to every comment, including bot reviewers
- When updating based on feedback, respond in-thread to acknowledge

## Pre-push checklist

Before pushing any commit, verify:

1. `pnpm lint` — Biome enforces formatting; CI catches failures but wastes a round-trip
2. `pnpm check-types` — catch type errors before CI
3. `pnpm docs:lint` — if you edited any `.md` files, check Prettier formatting
4. No edits in `packages/*/lib/` — these are build outputs; edit `src/` instead

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
4. Run checks: `pnpm lint`, `pnpm check-types`, `pnpm test:unit`

### Adding a new SSZ type

1. Add the type definition in the relevant fork file (e.g., `packages/types/src/phase0/sszTypes.ts`)
2. Export the new type from that file's `ssz` object
3. The type will be automatically aggregated (no central `sszTypes` to modify)
4. Run `pnpm check-types` to verify

### Adding a new API endpoint

1. Define the route in `packages/api/src/beacon/routes/<resource>.ts`
2. Add request/response SSZ codecs alongside the route definition
3. Implement the server handler in `packages/beacon-node/src/api/impl/beacon/<resource>.ts`
4. Add tests for the new endpoint
5. Reference the [Beacon APIs spec](https://github.com/ethereum/beacon-APIs) for the endpoint contract

## Style learnings from reviews

- **Prefer inline logic** over single-use helper functions for simple checks
- **Match existing patterns** in the file you're modifying (comments, structure)
- **Use specific error codes** (`BlockErrorCode.PARENT_UNKNOWN`) over generic `Error`
- **Handle undefined** explicitly: `config.directPeers ?? []`, `value?.trim() ?? ""`

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

Forks follow the progression defined in **Architecture patterns > Fork-aware code** above.

- **@lodestar/types/src/** - Each fork has its own directory with SSZ type definitions
- **@lodestar/state-transition/src/block/** - Block processing functions
  (e.g., `processAttestations`, `processDeposit`, `processWithdrawals`)
- **@lodestar/state-transition/src/epoch/** - Epoch processing functions
- **@lodestar/state-transition/src/slot/** - Slot processing functions

The `specrefs/` directory contains pinned consensus spec versions.
When implementing spec changes, reference the exact spec version.
