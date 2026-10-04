# Decoupled Consensus prototype: status

Branch `decoupled-consensus`, created from `origin/unstable` at `1bf214377e` (3 October 2026). Local only,
nothing pushed. Spec commit implemented: mkalinin/consensus-specs `dc-feature` at `5c5d42ac4`.

## Commits

| Commit       | Scope                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| `3519dcbad3` | params and config: `ForkName.decoupled` (seq 9), presets, domains, flag indices, fork epoch |
| `1c74b1374f` | SSZ types in `packages/types/src/decoupled`, round-trip tests                               |
| `aaf9019071` | state transition: helpers, block processing, height events, rounds, epoch, upgrade          |
| `7201bb2258` | scripted-votes harness and unit tests                                                       |

## What compiles

| Package          | `tsc` | Notes                                                                                |
| ---------------- | ----- | ------------------------------------------------------------------------------------ |
| params           | yes   |                                                                                      |
| config           | yes   |                                                                                      |
| types            | yes   | `typesByFork` needed named per-fork aliases to stay under the declaration emit limit |
| state-transition | yes   | including tests                                                                      |
| fork-choice      | yes   | untouched                                                                            |
| api              | no    | 13 errors                                                                            |
| validator        | no    | 9 errors                                                                             |
| beacon-node      | no    | 59 errors (7 of them are a stale `getBuilderPendingPayments` api lib, unrelated)     |

The api, validator and beacon-node errors all have one root cause. The decoupled `Attestation` value type
(`data: AttestationData2`) is not a structural subtype of the legacy one, and that shape propagates through
`BeaconBlockBody.attestations` into every `SignedBeaconBlock<ForkAll>` and `Attestation<ForkAll>` union.
Every fork so far only added fields, so those unions always had a common supertype and code such as
`attestation.data.slot` or `WithVersion((fork) => ssz[fork].SignedBeaconBlock)` type-checked by accident.
With decoupled in the union that stops. Inside state-transition the fix was to narrow the legacy paths to
`Attestation<ForkPreDecoupled>`, which is what the remaining 81 sites need too, plus `decoupled` arms in a
dozen `Record<ForkName, ...>` literals (mostly tests). I tried the alternative of defaulting the type aliases
to `ForkPreDecoupled` and it made things worse (112 errors), so it is not a shortcut. These edits are
mechanical but touch attestation pools, block import and the API codecs, so I stopped before them per the
brief's "skip beacon-node unless the build forces" rule and left the decision to you.

Not done from the heze checklist, deliberately: beacon-node api constants, gossip topics, spec test
iterators, `produceBlockBody`, `specrefs/` (ethspecify tracks the pinned release, not a feature branch).

## Tests

All new tests live under `packages/state-transition/test/unit-minimal/decoupled/` and run with
`pnpm vitest run --project unit-minimal test/unit-minimal/decoupled` from the package. The repo's `unit`
project runs the mainnet preset; the brief's `test/unit/decoupled/` location would have put the
committee-sized harness on 2048 committees and a 1024-seat available chain committee, which is the case the
vitest config itself says belongs in `unit-minimal`.

| File                                                      | Tests | Covers                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.ts`                                              |       | genesis state with real interop BLS keys, `vote()`, `produceBlock()`, snapshots                                                                                                                                                                                                                                                                      |
| `heightEvents.test.ts`                                    | 14    | target quorum justifies and advances, partial quorum, finality quorum, finality without advance, progress with and without the timeout guard, early-advance 30 faulty / 40 honest of 100, previous-height votes in round participation only, previous-round window, stale round rejected, round rotation, empty pair rejected, wrong domain rejected |
| `slashing.test.ts`                                        | 8     | E1, E2, order independence, non-slashable pairs, no intersection, bad signature, slashed validators excluded from quorums                                                                                                                                                                                                                            |
| `availableChain.test.ts`                                  | 6     | same-slot EMPTY vote records payment participation, dedup, FULL on same slot rejected, skipped slot FULL ok and PENDING rejected, outsider and too-early rejected, epoch shift                                                                                                                                                                       |
| `helpers.test.ts`                                         | 24    | round arithmetic, `remove_flag`, `is_slashable_attestation_data_2` table, flag indices, committee partition and rotation, exit filter, `has_quorum`, `is_valid_attestation_data` including the mixed-pair no-op, balance-weighted selection against the gloas sampler                                                                                |
| `upgrade.test.ts`                                         | 1     | heze to decoupled upgrade field by field                                                                                                                                                                                                                                                                                                             |
| `packages/types/test/unit/decoupled/sszRoundTrip.test.ts` | 14    | every new container, the gapped `Attestation` gindices, state and body field counts                                                                                                                                                                                                                                                                  |

All 67 pass. Existing targeted tests still pass: state-transition `upgradeState`, `block/`, `epoch/`,
`slot/`, `util/gloas`, `util/seed`, `sanityCheck` (68 tests), params and config unit suites. Spec tests
were not run; there are no DC vectors and the release vectors do not exercise the new fork.

## Deliberate deviations (both on by default)

1. Deferred target root: `advanceHeight` writes a zero root, `fillHeightTargetRoot` fills it in
   `processSlot` when `latest_block_header.slot == target_slot`. Genesis uses the same path.
2. `TIMEOUT_DELAY_ROUNDS = 2`: `processHeightEvents` skips the progress event until
   `state.slot >= target_slot + 2 * SLOTS_PER_ROUND`. The harness passes `timeoutDelayRounds: 0` to disable
   it for the early-advance comparison.

## Issue log

21 entries in `DC-ISSUES.md`.

| Status                     | Count |
| -------------------------- | ----- |
| open                       | 5     |
| worked around              | 7     |
| fixed, pending spec update | 2     |
| confirmed by code reading  | 7     |

The five open items are new findings from implementation, in order of how much I think they matter:
activations gated on the frozen legacy `finalized_checkpoint` (no validator can ever activate after the
fork), committee membership moving within the inclusion window, the dropped aggregation bits length check,
the `AggregationBits` limit versus a round-wide committee span, and the unbounded
`available_chain_attestations` list. The timeout entry also records that paper, Lean, Prysm and the spec
put the delay in three different places.

## Housekeeping

Your untracked NOTE files and VPN configs are in `stash@{0}` ("pre-decoupled-consensus untracked notes and
configs"). `git stash pop` restores them. The Prysm reference branch is fetched as
`offchainlabs/decoupled-consensus` in `~/Documents/prysm`.

## Single next step

Decide how to handle the 81 api, validator and beacon-node type errors. My recommendation is the narrow fix:
`Attestation<ForkPreDecoupled>` at the attestation sites, explicit generics at the two `WithVersion` block
codecs, and `decoupled` arms in the `Record<ForkName, ...>` literals, with a `throw` for decoupled in the
attestation pools since nothing produces those attestations yet. Roughly two hours, no behavior change for
existing forks. Until then `pnpm build` fails past state-transition, so the branch is a state-transition
prototype only.
