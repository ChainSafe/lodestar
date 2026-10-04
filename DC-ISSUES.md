# Decoupled Consensus prototype: issue log

Findings from implementing `specs/_features/decoupled-consensus/beacon-chain.md`
(mkalinin/consensus-specs, branch `dc-feature`, commit `5c5d42ac4`, 2 October 2026)
in Lodestar. Newest first. Cross-checked against Francesco's `consensus.pdf`
(28 August 2026), Roberto Saltini's Lean 4 model (`lean/Spec/06_StateTransition.lean`)
and Terence's Prysm branch `OffchainLabs/prysm:decoupled-consensus` (head `bfd242e`).

## Activations stay gated on the frozen legacy `finalized_checkpoint`

- Where: `process_registry_updates` (unmodified) / `packages/state-transition/src/epoch/processRegistryUpdates.ts`,
  also `is_active_builder` in `process_execution_payload_bid`
- Spec says: `process_epoch` keeps calling the Electra `process_registry_updates`, whose
  `is_eligible_for_activation` compares against `state.finalized_checkpoint.epoch`. Nothing in the DC spec
  writes `finalized_checkpoint` after the fork; only `finalized_pair` and `finalized_slot` move.
- Observed: once the fork is active no validator can ever become eligible for activation, because the
  checkpoint epoch never advances. `process_pending_deposits` was switched to `finalized_slot` but
  `process_registry_updates` was not, and the Gloas builder activity check reads the same frozen epoch.
  Lodestar implements the spec as written, so a decoupled chain cannot activate new validators.
- Lean model / Prysm: the Lean model has no registry. Prysm's `ProcessRegistryUpdates` is not adapted either.
- Question for the group: should `is_eligible_for_activation` and `is_active_builder` read
  `compute_epoch_at_slot(state.finalized_slot)`, or should `finalized_checkpoint` be mirrored from the
  finalized pair?
- Status: open

## `process_block` is marked modified but not defined

- Where: `state_transition`, `process_operations(state, body, parent_slot)` /
  `packages/state-transition/src/block/index.ts`
- Spec says: `process_block(state, block)` carries a `[Modified in DC]` tag and `process_operations` takes a
  new `parent_slot` argument, but the spec has no `process_block` body showing where `parent_slot` comes from.
- Observed: Lodestar reuses the Gloas `process_block`, capturing `state.latest_block_header.slot` before
  `process_block_header` and passing it down, which is what the Gloas `process_attestation` needs too.
- Lean model / Prysm: Prysm threads `parentSlot` the same way.
- Question for the group: can the spec add the `process_block` body so the `parent_slot` source is explicit?
- Status: worked around (gloas parent slot)

## Committee membership can change between an attestation's creation and inclusion

- Where: `get_beacon_committee` / `packages/state-transition/src/util/decoupled.ts`
- Spec says: the committee pool is every validator with `exit_epoch > compute_epoch_at_slot(state.finalized_slot)`
  and committees are slices of that pool rotated by `round`.
- Observed: both inputs move while a round is open. The pool grows whenever `process_pending_deposits`
  appends validators at an epoch boundary (not yet active validators are counted, see the seat issue
  below), and it shrinks whenever `finalized_slot` advances past exit epochs, which can happen in any
  block. An attestation built against the old pool and included after the change decodes against a
  different committee, so previous-round attestations in particular can become invalid or, worse, attribute
  votes to the wrong validators. The design notes only discuss activation timing, not pool membership.
- Lean model / Prysm: the Lean model has a fixed validator set. Prysm's committee code follows the paper
  model and does not have this shape.
- Question for the group: should the pool be snapshotted per round (for example at the round start
  slot, or at the epoch of the round) so that `len(indices)` and the exit filter are stable for the whole
  inclusion window?
- Status: open

## `process_attestation` no longer checks the aggregation bits length

- Where: `process_attestation`, `is_valid_aggregation_bits` / `packages/state-transition/src/util/decoupled.ts`
- Spec says: the Electra `process_attestation` asserted `len(attestation.aggregation_bits) == sum(committee
lengths)`; the DC version only runs `is_valid_aggregation_bits`, which indexes into the bitlist.
- Observed: a bitlist longer than the committees is accepted with the trailing bits ignored, and a shorter
  one fails with an IndexError in the pyspec. Lodestar throws on a short bitlist and ignores extra bits to
  match the pyspec behavior.
- Lean model / Prysm: n/a
- Question for the group: is dropping the length equality intended?
- Status: open

## `AggregationBits` limit is smaller than a round-wide committee span

