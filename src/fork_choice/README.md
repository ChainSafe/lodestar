# Zig fork choice

Spec-driven rewrite of the beacon chain fork choice, written against
[consensus-specs v1.7.0-beta.4](https://github.com/ethereum/consensus-specs/tree/v1.7.0-beta.4/specs)
`fork-choice.md` for phase0 through heze. This document records the design, how it
differs from the TypeScript proto-array in `packages/fork-choice`, the benchmark
comparison, and what is still missing. It stays here while the rewrite is under
review; `comparison.html` next to it is a self-contained visual walkthrough of the
same material.

## Files

| File                               | Contents                                                                            | Spec functions                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.zig`                        | `Store`: the spec `Store` minus beacon states, every handler, optimistic sync       | `get_forkchoice_store`, `on_tick`, `on_block`, `on_attestation`, `on_attester_slashing`, `on_payload_attestation_message`, `on_execution_payload_envelope`, `get_ancestor`, `get_checkpoint_block`, `update_checkpoints`, `should_extend_payload`, `payload_timeliness`, `should_build_on_full` |
| `head.zig`                         | Head computation as array passes                                                    | `get_weight`, `filter_node_tree`, `get_head`, `get_supported_node`, `should_apply_proposer_boost`, `is_head_weak`, `is_parent_strong`                                                                                                                                                           |
| `proposer_head.zig`                | Proposer reorg helpers                                                              | `get_proposer_head` and its predicates                                                                                                                                                                                                                                                          |
| `store_test.zig`                   | Unit tests on a real two-branch chain                                               |                                                                                                                                                                                                                                                                                                 |
| `test/spec/runner/fork_choice.zig` | Spec vector runner, plays the role of `block_states` and `checkpoint_states`        |                                                                                                                                                                                                                                                                                                 |
| `bench/fork_choice/`               | `getHead` and `onAttestation` benchmarks mirroring `packages/fork-choice/test/perf` |                                                                                                                                                                                                                                                                                                 |

Every helper keeps its spec name in camelCase so the Zig and the Python read side
by side.

## Design

### The store keeps facts, not answers

Blocks live in one `std.MultiArrayList(Block)` ordered by insertion. Because
`on_block` requires a known parent, a parent's index is always smaller than its
child's, which lets `head.zig` run bottom-up passes over the array instead of
recursing or keeping child lists. Columns hold what the spec reads from a block and
its post-state: slot, parent, proposer, realized and unrealized checkpoints,
timeliness bits, Gloas bid hashes, payload flags.

Latest messages are a dense array indexed by validator, one `LatestMessage` each,
exactly as in the spec. Queued votes, those whose slot is not yet past, are a second
array of the same shape: the first vote of a slot wins, as applying them in order at
the next slot would, a vote for a later slot replaces an earlier one, and each tick
walks both arrays in lockstep applying what became past. Memory is bounded by the
validator set however many duplicates gossip delivers, and `prune` remaps both
arrays alike. Equivocators are a bitset. Justified balances arrive through
a `StateProvider` callback when the justified checkpoint changes and are kept as raw
effective-balance increments plus an active-and-unslashed bitset.

Only the per-node vote totals are carried between calls. Weights, viability and best
children live in scratch arrays that every `getHead` rebuilds; a `dirty` flag on the
cache makes repeated reads free.

### Head computation

The spec's `get_weight` scans every latest message per node and `filter_node_tree`
recurses. `head.zig` produces every node's weight and viability at once:

1. Forward pass: the finalized-checkpoint ancestor of every block, via its parent.
2. Vote totals: each latest message of an active, unslashed, non-equivocating
   validator counts its balance on `get_supported_node`. The totals persist; a run
   moves only the votes of validators whose message changed or who equivocated since
   the last run. New justified balances move only the weights that changed, and
   `prune` renumbers the counted nodes in place; neither recounts every vote.
3. Reverse pass: each block applies the leaf viability rule, then hands its weight and
   viability to the parent node it hangs from. A message supports exactly the nodes on
   the path from its supported node to the justified root, which is what this
   accumulation computes.
4. Proposer boost: `should_apply_proposer_boost` is decided on the attestation
   scores, then the boosted block's path to the root is marked. `get_weight` adds the
   score on the marked nodes at read time, and `get_attestation_score` stays available
   for the reorg helpers.
5. Best child per node by the spec key `(weight, root, tiebreaker)`, then a descent
   from the justified root.

The previous-slot zeroing of Gloas `get_weight` is applied only when children are
compared, never during accumulation.

### Optimistic sync

The `optimistic-sync.md` rules are facts plus one derivation. Each block row stores
the engine's verdict on the block's own payload (`pre_merge`, `syncing`, `valid`,
`invalid`) and that payload's block hash. A node's status is never stored: a forward
pass in `head.zig` takes the status of the node a block hangs from and, before Gloas
or for a `full` node, folds in the block's own payload; the worst verdict wins. A
Gloas `pending` or `empty` node therefore inherits the status of the parent payload
the bid names, and the fork transition needs no special case.

A node derived `invalid` is treated as removed: it is never viable, its weight never
reaches its parent, a proposer boost on it is dropped, and a justified checkpoint on
it makes `getHead` fail, which also fails every later import; the spec allows a node
to exit there and proto-array does the same. Two entry points change the facts:

- `onPayloadValid(block_hash)` and a `.valid` verdict on `onBlock` or
  `onExecutionPayloadEnvelope` mark every `syncing` payload below the node `valid`,
  stopping at the first `valid` or `pre_merge` one.
- `onPayloadInvalid(parent_root, parent_block_hash, latest_valid_hash)` is the
  `validateLatestHash` of proto-array: the rejected block is never in the store, so
  the walk starts at its parent node and marks payloads `invalid` down to the latest
  valid hash, exclusive. A zero hash stops at the merge boundary; a null or unknown
  hash names the rejected block itself and changes nothing. Descendants need no walk,
  the derivation covers them.

Both walks follow the payload chain: `full` nodes and pre-Gloas blocks contribute
their own payload, `empty` links skip the parent's. Both check the whole walk before
writing, so a `valid` to `invalid` or `invalid` to `valid` transition is reported as a
consensus failure with nothing changed.

The root block hangs from nothing, so the store keeps the status of the node it hung
from in `root_base_status`: `pre_merge` for an anchor, whose ancestors count as
validated, and after `prune` the derived status of the dropped parent node, so a
Gloas root's `pending` and `empty` nodes still read as optimistic while the payloads
below the finalized block await the engine. A valid walk that reaches the root
validates that too.

### Gloas nodes

A fork choice node is `(block index, payload_status)` with the spec's numeric values
(`empty = 0`, `full = 1`, `pending = 2`); node id is `block * 3 + status`. Pre-Gloas
blocks only use `pending`, which plays the role of the spec's single node per block.
A Gloas block's `pending` node has `empty` and (once the envelope is verified) `full`
as children; child blocks hang off `empty` or `full` according to
`get_parent_payload_status`, computed from the bid hashes stored in the row.

### What the store does not own

The spec `Store` holds full `block_states` and `checkpoint_states`; a client cannot.
The boundary:

- `onBlock(block, root, post_state, execution_status)` reads the post-state once
  (checkpoints, unrealized checkpoints, payload attestations) and does not keep it.
  `execution_status` is the engine's `newPayload` verdict; an `invalid` one never
  reaches `onBlock`, it goes to `onPayloadInvalid`. `onBlockSummary` takes the same
  facts without a state, for callers that already have them.
- `onAttestation(indexed, is_from_block)` expects the caller to have indexed and
  verified the attestation against the target checkpoint state; every
  `validate_on_attestation` check runs in the store. A vote whose slot is not yet past
  is queued and applied by the tick that makes it past, as proto-array does for
  same-slot gossip; `validateOnAttestation` keeps the spec's rejection for callers
  that want it, and the spec runner uses it.
- `onAttesterSlashing` expects both indexed attestations verified against the
  justified state; the slashable-data check and the intersection run in the store.
- `onPayloadAttestationMessage` takes the PTC of the attested block's state;
  signature verification is the caller's job.
- `onExecutionPayloadEnvelope` takes a verified envelope's block root, the engine's
  verdict on its payload and, for heze, the inclusion-list verdict.
- `executionStatus(node)` and `isOptimistic(node)` answer from the head cache, for
  `execution_optimistic` in API responses and for block production.
- `StateProvider` supplies justified balances and, for `is_head_weak` with
  equivocators, the beacon committee members of a slot.

### Pruning

The spec never drops blocks. `prune` drops everything that is not the finalized block
or one of its descendants, compacts the table, remaps block indices in latest messages
and keeps a pruned vote's slot so the spec's replacement rule still holds. The spec
runner calls it once at the end of every vector and checks that the head stays put.

## Comparison with the TypeScript proto-array

| Aspect                              | TypeScript                                                  | Zig                                                                       | Risk when switching             |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| Vote storage                        | current + next node index, next slot                        | one latest message (slot, block, payload flag)                            | low: same replacement rule      |
| Future-slot attestations            | queued in fork choice, applied on tick                      | queued per validator, applied on tick                                     | low: same rule, unit tests      |
| Head weights                        | cached per node, delta-updated                              | recomputed per call                                                       | low: 506 vectors agree          |
| Equivocators                        | sorted array walked in `computeDeltas`                      | bitset check skips the vote                                               | low                             |
| Proposer boost                      | previous and current boost deltas                           | path marked each pass                                                     | low                             |
| Prune                               | threshold, slices node array                                | compacts rows, remaps messages                                            | low                             |
| Optimistic sync                     | execution status per node, `validateLatestHash`             | verdict per payload, node status derived                                  | low: 5 sync vectors, unit tests |
| Fast confirmation                   | in the package                                              | absent                                                                    | medium, separate spec           |
| `should_override_forkchoice_update` | implemented                                                 | omitted, removed from the spec                                            | low, see Deviations             |
| Beacon states                       | `stateGetter` inside the store                              | `StateProvider`, balances and committees only                             | low                             |
| Slot component timing               | rounds                                                      | floors, as the spec does                                                  | low, 1 ms, no vector hits it    |
| Test coverage                       | vectors, nightly compliance vectors, unit tests, production | 506 minimal + 256 mainnet vectors, 10311 compliance vectors, 5 unit tests | blocking: no production time    |

## Benchmarks

Same machine (Apple Silicon), sequential idle runs, 2026-11-05. TS via Node 24.22.1
and tsx; Zig 0.16 native. The "Zig proto-array" column is the implementation this
rewrite replaced, rebuilt at commit `0586e6e617` with the same scenarios.

| Case                         | TS proto-array | Zig proto-array (old) | Zig store (new) | TS to new | Old Zig to new |
| ---------------------------- | -------------: | --------------------: | --------------: | --------: | -------------: |
| getHead vc 100k, bc 64       |       0.464 ms |              0.136 ms |        0.124 ms |      3.7x |          1.10x |
| getHead vc 600k, bc 64       |       2.706 ms |              0.808 ms |        0.748 ms |      3.6x |          1.08x |
| getHead vc 1M, bc 64         |       4.555 ms |              1.381 ms |        1.246 ms |      3.7x |          1.11x |
| getHead vc 600k, bc 320      |       2.815 ms |              0.834 ms |        0.773 ms |      3.6x |          1.08x |
| getHead vc 600k, bc 1200     |       2.905 ms |              0.848 ms |        0.759 ms |      3.8x |          1.12x |
| getHead vc 600k, bc 7200     |       3.190 ms |              0.903 ms |        0.784 ms |      4.1x |          1.15x |
| getHead eq 1k                |       3.069 ms |              0.935 ms |        0.745 ms |      4.1x |          1.26x |
| getHead eq 10k               |       3.162 ms |              0.837 ms |        0.740 ms |      4.3x |          1.13x |
| getHead eq 300k              |       5.822 ms |              0.952 ms |        0.580 ms |     10.0x |          1.64x |
| getHead gloas boosted        |       3.036 ms |                   n/a |        0.805 ms |      3.8x |            n/a |
| onAttestation, 1109 per slot |       4.116 ms |              0.876 ms |        0.505 ms |      8.2x |          1.73x |

ReleaseSafe adds about 45 percent on the head cases (1.096 ms at 600k validators)
and 6 percent on attestations.

Reading the three columns:

- TS to old Zig is the language: 3.3 to 3.5x on every head case with the same
  proto-array algorithm on both sides.
- Old Zig to new Zig is the design: 5 to 8 percent on the common cases. Both sides do
  the same O(validators) scan, so no algorithmic win was available. The design buys
  simplicity, not speed.
- Equivocators are the one place the design shows: proto-array walks a sorted list
  beside the vote scan and slows down as it grows; the bitset check gets faster.
- The onAttestation gain over old Zig is design: no validation cache, hex conversion
  or vote-slot indirection. Both Zig benches hash the attestation data, as TS does.

Fixtures differ in a way that favours TS: the TS fixture never ticks its clock, so
viability short-circuits on the genesis epoch, while the Zig fixture ticks to the chain
tip and runs a chain that justifies every epoch. The old Zig bench flipped votes inside
the timed region, so its true numbers are a few percent better than shown.

Run with:

```
zig build run:bench_fork_choice_update_head -Doptimize=ReleaseFast
zig build run:bench_fork_choice_on_attestation -Doptimize=ReleaseFast
```

## Deviations from the spec

- `should_override_forkchoice_update` is not ported. Lodestar's TS store still has it
  and `importBlock` uses it to skip the engine's `forkchoiceUpdated` for a weak head
  when a local validator proposes next, so the execution layer builds on the parent.
  The rule existed because an execution layer could ignore a `forkchoiceUpdated` whose
  head was an ancestor of its canonical head, which a reorg target always is.
  [execution-apis #786](https://github.com/ethereum/execution-apis/pull/786) narrowed
  that to ancestors of the finalized block, which a reorg target never is, so
  `get_proposer_head` at proposal time is enough; [consensus-specs #5174](https://github.com/ethereum/consensus-specs/pull/5174)
  removed the rule and its tests, and v1.7.0-beta.4 no longer has it. Pairing with an
  execution layer that predates #786 is a beacon node policy decision, not a fork
  choice rule.

- `getAncestor` stops at the parentless anchor instead of failing as the spec's dict
  lookup would. Harmless for anchors at epoch boundaries.
- Slot component durations use the spec's floor division. `BeaconConfig.getSlotComponentDurationMs`
  rounds; the two disagree by at most one millisecond.
- The spec store never prunes, so the runner prunes only after the last step of a
  vector, where the head must not move. Pruning mid-vector rejected block attestations
  for dropped branches that the spec still accepts.
- A valid block's own attestations and attester slashings may fail in the compliance
  vectors; the generator suppresses those faults and so does the runner, but only for
  the `fork_choice_compliance` runner. The regular `fork_choice` vectors stay strict.
- `validate_merge_block` is not rerun when a merge block turns `valid`, and
  `on_merge_block` is not implemented, as in proto-array.
- The sync vectors model an `INVALID` verdict as a rejected block whose ancestors are
  invalidated, which is what the runner does; pyspec's model keeps the block in its
  store and filters it at head time. Both give the same head.

## Tests

```
zig build test:fork_choice
zig build run:write_spec_tests
zig build test:spec_tests -Dpreset=minimal "-Dspec_tests.filters=fork_choice"
zig build test:spec_tests -Dpreset=mainnet "-Dspec_tests.filters=fork_choice"
```

Results at v1.7.0-beta.4: minimal 506 pass, 0 fail, 24 skip; mainnet 256 pass,
0 fail, 274 skip. Skips are vectors absent from that preset plus eight cases that
need KZG proof verification (deneb `invalid_incorrect_proof`, fulu
`on_block_peerdas__invalid_wrong_{column,commitment,proof}`), for which the Zig
build has no binding. `bellatrix/on_merge_block` (needs `get_pow_block`) is not
generated, as in the TypeScript harness.

The optimistic sync vectors (`sync/optimistic`, bellatrix through fulu, one case per
fork) run through the same runner under the `sync` runner kind; the runner keeps the
`on_payload_info` verdicts and feeds them to `onBlock` and `onPayloadInvalid`:

```
zig build test:spec_tests -Dpreset=minimal "-Dspec_tests.filters=sync optimistic"
```

Results at v1.7.0-beta.4: 5 pass on minimal and 5 on mainnet. Gloas has no sync
vectors; its payload chain rules are covered by the unit tests.

The fork choice compliance vectors (`pnpm download-comptests`, extracted to
`test/spec/spec_tests/<version>/comptests/`) run through the same runner under the
`fork_choice_compliance` runner kind, one fork at a time:

```
zig build test:spec_tests -Dpreset=minimal "-Dspec_tests.filters=altair fork_choice_compliance"
```

Results at v1.7.0-beta.4, minimal: 1473 pass, 0 fail for each of altair, bellatrix,
capella, deneb, electra, fulu and gloas, about 20 minutes per fork in Debug.

On macOS 27 with Zig 0.16 the C++-linking test targets need
`-Dtarget=aarch64-macos.15.0`; CI on Linux does not.

## Before this can replace proto-array

1. Done: the fork choice compliance vectors pass on every fork (see Tests).
2. Done: execution status per payload and `onPayloadInvalid` (see Optimistic sync).
3. Done: votes for a slot not yet past are queued in the store and applied on tick.
4. Port the fast confirmation rule. `should_override_forkchoice_update` is omitted on
   purpose (see Deviations).
5. Run the store in shadow mode behind a flag: it receives every event, logs each
   head mismatch against proto-array, decides nothing.
