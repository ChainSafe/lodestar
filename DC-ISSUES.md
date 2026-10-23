# Decoupled Consensus (EIP-8453) prototype: issue log

Findings from implementing `specs/_features/eip8453/` of ethereum/consensus-specs branch
`decoupled-consensus` at `d19f81cf6` (22 October 2026) in Lodestar. Newest first. Cross-checked against
Terence's Prysm branch `OffchainLabs/prysm:decoupled-consensus` (head `dc4a41d281`, 16 October 2026),
which implements Francesco's Goldilocks + Simplex paper rather than this spec.

## Finality gadget weight sums do not fit a JS number beyond 2\*\*21 validators

- Where: `get_validator_weight`, `get_total_weight`, `has_quorum` / `packages/state-transition/src/util/eip8453.ts`
- Spec says: a validator's weight is `(E - s) * (E + s)` with `E = EJECTION_INACTIVITY_SCORE = 2**16`, so a fully
  active validator weighs `2**32` and the total of `n` validators is up to `n * 2**32`.
- Observed: `Number.MAX_SAFE_INTEGER` is `2**53 - 1`, so the sum is exact only for `n < 2**21` (2,097,152)
  validators. Lodestar accumulates in a number and throws past that bound rather than silently losing precision.
- Prysm: quorums are by key count, no weights.
- Question for the group: could the weight be expressed in units of `E` (i.e. `E - s**2 / E`, a 17-bit value per
  validator) so sums stay small, or is bigint arithmetic expected?
- Status: open (implementation bound documented)

## Prysm's wire format is not the spec's

- Where: Prysm `proto/prysm/v1alpha1/decoupled.proto` vs `specs/_features/eip8453/beacon-chain.md`
- Spec says: `Attestation` carries `committee_bits: AttestationCommitteeBits` over per-epoch attestation
  committees plus an unsigned `epoch`; blocks carry `head_votes` from a sampled head vote committee; the state
  drops the Casper FFG fields and adds `target_checkpoint`, `justified_checkpoint`, `finalized_checkpoint`
  (height checkpoints), `target_slot`, `finalized_slot`, three participation lists, `pending_finality` and
  `head_vote_participation`.
- Observed: Prysm (16 October) keeps the Gloas state and appends `height`, `entry`, `target_participation`,
  `progress`, `justified`, `finalized`, `pending_finality`; block attestations are `IndexedAttestationDecoupled`
  with explicit attesting indices and no committees; AC votes are `AvailableAttestation` bitlists over the whole
  registry; domains `0x0F`/`0x10`, fork version `0x10000000`, gossip topics `available_attestation` and
  `finality_attestation`. None of this matches the spec branch, so a Lodestar node built on the spec cannot
  exchange blocks or attestations with the current Prysm devnet image.
- Question for the group: when does Prysm rebase onto `decoupled-consensus`? Lighthouse (Mark, 22 October)
  targets the spec branch.
- Status: open (tracking)

## No fork choice, gossip or validator duty timing in the spec yet

- Where: `specs/_features/eip8453/validator.md` TODOs; no `fork-choice.md` or `p2p-interface.md`
- Spec says: the validator guide references "the AC voting procedure", "the applicable confirmation update",
  deadlines and gossip topics that are all marked TODO.
- Observed: Lodestar implements the beacon-chain and fork documents only. Goldilocks fork choice, AC locks, FG
  signing locks, gossip topics and duty scheduling have no spec text; Prysm's `beacon-chain/forkchoice/decoupled`
  and Terence's lock edge-case gists are the only references.
- Status: blocked on spec

## `process_attestation` recomputes committees per attestation from the epoch's active set

- Where: `get_attestation_committee`, `get_aggregate_participants`
- Spec says: committees are contiguous slices of `get_active_validator_indices(state, epoch)` rotated by `epoch`.
- Observed: for epochs other than the previous, current and next, Lodestar falls back to a full registry scan
  per attestation (`getActiveValidatorIndices`). Attestations may be as old as the finalized epoch, so a
  long-unfinalized chain could include attestations from many epochs back. The epoch cache should keep active
  index arrays per epoch over the inclusion window, or the spec could bound inclusion to a few epochs.
- Status: implementation note

## The empty finality pair is `HeightCheckpoint(height=0, root=Root())`

- Where: `is_well_formed_attestation_data`, `get_finality_vote`
- Spec says: `HeightCheckpoint.empty()` stands for an absent finality pair, and height 0 is also the height of
  the pre-fork finalized checkpoint (`upgrade_to_eip8453` sets `finalized_checkpoint.height = 0`).
- Observed: a finality vote for the height-0 checkpoint is indistinguishable from "no finality pair" only if
  its root is zero; the upgrade uses the real pre-fork finalized root, so `(0, root)` is a well-formed
  finality pair that `is_valid_attestation_data` only accepts if it is pending, which it never is. Harmless,
  but worth stating in the spec.
- Status: note