- Where: `Attestation.aggregation_bits` (`AggregationBits` unchanged from Gloas)
- Spec says: `AggregationBits` keeps the Gloas limit `MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT`
  (131072), while `committee_bits` can now select all `COMMITTEES_PER_ROUND` committees, whose combined
  length is the whole eligible validator set.
- Observed: an aggregate spanning more than about 12% of mainnet committees cannot be encoded even with few
  bits set. `MAX_VALIDATORS_PER_AGGREGATE` bounds attesting indices but not the bitlist length.
- Lean model / Prysm: n/a
- Question for the group: should `AggregationBits` become a `ProgressiveBitlist` with limit
  `VALIDATOR_REGISTRY_LIMIT`, or should aggregates be limited to a committee range?
- Status: open

## `available_chain_attestations` is unbounded in `process_operations`

- Where: `process_operations`, `BeaconBlockBody.available_chain_attestations` /
  `packages/types/src/decoupled/sszTypes.ts`
- Spec says: every other operation list has a `MAX_*` assertion; `available_chain_attestations` is a
  `ProgressiveList` with none.
- Observed: a block may carry any number of available chain attestations, each with up to
  `AVAILABLE_CHAIN_COMMITTEE_SIZE` indices and a signature to verify. Lodestar leaves the list unbounded.
- Lean model / Prysm: n/a
- Question for the group: what is the intended `MAX_AVAILABLE_CHAIN_ATTESTATIONS`?
- Status: open

## `is_valid_attestation_data` accepts mixed height pairs

- Where: `is_valid_attestation_data`
- Spec says: the target root must be one of `{Root(), target.root, justified.root}` and the target height one
  of `{EMPTY_HEIGHT, target.height, justified.height}`, checked independently; same for finalize.
- Observed: a pair such as `(justified.height, target.root)` passes validation, earns no participation flag
  and consumes block space. Covered by a harness case. Harmless for safety, but it is a free no-op vote.
- Lean model / Prysm: n/a
- Question for the group: none unless the no-op is undesired.
- Status: confirmed by code reading (note only)

## Epoch participation now rotates every round

- Where: `process_round`, `process_participation_flag_updates` [Modified in DC]
- Spec says: `process_participation_flag_updates` rotates both the epoch and the round participation arrays
  and is called from `process_round`; `process_epoch` no longer calls it.
- Observed: `previous_epoch_participation` and `current_epoch_participation` are rotated at every round
  boundary and nothing writes them any more. Lodestar implements this as written.
- Lean model / Prysm: n/a
- Question for the group: are the epoch participation arrays meant to be removed (the TODO says "Cleanup
  BeaconState")?
- Status: confirmed by code reading (note only)

## Finality flag is set even when the justified pair is already finalized

- Where: `get_height_participation_flag_indices`
- Spec says: `FINALITY_FLAG_INDEX` is set whenever `data.finalize_pair == justified_pair`.
- Observed: the Lean model only sets `finalize[i]` when `h_j > h_F`. In the spec the extra flags are dead
  weight until the next justification resets them, and finalization itself still requires
  `justified.height > finalized.height`, so no behavior differs. Noted as a divergence only.
- Lean model / Prysm: Lean `processAttestation` guards on `σ.h_j > σ.h_F`.
- Question for the group: none.
- Status: confirmed by code reading (note only)

## Genesis height pairs have no block root to point at

- Where: `util/genesis.ts` initialization at the decoupled fork
- Spec says: nothing, there is no genesis or fork transition in the spec.
- Observed: the Lean initial state has `L = T_h = J = F = B_gen`. At genesis the block root is not known
  until the first `process_slot`, so Lodestar defers the height-1 target root like `advance_height` does
  and leaves the height-0 justified and finalized pairs with a zero root. A zero-root height-0 pair is
  indistinguishable from an "empty" finalize vote at height 0, which is harmless because justified and
  finalized coincide at genesis.
- Lean model / Prysm: Prysm's upgrade hashes `latest_block_header` directly, which is valid at an epoch
  boundary but not for a genesis state.
- Question for the group: none until the fork transition is specified.
- Status: worked around

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
  before the progress quorum check. The Lean model has no delay in its state transition at all:
  `processHeightEvents` fires the progress event on any quorum, and the two-round wait lives on the
  validator side (`08_FinalityVote.lean` only emits an empty-target vote when the healing layer offers no
  fresh grade-2 quorum). So the three sources place the guard in three different spots: paper and Lean in
  the voting rule, Prysm in the state transition, the spec nowhere.
- Question for the group: should the delay be a state-transition rule (so faulty early timeouts cannot
  advance the height) or only a validator rule as in the paper?
- Status: fixed, pending spec update

## Deferred target root

- Where: `advance_height` / `packages/state-transition/src/block/processHeightEvents.ts`,
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
