# Goldilocks implementation and simulation roadmap

## Authority and scope

Primary specification: **Goldilocks**, `fgsa-spec.pdf`, 14 pages, identified by its hash:

SHA-256: `0b501a148734e803bd481ab566d65a78956c03ab3084183d7b5c1fffbebdd8ba`

Page and figure numbers below refer to that artifact. It is external to this checkout. Obtain a
shareable source before requiring other contributors to reproduce the specification review.

The older Goldilocks presentation, Goldfish paper, Lean model, and client implementations are
comparison material, not authorities that override this specification. Ethereum-specific sampling,
stake weighting, registry changes, and production integration are separate extensions.

The base model has a fixed validator set, unit weights, and `K_s = V` in every slot. Keep all time,
message delivery, authentication results, proposer assignments, and restart events explicit inputs.
The protocol engine must not depend on a real clock, transport, random source, or fault policy.

## Target

The module is meant to become the whole consensus node, with the same `Node` under the simulator
and in the client ([DESIGN.md](./DESIGN.md), 2026-11-17). The base model below is the starting
point, not the limit of scope.

Gaps between the current module and that target, from the 2026-11-08 and 2026-11-17 reviews. None
is scheduled yet:

- **State transition:** use upstream Lodestar's Zig state transition as the production
  `StateSource` once it has the Goldilocks fork. Weights and proposer assignment then come from
  the state instead of `Signer`. This workspace must first move onto Lodestar's `src/`.
- **Crash and restart:** sleep keeps the whole `Node` in memory, and only the signing record goes
  through `Storage`. Model a crash that drops the `Node`, loses unsynced writes, and rebuilds from
  `Storage`.
- **Client-visible checks:** make the cluster checks read a per-tick history of each node's
  finalized, confirmed and head roots, not `node.fg` and `node.ac` fields.
- **Wire encoding:** the transport passes Zig structs by pointer, so no codec runs in simulation.
  Carry encoded messages once the wire types exist.
- **Slow dependencies:** `StateSource.transition` and `Storage.persist` are synchronous. Turn each
  into a request plus a completion delivered on a later tick, so the simulator can delay them.
- **Model limits:** unit weights, fixed storage bounds without pruning, tick time, and no
  payload-status or execution-status nodes.
- **Query surface:** head, ancestry, canonical-block and pruning queries that the rest of a client
  reads.

## Current module

