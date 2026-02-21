# CODING_CONTEXT.md — Project Context for Sub-Agents

Hand this file to Codex CLI or Claude CLI when spawning implementation tasks.
It gives them enough context to work independently in a Lodestar worktree.

## Project: Lodestar

- **What:** Ethereum consensus client (beacon node + validator client)
- **Language:** TypeScript (strict mode)
- **Monorepo:** pnpm workspaces, ~20 packages
- **Runtime:** Node.js v24+
- **Key packages:**
  - `packages/beacon-node` — the beacon node (networking, sync, chain, API)
  - `packages/validator` — validator client
  - `packages/state-transition` — state transition logic (STF)
  - `packages/fork-choice` — fork choice implementation
  - `packages/types` — SSZ type definitions
  - `packages/params` — chain parameters/constants
  - `packages/cli` — CLI entry point
  - `packages/reqresp` — request/response protocol (libp2p)

## Build & Test Commands

```bash
# ALWAYS run from worktree root
source ~/.nvm/nvm.sh && nvm use 24

# Build (required before tests)
pnpm build

# Lint (biome — run BEFORE committing)
pnpm lint

# Type check
pnpm check-types

# Unit tests (specific file)
pnpm vitest run --project unit <path/to/test.ts>

# Unit tests (specific package)
pnpm vitest run --project unit packages/<pkg>/test/unit/
```

## Code Style

- **Formatter:** Biome (not Prettier/ESLint)
- **Import order:** Sorted alphabetically by package name (biome enforces this)
- **No default exports** — always use named exports
- **Error types:** Use `LodestarError<T>` with typed error codes (enum + union type)
- **Logging:** `this.logger.debug/verbose/info/warn/error` — structured with metadata objects
- **Metrics:** Prometheus-style via `this.metrics?.someMetric.inc({label: value})`

## Git Conventions

- **Commit messages:** Conventional commits — `fix:`, `feat:`, `chore:`, `refactor:`, `test:`
- **Sign commits:** `git commit -S -m "..."`
- **AI disclosure:** Add `🤖 Generated with AI assistance` to commit messages
- **Push to fork:** `git push fork <branch-name>`
- **PR target:** Usually `unstable` (or specific feature branch if noted)

## SSZ Types Pattern

```typescript
// Types defined in packages/types/src/<fork>/
export const MyType = new ContainerType({
  field1: UintNumberType,
  field2: RootType,
}, {typeName: "MyType"});
```

## Network Protocol Pattern

- Gossip topics: `packages/beacon-node/src/network/gossip/`
- Req/resp: `packages/beacon-node/src/network/reqresp/`
- Handlers: `packages/beacon-node/src/network/processor/gossipHandlers.ts`

## Key Patterns

- **Fork-aware code:** Use `isForkPostDeneb()`, `isForkPostFulu()` etc.
- **Config access:** `config.getForkName(slot)`, `config.getForkTypes(slot)`
- **Async patterns:** Prefer `async/await`, use `wrapError()` for error-or-result patterns
- **State access:** Via `chain.getHeadState()`, never hold references to old states

## Important: What NOT to do

- Don't modify files outside your worktree
- Don't run `pnpm install` unless told to (already done in worktree setup)
- Don't reformat files you didn't change (biome might want to, resist)
- Don't add dependencies without explicit approval
- Don't skip `pnpm lint` before committing
