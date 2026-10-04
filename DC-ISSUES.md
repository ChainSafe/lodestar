# Decoupled Consensus prototype: issue log

Findings from implementing `specs/_features/decoupled-consensus/beacon-chain.md`
(mkalinin/consensus-specs, branch `dc-feature`, commit `5c5d42ac4`, 2 October 2026)
in Lodestar. Newest first. Cross-checked against Francesco's `consensus.pdf`
(28 August 2026), Roberto Saltini's Lean 4 model (`lean/Spec/06_StateTransition.lean`)
and Terence's Prysm branch `OffchainLabs/prysm:decoupled-consensus` (head `bfd242e`).

## `Height` sentinel encoding

- Where: `EMPTY_HEIGHT` / `packages/params/src/index.ts`, `packages/types/src/decoupled/sszTypes.ts`
- Spec says: `EMPTY_HEIGHT = Uint64(2**64 - 1)`.
- Observed: Lodestar represents `Height` as `UintNumInf64`, the same clipping number type used
  for `Epoch` with `FAR_FUTURE_EPOCH = Infinity`, so `EMPTY_HEIGHT` is `Infinity` in code and
  serializes to `2**64 - 1`. Heights are otherwise small integers, so this is safe.
- Lean model / Prysm: Prysm uses `math.MaxUint64` directly.
- Question for the group: none.
- Status: worked around (Lodestar convention, no behavior difference)

## Parent fork is heze, not gloas

- Where: `ForkSeq.decoupled = 9` / `packages/params/src/forkName.ts`, `packages/types/src/decoupled/sszTypes.ts`
- Spec says: the feature spec is written against Gloas; `process_pending_deposits` cites Gloas churn.
- Observed: Lodestar already has heze at sequence 8, so decoupled inherits heze types. Heze adds no
  fields to `BeaconState` or `BeaconBlockBody`, so the 56 and 15 active-field counts match the spec,
  but heze widens `ExecutionPayloadBid` with `inclusion_list_bits`. `latest_execution_payload_bid`
  and `signed_execution_payload_bid` therefore hash differently from the pyspec until the spec is
  rebased onto heze.
- Lean model / Prysm: Prysm places Decoupled directly after Gloas and has no heze at all.
- Question for the group: none (NC decided after-heze is correct for Lodestar).
- Status: worked around (documented root divergence)

## `DC_FORK_EPOCH` is referenced but never defined

- Where: `process_builder_pending_payments` / `packages/config/src/chainConfig/types.ts`
- Spec says: `if get_previous_epoch(state) < DC_FORK_EPOCH:` chooses the Gloas weight path for the
  epoch that straddles the fork. The Configuration section of the spec is empty.
- Observed: Lodestar defines `DECOUPLED_FORK_VERSION` and `DECOUPLED_FORK_EPOCH` following the
  `HEZE_*` naming, far-future on mainnet and minimal (`0x09000000` / `0x09000001`), and uses
  `DECOUPLED_FORK_EPOCH` where the spec says `DC_FORK_EPOCH`.
- Lean model / Prysm: Prysm defines `DECOUPLED_FORK_VERSION` and `DECOUPLED_FORK_EPOCH` as well.
- Question for the group: should the Configuration section define `DC_FORK_VERSION` / `DC_FORK_EPOCH`,
  or follow the `DECOUPLED_` naming both clients ended up with?
- Status: worked around (named `DECOUPLED_FORK_EPOCH`)

## No minimal preset values

- Where: Presets / `packages/params/src/presets/minimal.ts`
- Spec says: only mainnet values: `SLOTS_PER_ROUND = 8`, `COMMITTEES_PER_ROUND = 2048`,
  `MAX_VALIDATORS_PER_AGGREGATE = 2**17`, `AVAILABLE_CHAIN_COMMITTEE_SIZE = 1024`.
- Observed: Lodestar minimal uses `SLOTS_PER_ROUND = 4` (must divide minimal `SLOTS_PER_EPOCH = 8`;
  two rounds per epoch so round and epoch boundaries interleave in tests), `COMMITTEES_PER_ROUND = 16`
  (mainnet / 128, which keeps the mainnet ratio to `MAX_COMMITTEES_PER_SLOT * SLOTS_PER_EPOCH`),
  `MAX_VALIDATORS_PER_AGGREGATE = 8192` (`MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT`,
  the same identity mainnet satisfies, so it matches the existing `AttestingIndices` limit),
  `AVAILABLE_CHAIN_COMMITTEE_SIZE = 8`.
- Lean model / Prysm: Prysm has no minimal preset for these either.
- Question for the group: can the spec ship a `presets/minimal/decoupled.yaml` so clients agree?
- Status: worked around (values chosen locally)

