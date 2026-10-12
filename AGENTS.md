# AGENTS.md

## Critical rules

- **Target branch:** `main`.
- **Pre-push:** run `zig fmt --check .`, `pnpm lint`, and the relevant
  binding or spec tests before every push.
- **Bound everything:** avoid recursion, put explicit limits on loops and allocations, fail fast,
  and assert invariants.
- **No generated-file edits:** do not manually edit generated spec test files. Regenerate them with
  the corresponding `zig build run:write_*` step.
- **Relative imports:** use the `.js` extension in TypeScript ESM imports.
- **No `any`:** avoid `any` and `as any`; use proper types or a justified Biome suppression.
- **Follow existing patterns** before introducing new abstractions.
- **Security reviews:** first surface candidate security-objective violations, then use
  `THREAT_MODEL.md` to classify them. The model is not an allowlist. Downgrade a candidate only after
  verifying the applicable trust assumption against the current or planned call path. If code and
  documentation conflict, report the code behavior and the documentation gap.
- **Security documentation:** update `THREAT_MODEL.md` only when a change alters a security
  objective, trust assumption, trust boundary, or supported caller obligation. Document enduring API
  preconditions beside the owning declaration or module. Implementation changes that preserve these
  contracts require no security-documentation update.
- **Test file layout:** a module holds at most one `test` block. A single inline test is fine;
  a second one means the tests move to a sibling `<module>_test.zig`, wired from the module with
  `test { _ = @import("<module>_test.zig"); }`. Never mark a declaration `pub` only to relocate a
  test. `zig build test:tidy` enforces this.
- **Incremental commits:** after review starts, do not force-push unless a maintainer requests it.
- **Communication style:** do not use em dashes. Keep communication succinct and human-friendly.

## Project overview

