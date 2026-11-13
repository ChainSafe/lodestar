# Zig fork choice

Spec-driven rewrite of the beacon chain fork choice, written against
[consensus-specs v1.7.0-beta.4](https://github.com/ethereum/consensus-specs/tree/v1.7.0-beta.4/specs)
`fork-choice.md` for phase0 through heze, plus the fast confirmation rule from
`fast-confirmation.md`. This document records the design, how it
differs from the TypeScript proto-array in `packages/fork-choice`, the benchmarks,
and what is still missing. It stays here while the rewrite is under review;
`data_flow.html` next to it animates how each input moves through the store's arrays.

## Files

| File                               | Contents                                                                           | Spec functions                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.zig`                        | `Store`: the spec `Store` minus beacon states, every handler, optimistic sync      | `get_forkchoice_store`, `on_tick`, `on_block`, `on_attestation`, `on_attester_slashing`, `on_payload_attestation_message`, `on_execution_payload_envelope`, `get_ancestor`, `get_checkpoint_block`, `update_checkpoints`, `should_extend_payload`, `payload_timeliness`, `should_build_on_full` |
| `head.zig`                         | Head computation as array passes, persistent vote totals                           | `get_weight`, `filter_node_tree`, `get_head`, `get_supported_node`, `should_apply_proposer_boost`, `is_head_weak`, `is_parent_strong`                                                                                                                                                           |
| `proposer_head.zig`                | Proposer reorg helpers                                                             | `get_proposer_head` and its predicates                                                                                                                                                                                                                                                          |
| `vote_targets.zig`                 | Interned vote targets: the distinct latest messages and the node each counts on    | `get_supported_node` (cached per target)                                                                                                                                                                                                                                                        |
| `fast_confirmation.zig`            | Fast confirmation rule: the spec `FastConfirmationStore` and one run per slot      | `get_fast_confirmation_store`, `on_fast_confirmation`, `get_latest_confirmed`, `find_latest_confirmed_descendant`, `is_one_confirmed`, `is_confirmed_chain_safe`, the FFG helpers, `get_safe_execution_block_hash`                                                                              |
| `store_test.zig`                   | Unit tests on a real two-branch chain                                              |                                                                                                                                                                                                                                                                                                 |
| `test/spec/runner/fork_choice.zig` | Spec vector runner, plays the role of `block_states` and `checkpoint_states`       |                                                                                                                                                                                                                                                                                                 |
| `bench/fork_choice/`               | `getHead` and `onAttestation` benchmarks, including mainnet-shaped `getHead` cases |                                                                                                                                                                                                                                                                                                 |

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

Latest messages are a dense array indexed by validator holding 4-byte ids into
`vote_targets.zig`, a table of the distinct `LatestMessage`s. Hundreds of thousands
of validators vote alike, so an epoch adds a few hundred entries; each entry also
caches the node it counts on (`get_supported_node`). Queued votes, those whose slot
is not yet past, are a second id array of the same shape: the first vote of a slot
wins, as applying them in order at the next slot would, a vote for a later slot
replaces an earlier one, and each tick walks both arrays in lockstep applying what
became past. `prune` renumbers only the table's entries, never a validator's vote,
and the table compacts itself once it doubles, so it stays small without finality.
Equivocators are a bitset. Justified balances arrive through
a `StateProvider` callback when the justified checkpoint changes and are kept as raw
effective-balance increments plus an active-and-unslashed bitset.

Only the vote accounting is carried between calls: the per-node vote totals, the
target each validator's vote is counted on, and a bitset with a count of the
validators whose vote or weight changed since the last call. Weights, viability and
best children live in scratch arrays that every `getHead` rebuilds from those totals;
a `dirty` flag on the cache makes repeated reads free.

### Head computation

The spec's `get_weight` scans every latest message per node and `filter_node_tree`
recurses. `head.zig` produces every node's weight and viability at once:

1. Forward pass: the finalized-checkpoint ancestor of every block, via its parent.
2. Vote totals: each latest message of an active, unslashed, non-equivocating
   validator counts its balance on `get_supported_node`. The totals persist; a run
   moves only the votes of validators whose message changed or who equivocated since
   the last run, and a run with no changes skips the bitset entirely. New justified
   balances move only the weights that changed, and `prune` renumbers the counted
   nodes in place; neither recounts every vote. More than half the validators
   changing at once falls back to a full recount, which is then cheaper.
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
- For a client that never builds the SSZ objects: `onAttestationData` and
  `onAttesterSlashingData` take attestation data and attesting indices, the slashing
  ones sorted ascending; `onPtcVotes` takes resolved PTC positions;
  `recordInclusionListSatisfaction` takes an inclusion-list verdict reported apart from
  the envelope; `BlockSummary.arrival_ms_into_slot` judges timeliness by arrival
  instead of import time; `proposer_head.decide` names the first condition that keeps
  the head.
- `executionStatus(node)` and `isOptimistic(node)` answer from the head cache, for
  `execution_optimistic` in API responses and for block production.
- `StateProvider` supplies justified balances and, for `is_head_weak` with
  equivocators, the beacon committee members of a slot. Two optional hooks serve the
  fast confirmation rule: the balance source at a checkpoint and the pulled-up head
  state's. A caller that does not run the rule leaves them null.

### Fast confirmation

`FastConfirmation` holds the six spec `FastConfirmationStore` fields as roots and
checkpoints, so `prune` cannot invalidate them, and reads the `Store` passed to
`onFastConfirmation`. Each run resolves them to block indices once and keeps its
derived data in an arena:

- Per balance source (the previous and current observed justified checkpoints), one
  pass over `latest_votes` sums active, unslashed, non-equivocating balances per
  vote target, then a child-to-parent pass over the block array turns that into
  every block's `get_attestation_score`. `is_one_confirmed` then reads one number
  instead of scanning the validators for each block it checks.
- `get_current_target_score` sums the pulled-up head state's balances per vote
  target too and computes each target's checkpoint once, not once per validator.
- Committee membership is one byte per validator per epoch (the slot it attests
  in), built from the head state's shuffling only when a range query needs it:
  empty slots before a block or equivocators in the range.
- Loads are lazy: the previous balance source is only read at an epoch start, for
  reconfirmation, and the pulled-up head state only when an FFG check runs.

### Pruning

The spec never drops blocks. `prune` drops everything that is not the finalized block
or one of its descendants and compacts the block table. Votes hold target ids, so it
renumbers the blocks in the vote target table and the per-node vote totals, and never
touches a validator's vote. A target on a dropped block keeps its slot, so the spec's
replacement rule still holds, and stops counting. The spec runner calls `prune` once
at the end of every vector and checks that the head stays put.

## Comparison with the TypeScript proto-array

| Aspect                              | TypeScript                                                  | Zig                                                                        | Risk when switching             |
| ----------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| Vote storage                        | current + next node index, next slot                        | 4-byte id into a table of distinct (slot, block, payload flag) targets     | low: same replacement rule      |
| Future-slot attestations            | queued in fork choice, applied on tick                      | queued per validator, applied on tick                                      | low: same rule, unit tests      |
| Head weights                        | cached per node, deltas from a scan of every vote           | vote totals per node updated for changed votes only; tree passes per call  | low: 506 vectors agree          |
| Equivocators                        | sorted array walked in `computeDeltas`                      | bitset check skips the vote                                                | low                             |
| Proposer boost                      | previous and current boost deltas                           | path marked each pass                                                      | low                             |
| Prune                               | threshold, slices node array                                | compacts rows, renumbers the vote target table                             | low                             |
| Optimistic sync                     | execution status per node, `validateLatestHash`             | verdict per payload, node status derived                                   | low: 5 sync vectors, unit tests |
| Fast confirmation                   | in the package                                              | `fast_confirmation.zig`, scores per vote target folded up the block array  | low: 1431 vectors               |
| `should_override_forkchoice_update` | implemented                                                 | omitted, removed from the spec                                             | low, see Deviations             |
| Beacon states                       | `stateGetter` inside the store                              | `StateProvider`, balances and committees only                              | low                             |
| Slot component timing               | rounds                                                      | floors, as the spec does                                                   | low, 1 ms, no vector hits it    |
| Test coverage                       | vectors, nightly compliance vectors, unit tests, production | 506 minimal + 256 mainnet vectors, 10311 compliance vectors, 11 unit tests | blocking: no production time    |

## Benchmarks

The `getHead` workload that matters follows Lodestar's mainnet `computeDeltas`
metrics: about 2.43M validator indices of which about 838k vote, 2 to 3 head updates
per slot, one of them after the slot's ~25.3k new votes and the rest with none, and
about 80 blocks since finality. The `mainnet:` cases in `bench/fork_choice/update_head.zig`
model that, with the voters scattered over the index range and the changed votes
shuffled as committees are.

Apple Silicon, ReleaseFast, 2026-11-09:

| Case                                    | Time per `getHead` |
| --------------------------------------- | -----------------: |
| mainnet: slot start, 25.3k new votes    |         0.62 ms \* |
| mainnet: after block, 0 new votes       |          0.0006 ms |
| mainnet: full recount (fallback)        |             7.2 ms |
| vc 600k, bc 64, 1/32 of votes changed   |           0.115 ms |
| vc 1M, bc 64, 1/32 of votes changed     |           0.210 ms |
| vc 600k, bc 7200, 1/32 of votes changed |           0.168 ms |

\* includes writing the 25.3k votes, about 0.45 ms of it; `getHead` alone is about
0.37 ms.

The epoch events, measured separately on the same workload: the balance diff for
10k changed balances takes about 0.35 ms, `prune` about 0.007 ms, and the vote
target compaction (about every 40 epochs) about 3.5 ms.

A one-off comparison on the same workload with silver (`gattaca-com/silver`
`a467bc4`) and Lighthouse `proto_array` (`unstable` `eab341b`), using harnesses that
are not in this repository:

| Per epoch, 2.5 head updates per slot plus one balance change and one prune |     Time |
| -------------------------------------------------------------------------- | -------: |
| Zig store                                                                  | ~12.5 ms |
| silver                                                                     |   ~22 ms |
| Lighthouse                                                                 |  ~700 ms |

Lighthouse scans every vote on every head update, as proto-array does. silver, like
this store, moves only changed votes; it compacts its vote table on every prune.

During non-finality the passes over blocks grow by about 7 ns per block per
`getHead` (measured up to 7200 blocks), an estimated 1.5 ms after a month; silver's
apply pass grows the same way.

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

The fast confirmation vectors (`fast_confirmation`, minimal only, altair through heze)
run through the same runner: a `checks` step that reports `confirmed_root` follows the
generator's implicit `on_fast_confirmation`, so the runner calls it there first.

```
zig build test:spec_tests -Dpreset=minimal "-Dspec_tests.filters=fast_confirmation"
```

Results at v1.7.0-beta.4: 1431 pass, 0 fail, 8 skip. The skips are
`is_one_confirmed_fails_recently_activated_validator_voting_in_empty_slot` and
`is_one_confirmed_passes_with_new_validator_activated_in_head_state` on electra
through heze: they are generated with `@never_bls`, so their deposit carries the BLS
stub signature, which a spec-correct `process_pending_deposits` rejects.

On macOS 27 with Zig 0.16 the C++-linking test targets need
`-Dtarget=aarch64-macos.15.0`; CI on Linux does not.

## Before this can replace proto-array

1. Done: the fork choice compliance vectors pass on every fork (see Tests).
2. Done: execution status per payload and `onPayloadInvalid` (see Optimistic sync).
3. Done: votes for a slot not yet past are queued in the store and applied on tick.
4. Done: the fast confirmation rule (see Fast confirmation).
   `should_override_forkchoice_update` is omitted on purpose (see Deviations).
5. Run the store in shadow mode behind a flag: it receives every event, logs each
   head mismatch against proto-array, decides nothing.
