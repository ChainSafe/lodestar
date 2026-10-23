# Decoupled Consensus (EIP-8453) prototype: status

Branch `decoupled-consensus`, rebuilt from `origin/unstable` at `782eaff74d` (23 October 2026). Spec implemented:
ethereum/consensus-specs branch `decoupled-consensus` at `d19f81cf6` (22 October 2026), the official EIP-8453
spec started by Justin Traglia on 20 October with Terence's validator guide merged on 21 October. The previous
prototype of Mikhail Kalinin's `dc-feature` spec (4 October) is kept as tag
`archive/dc-kalinin-dc-feature-2026-10-04`.

## Why the spec branch and not Prysm's bytes

Prysm's `decoupled-consensus` branch (Terence, 16 October) implements Francesco's Goldilocks + Simplex paper
directly on a Gloas state, with its own containers, domains, fork version and gossip topics. Lighthouse (Mark,
22 October) is building against the spec branch. The spec branch is where the three clients converge, and
Terence co-authors it, so Lodestar targets the spec. See `DC-ISSUES.md` for the concrete differences.

## Commits

| Commit       | Scope                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `88e7ff0f47` | params, config and SSZ types: `ForkName.eip8453` (seq 9), presets, domains, flag indices, types |
| `097fd19515` | state transition: helpers, block processing, height events, rounds, slashings, upgrade, tests   |

## What compiles

| Package          | `tsc` | Notes                                                                                |
| ---------------- | ----- | ------------------------------------------------------------------------------------ |
| params           | yes   |                                                                                      |
| config           | yes   |                                                                                      |
| types            | yes   | `typesByFork` uses per-fork `Merge` aliases to stay under the declaration emit limit |
| state-transition | yes   | including tests and perf tests                                                       |
| fork-choice      | yes   | untouched                                                                            |
| api              | no    | 16 errors                                                                            |
| validator        | no    | 3 errors                                                                             |
| beacon-node      | no    | 76 errors                                                                            |

The api, validator and beacon-node errors have one root cause. The EIP-8453 `Attestation`, `IndexedAttestation`,
`AttesterSlashing` and `BeaconState` shapes are not structural subtypes of the legacy ones, so the `ForkAll`
unions no longer have a common supertype and code such as `attestation.data.slot`, `state.finalizedCheckpoint.epoch`
or `body.attestations` stops type-checking. Inside state-transition the fix was to narrow legacy paths to
`Attestation<ForkPreEip8453>` and to read the finalized epoch through `getFinalizedEpoch(state)`; the same two
edits are what the remaining 95 sites need, plus `eip8453` arms in `Record<ForkName, ...>` literals.

## What is implemented

| Spec document                         | Lodestar                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beacon-chain.md` types & containers  | `packages/types/src/eip8453/sszTypes.ts`; hash tree roots pinned to the pyspec (minimal preset) in `packages/types/test/unit-minimal/eip8453/pyspecRoots.test.ts`                     |
| `beacon-chain.md` helpers             | `packages/state-transition/src/util/eip8453.ts`                                                                                                                                       |
| `process_slots`, `process_slot`       | `stateTransition.ts` (round before epoch), `slot/index.ts` (target root fill)                                                                                                         |
| `process_round`                       | `epoch/processRound.ts`: inactivity (virtual leak, ejection), rewards, participation flag carry-over                                                                                  |
| `process_epoch`                       | `epoch/index.ts` skips justification, inactivity, rewards and flag updates after EIP-8453; `processBuilderPendingPaymentsEip8453`; `processPtcWindow` uses the modified `compute_ptc` |
| `process_block`, `process_operations` | `block/index.ts`, `block/processOperations.ts`: head vote support checks, legacy slashings, FG attestations, head votes, `process_height_events` after the sync aggregate             |
| `process_attestation`                 | `block/processAttestationsEip8453.ts`                                                                                                                                                 |
| `process_head_vote`                   | `block/processHeadVote.ts`                                                                                                                                                            |
| `process_height_events`               | `block/processHeightEvents.ts`                                                                                                                                                        |
| attester slashings                    | `block/processAttesterSlashing.ts`: FG rules (`is_double_target_vote`, `is_conflicting_with_finality_pair`) and the legacy Casper FFG path                                            |
| `fork.md`                             | `slot/upgradeStateToEip8453.ts`                                                                                                                                                       |
| block signature sets                  | `signatureSets/index.ts`: FG attestations and slashings under `DOMAIN_FINALITY_ATTESTER`, head votes via a caller-supplied `getHeadVoteCommittee`                                     |
| `validator.md`                        | only `get_attestation_committee_assignment` (`getAttestationCommitteeAssignment`); duties, signing record and aggregation are not done                                                |
| `light-client/sync-protocol.md`       | not done (only `FINALIZED_ROOT_GINDEX_EIP8453` is defined and checked)                                                                                                                |

Not done, in order of need for a devnet: Goldilocks fork choice and AC locks (no spec text yet, Prysm's
`beacon-chain/forkchoice/decoupled` is the reference), gossip topics and validation, validator duties and the
finality signing record, block production, the beacon-node/api/validator compile fixes above, and `getBlockSignatureSets`
callers passing a head vote committee resolver.

## Tests

`pnpm vitest run --project unit-minimal packages/state-transition/test/unit-minimal/eip8453 packages/types/test/unit-minimal/eip8453`
from the repo root, plus `--project unit packages/types/test/unit/eip8453`.

| File                                                 | Tests | Covers                                                                                                                                                              |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-transition/.../eip8453/harness.ts`            |       | minimal-preset EIP-8453 genesis with interop keys; `vote()`, `headVote()`, `slashingAttestation()`, `produceBlock()` running the full state transition              |
| `heightEvents.test.ts`                               | 10    | target root fill, justify + pending + advance, partial quorum, finalization, timeouts after the delay, mixed quorum, below-height votes, rejections, one-time flags |
| `headVote.test.ts`                                   | 4     | same-slot seats recorded, votes for the parent ignored, partial committee, support bit rules, too recent / empty / bad signature                                    |
| `round.test.ts`                                      | 3     | round rewards and inactivity scores, progress carry-over across rounds, weight-based quorum                                                                         |
| `slashing.test.ts`                                   | 3     | double target vote, timeout vs finality lock, non-slashable pairs and bad signatures                                                                                |
| `helpers.test.ts`                                    | 5     | round arithmetic, committee partition and assignment, head vote / inclusion list committees, weight table, data predicates                                          |
| `upgrade.test.ts`                                    | 1     | heze to eip8453 upgrade field by field                                                                                                                              |
| `types/.../unit/eip8453/sszLayout.test.ts`           | 5     | spec gindex, surviving heze gindices, round trips, JSON field names                                                                                                 |
| `types/.../unit-minimal/eip8453/pyspecRoots.test.ts` | 3     | hash tree roots of default and non-trivial values equal the pyspec's                                                                                                |

The pyspec roots were produced with `make build` on the spec branch (needs uv >= 0.13.4) and the script kept in
the research workspace digest of 23 October 2026. Re-pin them whenever the spec branch changes a container.