Lodestar-z is a Zig library that provides consensus modules for
[Lodestar](https://github.com/ChainSafe/lodestar), the TypeScript Ethereum consensus client. It
implements performance-critical paths in Zig and exposes them to Node.js through NAPI bindings.
Major areas include:

- SSZ serialization, Merkleization, and tree-backed views
- Ethereum consensus types and fork-aware state transition
- BLS cryptography and parallel verification
- Persistent Merkle trees and hashing
- Fork choice and beacon-node components
- ERA file handling
- Node.js bindings used by Lodestar

Ethereum consensus spec tests are the source of truth for consensus behavior.

## Directory structure

```text
src/
  beacon_node/             # Beacon-node components
  bls/                     # BLS types, verification, and worker pool
  clock/                   # Slot and epoch clock
  config/                  # Runtime and network configuration
  consensus_types/         # Fork-specific Ethereum consensus types
  constants/               # Protocol constants
  era/                     # ERA file handling
  ere_verifier/            # EIP-8025 execution proof verification through ere.zig
  fork_choice/             # Fork-choice implementation
  fork_types/              # Type-erased, fork-aware wrappers
  hashing/                 # SHA-256 and Merkleization
  persistent_merkle_tree/  # Structural sharing and lazy hashing
  preset/                  # Mainnet and minimal presets
  ssz/                     # SSZ types, serialization, and views
  state_transition/        # Block, epoch, and slot processing

bindings/
  napi/                     # Zig NAPI implementation
  src/                      # JavaScript and TypeScript public API
  test/                     # Binding tests

bench/                      # Zig and binding benchmarks
test/
  fuzz/                     # Fuzz harnesses and corpora
  int/                      # Integration tests
  spec/                     # Consensus, SSZ, and BLS spec tests
examples/                   # Example programs
scripts/                    # Zig maintenance and download tools
```

## Build commands

The repository uses Zig 0.16.0 and pnpm 10.x.

### Zig library

```bash
# Build all default artifacts
zig build

# Check Zig formatting
zig fmt --check .

# Format Zig files
zig fmt .

# Run repo-wide lint rules that `zig fmt` cannot express
zig build test:tidy

# Run all unit tests
zig build test

# Run one module's tests
zig build test:ssz
zig build test:bls
zig build test:state_transition

# Filter a module test
zig build test:ssz -Dtest:ssz.filters="test name"

# Filter the aggregate test step
zig build test -- --test-filter "test name"
```

Prefer a targeted module test while iterating, do not run `zig build test` unless necessary.

### Spec tests

```bash
# Download vectors pinned by build.zig.zon
zig build run:download_spec_tests

# Generate test sources
zig build run:write_spec_tests
zig build run:write_ssz_generic_spec_tests
zig build run:write_ssz_static_spec_tests
zig build run:write_bls_spec_tests

# Run generated suites
zig build test:spec_tests -Dpreset=minimal
zig build test:ssz_generic_spec_tests -Dpreset=minimal
zig build test:ssz_static_spec_tests -Dpreset=minimal
zig build test:bls_spec_tests -Dpreset=minimal

# Filter a suite
zig build test:spec_tests -Dtest:spec_tests.filters="pattern" -Dpreset=minimal
```

Use the minimal preset for faster iteration, but run mainnet when behavior depends on preset values.
Do not assume minimal and mainnet constants are interchangeable.

### ere verifier fixtures

The execution-proof-verifier binding test verifies ere's own fixture proofs when the fixtures are present;
ere.zig covers the same proofs at the library level:

```bash
zig build run:download_ere_fixtures
pnpm test
```

### JavaScript and TypeScript bindings

```bash
# Install dependencies
pnpm install

# Build bindings
zig build build-lib:bindings
zig build build-lib:bindings -Doptimize=ReleaseSafe

# Build for a specific preset through package scripts
pnpm prepare-mainnet
pnpm prepare-minimal

# Run binding tests
pnpm test

# Run Biome
pnpm lint
pnpm exec biome check --write .
```

Binding tests require a compatible `zig-out/lib/bindings.node`; rebuild it after changing Zig NAPI
code or the selected preset.

### Integration tests and benchmarks

```bash
# ERA-backed integration tests
zig build run:download_era_files
zig build test:int

# Representative benchmarks
zig build run:bench_ssz_attestation -Doptimize=ReleaseSafe
zig build run:bench_ssz_block -Doptimize=ReleaseSafe
zig build run:bench_ssz_state -Doptimize=ReleaseSafe
zig build run:bench_hashing -Doptimize=ReleaseSafe
zig build run:bench_merkle_node -Doptimize=ReleaseSafe
zig build run:bench_merkle_gindex -Doptimize=ReleaseSafe
zig build run:bench_process_block -Doptimize=ReleaseSafe
zig build run:bench_process_epoch -Doptimize=ReleaseSafe
```

## Code style

### Zig

The project style guide is `.gemini/styleguide.md`, a Lodestar-specific adaptation of TigerStyle.
Important requirements include:

- Safety, performance, and developer experience, in that order.
- No recursion. Put a fixed upper bound on work and memory.
- Assert preconditions, postconditions, and invariants. Test both valid and invalid boundaries.
- Handle every error and clean up partially initialized resources.
- Prefer static or startup allocation where appropriate, but do not avoid dynamic allocation
  blindly.
- Use explicitly sized integer types for persisted and protocol values.
- Pass values larger than 16 bytes by `*const` when copying is not intended.
- Construct large objects in place where practical.
- Keep allocation and matching cleanup together, separated from surrounding logic by blank lines.
- Explain why a non-obvious design or safety decision is correct.
- Name error values `error.Name`, never through their set as `Error.Name` or `MyError.Name`.
  Declared error sets stay in signatures. `zig build test:tidy` enforces this.
- Run `zig fmt` on every Zig change.

#### Zig 0.16 standard-library names

Use the current names from the Zig 0.16 standard library. The old aliases below are deprecated:

- `std.ArrayListUnmanaged` and `std.ArrayListAligned*` become `std.ArrayList` or
  `std.array_list.Aligned`.
- `std.AutoArrayHashMapUnmanaged`, `std.ArrayHashMapUnmanaged`, and
  `std.StringArrayHashMapUnmanaged` become `std.array_hash_map.Auto`,
  `std.array_hash_map.Custom`, and `std.array_hash_map.String`.
- `std.mem.indexOf*` and `std.mem.lastIndexOf*` become the corresponding `find*` functions.
- Static bit sets use `.empty` and `.full` instead of `initEmpty()` and `initFull()`.

### JavaScript and TypeScript

Bindings use ES modules and Biome:

- Use double quotes and named exports.
- Use `.js` extensions for relative TypeScript imports.
- Use `camelCase` for functions and variables, `PascalCase` for types and classes, and
  `UPPER_SNAKE_CASE` for constants.
- Avoid `any` and `as any`. If unavoidable, add a suppression with the full rule and rationale.
- Keep declarations in `bindings/src/*.d.ts` synchronized with JavaScript wrappers and NAPI exports.
- Do not edit native binaries under `zig-out/`; they are build outputs.


### Comments

**The default number of comments in new code is zero.**

Add a comment only when the code cannot carry important information, such as:

- A precondition not visible in the signature
- A non-obvious consensus or protocol rule
- Design, invariants, or non-obvious algorithms of a public or self-contained module
- An ordering or workaround that looks unnecessary but is correctness-critical
- Rationale needed to prevent a future regression

Do not comment to restate what the code does. If the reason is clear from the surrounding names and
structure, omit the comment. Do not narrate a change or record what the code used to do. That belongs
in the commit message. Keep enduring correctness constraints and non-obvious rationale next to the
code they govern.

Prefer a clearer name, a smaller function, or a named constant over a comment explaining unclear
code. Use `//` for implementation comments and `/** */` JSDoc for public API documentation.

Prefer the active voice over passive voice. For example, instead of:

```
Invalid cryptographic inputs return false; Malformed inputs throw an error.
```

Prefer:

```
/// Returns false on cryptographic failure. Throws for malformed inputs.
```


## Architecture patterns

### Fork-aware code

Fork progression is:

`phase0` -> `altair` -> `bellatrix` -> `capella` -> `deneb` -> `electra` -> `fulu` ->
`gloas` -> `heze`

Keep fork-specific types and logic in the corresponding namespace or module. Use existing fork
guards and `Any*` wrappers instead of unchecked casts. Changes to a fork generally apply to later
forks unless the consensus specification explicitly overrides them.

### Presets and configuration

- Compile-time protocol values live in `src/preset/` and `src/constants/`.
- Runtime chain configuration lives in `src/config/`.
- Both mainnet and minimal must compile and pass their relevant tests.
- Size stack buffers and fixed collections from protocol constants only when the input is guaranteed
  to have that protocol bound. Public binding inputs need explicit validation or a dynamic fallback.

### SSZ types

SSZ definitions are compile-time namespaces that expose the value type, default value,
serialization, deserialization, hash-tree-root, and view operations. Match the existing fixed versus
variable type distinction and preserve canonical SSZ limits. For consensus changes, update types,
fork wrappers, and spec test generation together as needed.

### Memory and ownership

Zig code must make allocator and ownership boundaries explicit:

- Pair every allocation with `defer` or `errdefer` immediately.
- Clean up all successfully initialized elements when initialization fails partway through.
- Do not free through a different allocator than the one used to allocate.
- Treat NAPI values and slices as scoped to the environment and callback rules documented by zapi.
- Avoid retaining pointers into growable collections across operations that may reallocate them.
- Prefer bounded stack buffers only when their worst-case size is safe for every calling context.

### NAPI bindings

- Zig exports are implemented under `bindings/napi/`.
- Public JavaScript wrappers and declarations live under `bindings/src/`.
- Keep errors at the boundary specific and stable.
- Validate untrusted JavaScript lengths, indexes, and byte encodings before native access.
- Account for worker teardown and Node.js worker isolation when changing global native state.

## Testing guidelines

- Tests must be deterministic and bounded.
- Add regression tests for bug fixes where the failure can be reproduced reliably.
- Test positive and negative boundaries, especially lengths, indexes, serialization offsets, and
  partial initialization.
- Use `std.testing.allocator` in unit tests to detect leaks.
- Prefer exact error assertions over accepting any failure.
- Run the narrowest relevant test during development and the complete affected module before push.
- Run consensus spec tests for consensus types, SSZ behavior, or state-transition changes.
- Run both minimal and mainnet tests when preset-dependent limits or behavior change.
- Build and run binding tests for changes under `bindings/` or exported native APIs.
- Fuzz parsers, deserializers, and cryptographic boundaries when introducing new input shapes.

### Test file layout

Keep tests beside the code they cover without letting them crowd it out.

- A module holds at most one `test` block. One inline test is a usage example and stays put; a
  second one makes it a suite, and suites live in a sibling `<module>_test.zig`. A module is
  therefore either inline (one test) or extracted (only the wiring block), never both.
- Name the test file after its module in snake_case. `slot_math.zig` pairs with
  `slot_math_test.zig`, and `Node.zig` pairs with `node_test.zig`.
- Wire the import from the module under test, not from the package `root.zig`:

```zig
// slot_math.zig
test {
    _ = @import("slot_math_test.zig");
}
```

  Keeping the import local means the pairing survives moving or deleting the module, and no
  package root has to be updated.
- Move only the tests. Leave the test bodies unchanged and rebuild the prelude they relied on in
  the new file as imports and aliases.
- Private test helpers move with the tests they serve.
- Do not widen a declaration to `pub` only to relocate a test. Tests that exercise private
  internals stay inline.
- Prefix memory safety regression test names with `memory_safety: ` and keep them in the sibling
  test file for the module they cover.
- Tests covering a whole package belong in `root_test.zig`, wired from the package `root.zig`.

## Pull request guidelines

### Branches and commits

Create branches from `main`. Use Conventional Commit messages:

- `feat:` new functionality
- `fix:` bug fixes
- `refactor:` behavior-preserving code changes
- `perf:` performance improvements
- `test:` test-only changes
- `docs:` documentation changes
- `chore:` maintenance

Keep commits focused. After review begins, add incremental commits rather than rewriting history
unless a maintainer asks otherwise.

### Titles and descriptions

Title: conventional-commit prefix, then an imperative subject of about four words, lowercase, no
period. `refactor: extract tests to _test.zig`.

Description: use the Lodestar template and scale the detail to the change.

```markdown
**Motivation**

The problem, at whatever length it needs. Quote the error or log, link the issue or discussion.

**Description**

One sentence saying what this does.

- Change, named by identifier
  - detail

TODO:
- follow-up, if any

**AI Assistance Disclosure**

One line.
```

- Motivation is never empty. It states the problem at whatever length the problem needs, and
  links the issue, review comment, or discussion it came from.
- Quote the evidence: the error, the log, the command output, in a code block. Long output goes in
  a `<details>` block.
- Description length tracks the diff. A one-line fix gets a sentence; a larger change can use
  bullets, tables, or short subsections to explain behavior and relevant evidence.
- Bullets name concrete changes by identifier in backticks.
- Use tables or short subsections when they make before/after behavior, tradeoffs, or validation
  easier to review. Use text or code blocks instead of screenshots of text.
- Put the main rationale in Motivation. Include design constraints and validation evidence in
  Description when they help reviewers assess the change; link CI instead of repeating routine output.
- Do not list example files to illustrate a point.
- Code blocks are for real output or a before/after of an interface, never for explaining a
  concept.

### AI assistance disclosure

Disclose AI assistance in the PR description, following Lodestar's convention. State whether the
implementation was primarily AI-authored or whether AI was used only for codebase exploration.

### Pre-push checklist

1. `zig fmt --check .`
2. `zig build test:tidy`
3. Run relevant tests, never run slow `zig build test` unless changes touch spec logic
4. Relevant spec tests for consensus, SSZ, or BLS changes
5. `pnpm lint` for binding source changes
6. Rebuild bindings and run `pnpm test` for binding or NAPI changes
7. Confirm no generated test source or build output was edited manually
8. Confirm both ownership cleanup and error paths are covered

## Common tasks

### Fixing a bug

1. Add a failing regression test when practical.
2. Identify the violated invariant or missing boundary check.
3. Fix the bug and all partial-failure cleanup paths.
4. Run the affected module tests.
5. Run spec or binding tests when the changed boundary requires them.

### Adding or changing a consensus type

1. Update the type in the relevant `src/consensus_types/<fork>.zig` file.
2. Propagate it through later forks and `src/fork_types/` where required.
3. Update state-transition logic that consumes the type.
4. Regenerate the relevant spec tests.
5. Run minimal and mainnet spec suites.

### Adding a NAPI API

1. Implement the native export under `bindings/napi/`.
2. Register it through the existing zapi export pattern.
3. Add or update the wrapper and declaration under `bindings/src/`.
4. Validate all JavaScript-controlled inputs at the native boundary.
5. Add tests under `bindings/test/`.
6. Build ReleaseSafe bindings and run `pnpm test` and `pnpm lint`.

### Changing SSZ behavior

1. Locate the fixed, variable, serialized, and tree-view paths affected by the change.
2. Preserve canonical limits and offset validation.
3. Add unit tests for valid values and malformed boundary cases.
4. Regenerate and run generic or static SSZ spec tests.
5. Fuzz the changed parser or deserializer when applicable.

## Implementing consensus specifications

The primary reference is the
[Ethereum consensus-specs repository](https://github.com/ethereum/consensus-specs). The test version
is pinned in `build.zig.zon`; reference that exact version when implementation details differ from
upstream `master`.

Typical mappings are:

| Consensus specification area | Lodestar-z location |
| --- | --- |
| SSZ containers and fork types | `src/consensus_types/`, `src/fork_types/` |
| Block processing | `src/state_transition/block/` |
| Epoch processing | `src/state_transition/epoch/` |
| Slot processing | `src/state_transition/slot/` |
| Fork choice | `src/fork_choice/` |
| Hashing and Merkleization | `src/hashing/`, `src/persistent_merkle_tree/`, `src/ssz/` |
| Node.js integration | `bindings/napi/`, `bindings/src/` |

When porting Lodestar behavior, preserve consensus semantics rather than TypeScript implementation
details. Use the spec vectors to verify equivalence and document intentional differences caused by
Zig ownership, bounded memory, or NAPI constraints.