## Timeout delay on progress-based advancement

- Where: `process_height_events` / `TIMEOUT_DELAY_ROUNDS` in `packages/params/src/presets/*.ts`
- Spec says: the progress event advances the height as soon as a progress quorum exists.
- Observed: the paper (§6.1, δ_t = 2R) and the Lean model delay timeout-based advancement by two
  rounds, otherwise faulty validators can combine with a partial honest target quorum to advance
  early. Francesco confirmed the delay is needed (Fast Finality Telegram, 2 October). Lodestar adds
  `TIMEOUT_DELAY_ROUNDS = 2` (mainnet and minimal) and skips the progress event until
  `state.slot >= state.target_slot + TIMEOUT_DELAY_ROUNDS * SLOTS_PER_ROUND`. The harness carries the
  early-advance scenario with the guard on and off.
- Lean model / Prysm: Prysm has `TimeoutDelayRounds` in config, applied in `ProcessHeightEvents`
  before the progress quorum check.
- Question for the group: none, awaiting spec update.
- Status: fixed, pending spec update

## Deferred target root

- Where: `advance_height` / `packages/state-transition/src/epoch/processHeightEvents.ts`,
  `packages/state-transition/src/slot/index.ts`
- Spec says: `state.target_pair.root = hash_tree_root(state.latest_block_header)` inside
  `advance_height`, which `process_height_events` calls after `process_block`.
- Observed: at that point `latest_block_header.state_root` is still zero, so the root does not equal
  the block root. Lodestar writes a zero root in `advance_height` and fills it in during
  `process_slot` when `latest_block_header.slot == target_slot` and the stored root is still zero.
- Lean model / Prysm: Prysm writes an empty root in `advanceHeight` and fills it in
  `FillHeightTargetRoot` during the next `process_slot`.
- Question for the group: none, awaiting spec update.
- Status: fixed, pending spec update

## No nonjustifiable heights

- Where: `process_height_events`
- Spec says: nothing about nonjustifiable heights.
- Observed: implemented as written.
- Lean model / Prysm: both have nonjustifiable heights (`nj`, constants `K` and `D`; Prysm's
  `KNonjustifiable` and `FinalityDebtThreshold`).
- Question for the group: is the omission deliberate for this spec iteration?
- Status: confirmed by code reading

## Progress vote is bound to a height only

- Where: `AttestationData2`
- Spec says: an empty target (`root = Root()`, `height = state.target_pair.height`) is the progress vote.
- Observed: implemented as written. Francesco said on 2 October that timeouts must be bound to a
  target as well; the spec container has no field for it.
- Lean model / Prysm: Prysm's `AttestationDataDecoupled` has a `timeout` flag next to a named target.
- Question for the group: will `AttestationData2` gain a target binding for timeouts?
- Status: confirmed by code reading

## `get_beacon_committee` seats validators that have not activated

- Where: `get_beacon_committee`, `is_valid_aggregation_bits`
- Spec says: the committee filters only on `exit_epoch > finalized_epoch`;
  `is_valid_aggregation_bits` rejects attesters that are not active in the current epoch.
- Observed: seats held by not-yet-active validators can never be set, so they are dead weight in the
  rotation. Implemented as written.
- Lean model / Prysm: n/a
- Question for the group: is seating inactive validators intended, or should the filter also
  require `activation_epoch <= finalized_epoch`?
- Status: confirmed by code reading

## `AttestationData2` carries no fork-choice information

- Where: `AttestationData2`
- Spec says: the container has `round`, `finalize_pair`, `target_pair` only.
- Observed: finality votes carry no slot, head or safe-block root. The design notes say committees are
  no longer a security unit and the FG vote is deliberately fork-choice-blind, so this is intended.
- Lean model / Prysm: Prysm's container carries slot and head root.
- Question for the group: none.
- Status: confirmed by code reading (note only)

## No fork transition in the spec

- Where: `upgrade_to_decoupled` (missing) / `packages/state-transition/src/slot/upgradeStateToDecoupled.ts`
- Spec says: the TODO list marks fork transition as not done.
- Observed: Lodestar writes a best-effort upgrade from heze following the Lean model's initial state:
  target pair at height 1 pointing at the fork's latest block, justified and finalized pairs at
  height 0 pointing at the pre-fork justified and finalized checkpoint roots, slots derived from those
  checkpoint epochs, all participation arrays zero.
- Lean model / Prysm: Prysm's `UpgradeToDecoupled` additionally settles the final Gloas epoch's
  inactivity scores and rewards on a copy of the pre-state before building the new state.
- Question for the group: none until the spec defines the transition.
- Status: worked around (best-effort upgrade)