| Component                                                  | Status                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ac/available_chain.zig` and sibling tests                 | Section 3 AC, all nine interface calls, moving-frame tests                                   |
| `ac/VoteSet.zig` and sibling tests                         | Derived vote/support storage used by the AC                                                  |
| `fg/FinalityGadget.zig` and sibling tests                  | Owned accepted blocks, block summaries, caches, and real frames                              |
| `fg/AttestationPool.zig` and sibling tests                 | Ordered deduplicated pool and proposal selection                                             |
| `fg/FinalityFrame.zig` and sibling tests                   | Borrowed FG projection and domain-local viability                                            |
| `fg/ChainState.zig` and sibling tests                      | Figure 5 block transition and height events                                                  |
| `fg/SigningRecord.zig` and sibling tests                   | Figure 4 validator client and durable record rules                                           |
| `fg/finality_types.zig` and sibling tests                  | FG parameters, attestation shape, full block inputs, and references                          |
| `Node.zig`                                                 | Shared coordinator, generic over Clock, Transport, Storage, Signer, and StateSource          |
| `testing/Simulator.zig`                                    | Seeded clock, bounded network, scripts, replay, cross-node checks, and the seeded fuzz plan  |
| `testing/{Clock,Transport,Storage,Signer,StateSource}.zig` | Concrete simulation dependencies; StateSource runs ChainState per block                      |
| `testing/simulator_test.zig`                               | Composed scenarios: progress, stalls, recovery, scripted faults, checks, and fuzz sweeps     |
| `testing/Hash.zig`                                         | Comptime semantic hashing, not native-memory or production wire encoding                     |
| `testing/determinism.zig` and sibling tests                | Fails the build when node code reads a clock, randomness, threads, I/O or a hash map         |
| `roguestar.zig`                                            | Roguestar, the seeded executable: every knob an option, swarm defaults, `--sweep` over seeds |
| `types.zig`                                                | Shared roots, time, slot, validator index, and vote tuple                                    |
| `limits.zig`                                               | Explicit supported-run storage bounds                                                        |
| `root.zig`                                                 | Public exports and test collection                                                           |

See [NODE.md](./NODE.md), [ac/README.md](./ac/README.md), [fg/README.md](./fg/README.md), and
[testing/README.md](./testing/README.md) for APIs, source mappings, bounds, and coverage.
[DESIGN.md](./DESIGN.md) records the design decisions and what they replaced.

The legacy Goldfish store, SG placeholders, LMD-GHOST control, committee schedule, synthetic block
encoding, attack scenario, availability oracle, state digest, and coupled network runner are removed.
Their former tests are not conformance evidence for this specification. The old transport also
embedded legacy wire types and coarse before-tick receipt semantics. It is not a new-spec simulator.
Historical code remains available in local Jujutsu history; do not restore its protocol assumptions
when implementing the new components.

AC unit tests use one AC instance per fixture with scripted messages, accepted blocks, and FG
frames. The primary composed driver is the deterministic simulator with independent real Node
instances. It supports seeded delays, directed partitions, sleep retention, injected objects,
persistence failures, replay, cross-node safety and liveness checks, and a seeded fuzz plan in the
ByzzFuzz style: a Byzantine set whose outgoing objects are dropped, delayed, or mutated per receiver
in process-fault slots, plus slot partitions, under a fault budget. Twins add replicas that share a
validator identity, so one signer equivocates coherently from honest code. Hand-scripted attack
scenarios were removed in favour of the seeded plan; a failing seed is the scenario, replayed by
seed. The executable sweeps a grid over validator count, Byzantine count and twins, and reports
verdicts, check coverage, and first-height-progress delays per cell. A height advance is not
finalization or recovery. There are no production dependencies or NAPI exports yet.

## Implemented: FG

Section 2 and Figures 3-5 are implemented with unit tests and a scripted AC/FG composition test.
Maintain coverage of these rules:

1. Define full block and FG attestation types without reusing the removed legacy wire format.
   Preserve list order and repetitions in block identity. Enforce authentication premises explicitly.
2. Store immutable chain state for each accepted block. Validate every included attestation against
   the parent state and refuse a block before publishing any partial mutation.
3. Implement target, progress, and finality participation; pending-finality window truncation;
   greatest qualifying finalization; target quorum; and delayed timeout progress.
4. Implement the ordered attestation pool, exact deduplication, proposal inclusion filtering, and
   parent-chain exclusion. Do not invent an age or per-validator eviction rule.
5. Implement caches, lexicographic justification selection, frontier contests, and viable-descendant
   acceptance of finalization. Produce `FinalityFrame` values from actual FG state.
6. Implement the durable validator signing record, record-before-send ordering, timeout choices,
   finality-pair restrictions, and duplicate-attestation suppression.

Tests cover competing targets, late useful finality pairs, simultaneous quorums, timeout boundaries,
pending-window limits, contests, reorgs, rejection without mutation, and signing-record persistence.
Actual FG frames feed AC in the package timeline tests. Those tests reach non-genesis finalization,
exercise AC restart while retaining FG and signing state, and reproduce the same output trace.

## Implemented: shared Node

`Node.zig` implements Section 1.6 and Figure 2 with one coordinator for production and simulation
adapters. Maintain these rules:

1. At a public time, run the AC tick, then the proposal duty, then the FG action.
2. Propose only for an assigned proposer at a slot start with `s > 0`.
3. Process self-emissions immediately within their producing duty. Process same-time incoming
   objects after the tick's duties. Use actual processing timestamps, without backdating.
4. Accept blocks through FG before notifying AC. A refused block must not feed its carried objects
   into either part. Refuse future and missing-parent blocks; later delivery may retry.
5. Give FG the same-tick fast-confirmed source and head. A missing source means no FG attestation.
6. At wake, preserve FG and the signing record and call AC restart before the first tick or object.

`NodeType(Clock, Transport, Storage, Signer, StateSource)` uses static dispatch to concrete dependency types.
There is no runtime vtable or opaque context. Node owns clock, ordering, duty, and wire-validation
checks formerly bundled into AC/FG. Protocol-specific admission and transitions stay in their engines.
A client may instantiate this same Node once and expose that concrete type through NAPI later.
Production dependency implementations, wire encoding, and disk restoration remain unimplemented.

## Implemented: simulator baseline

- Own independent Node, FG, and AC state for each simulated node.
- Provide an exact virtual clock with resolution finer than public ticks and a bounded event queue.
- Model blocks/AC messages and FG attestations as separate latency classes.
- Record input order, delivery decisions, admission outcomes, outputs, and meaningful state fields.
- Model sleep as no ticks, reception, or output. Retain messages sent during sleep or still in flight
  when sleep starts. Deliver after wake using the later of send and wake as the bound's origin.
- Keep intentional partition loss separate from sleep retention. Add scripted faults before seeded
  schedules. Resource exhaustion makes a run incomplete; it is not simulated message loss.
- Run the seeded executable, inspect event traces, and replay scenarios deterministically.

`Simulator.tick()` is the primary driver; `runUntil()` loops over it. The baseline scenarios include
healthy finalization, an actual FG stall while AC advances, sleep/wake recovery, directed partitions,
inclusive/zero-latency boundaries, storage faults, forged packets, and bounded seed sweeps. Main test
command: `zig build test:decoupled`, including all checker, fuzz, and twins tests. Algorithm unit
tests remain as secondary boundary coverage.

The simulator retains honest finality observations across sleep and checks per-node finalization
progress under explicit fault-free, continuously awake/connected, strict-delivery conditions when
a caller supplies a bound. Negative controls verify that disabled finalization and conflicting
historical outputs fail the corresponding checks. Coverage counters separate warmup, active, and
skipped samples in the report. Delivery-work exhaustion is an incomplete run rather than an
assertion, and replay hashes include checker history.

## Next: expand simulation coverage

Add broader schedules, automatic scenario reduction/shrinking, and trace-file replay. Establish the
first divergent event when a replay fails. Keep production integration separate until validation is
sufficient. Never serialize undefined backing capacity or struct padding as meaningful state.

## Security and recovery scenarios

The important composed scenario stalls FG finalization while AC traffic continues, then introduces
controlled faults and recovery. Use actual FG transitions to produce the frames, not arbitrary frame
changes presented as proof of a feasible protocol execution.

Check the four interface requirements on page 4 and local finalization monotonicity. Check cross-node
confirmation compatibility and progress only under explicitly recorded fault, participation, and
delivery premises. Public AC confirmation can step backward; that alone is not a violation.

Two modeling questions remain before stronger safety or bounded-healing claims:

- **Delivery regimes:** state strict versus inclusive bounds and the applicable GST/participation
  conditions. Public ticks precede arrivals at the same instant. Under the model, an awake node
  whose delivery is adversarially controlled is faulty, not an honest bounded-delivery receiver.
  The fuzz profiles deliver honest objects in `[0, delta]`; a vote arriving at exactly the support
  cutoff is a participant without support, and at `n = 4` that empties the fast set (heavy seed
  204038, see `testing/README.md`). The executable's `--delay-max` selects the strict regime.
- **Dissemination:** the joining argument assumes relaying behavior that the ingress pseudocode
  does not fully schedule. The simulator publishes once and Node forwards newly accepted blocks once,
  without periodic reannouncement or retry after loss. A Node that is offered a block whose
  parent it lacks keeps the block and asks the offering peer for the parent. A branch no peer
  offers again is never requested, so restoring links alone still does not establish recovery;
  specify history availability before asserting liveness.

The older slides' `2L + G` healing bound remains a separately sourced research property until its
premises and parameters are established. Do not turn convergence deadlines or frame-change bounds
into invented protocol rules. Passing bounded simulations supplies evidence, not a universal proof.

## Enduring constraints

- Respect `k >= 2`, `K_W >= 2`, `Delta_F >= Delta`, and the stated lower bound on R. Distinguish
  specification requirements from finite storage and integer-time restrictions.
- Treat negative-slot pools as empty. Preserve strict support/freeze cutoffs and genesis handling.
- Keep payload raw/support lists intact. Compress only derived scoring representations when their
  equivalence is justified; the admitted pool's two-vote rule is not a wire payload restriction.
- Keep lock deadlines unchanged through rollback and restart. Nonviability does not remove a veto.
- Retain accepted blocks and FG pool history within supported-run bounds. Garbage collection needs
  a separate equivalence argument, not an undocumented age limit.
- Keep errors and cleanup paths deterministic and bounded. Do not add production bindings until
  the shared protocol components and composed simulation have sufficient validation.
