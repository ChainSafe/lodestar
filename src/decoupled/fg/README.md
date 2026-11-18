# Goldilocks finality gadget

## Source and scope

The source is the 14-page `fgsa-spec.pdf` identified in [ROADMAP.md](../ROADMAP.md).
Sections 1.2-1.6 define the composition boundary. Section 2 and Figures 3-5 define the FG. The
finality gadget lives in `fg/`; the available chain it feeds lives in `ac/`.

The implementation is deterministic and allocation-free after callers allocate its fixed storage.
It does not read a real clock, choose a proposer, verify signatures, encode a block, access storage,
or send a message. Node supplies verified inputs and performs the duties in Figure 2.

The store does not run the chain-state transition. A `StateSource` (`testing/StateSource.zig` in
simulation, beacon states in a client) runs Figure 5 and answers chain-relative attestation
validity; the store keeps only each block's `BlockSummary`. The attestation pool and FG_ATTEST are
validator-side and live in `AttestationPool.zig` and `Node.zig`.

## Names and ownership

| Paper                                | Zig representation                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Sigma, the FG state                  | `FinalityGadget`                                                                            |
| Sigma.T                              | `T`, the full owned accepted block collection                                               |
| Sigma.sigma[B]                       | `summaries[find(B.root)]`, a `BlockSummary`; the full `ChainState` lives in the StateSource |
| Sigma.F, J, h_j, h_max               | Fields with the same names                                                                  |
| Sigma.attestations                   | `AttestationPool.entries`, ordered and deduplicated, owned by Node                          |
| sigma, a per-block chain state       | `ChainState`                                                                                |
| Lambda, the validator signing record | `SigningRecord`, owned by Node and fed by `attestationInput`                                |
| tau, the target/timeout Boolean      | `Attestation.tau`                                                                           |
| delta_t, the timeout delay           | `Config.delta_t`, measured in slots                                                         |
| Bottom, meaning no result or no pair | `null`, not an all-zero root                                                                |

`ChainState` retains the paper's `L`, `s`, `h`, `T_h`, `target_participation`, `progress`,
`pending_finality`, `finality_participation`, `J`, `h_j`, `F`, and `h_F` names.
A `BlockRef` holds a root and its immutable block slot so `T_h.slot` has its literal meaning.
The full block contents remain in `Sigma.T`; references do not substitute for holding full parents.

`SigningRecord` retains `target`, `timeout`, `lock`, and `sent`. Its `val_index` identifies the fixed
validator. These finality locks are not AC locks. Only `recordAttestation` writes the protocol fields
after initialization. The caller must keep the same record through restarts and persist a successful
update before broadcasting its attestation. No durable storage adapter is implemented yet.

Allocate `FinalityGadget` in place on the heap. Its full blocks need several megabytes, and the
StateSource holds the per-block states. Keep its address stable while frame payloads borrow its arrays. Incoming block lists may
be temporary: FG deep-copies every list on acceptance, preserving order and repeated entries.

## API and source mapping

| Method                                      | Specification                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FinalityGadget.init`                       | Section 1.3: genesis-only T, F = J = B_gen, h_j = 0, h_max = 1, genesis summary                          |
| `canAccept`                                 | Figure 3, lines 1-3: unknown root, known parent inside the finalized subtree                             |
| `onBlock`                                   | Figure 3, lines 4-9 after the StateSource ran Figure 5: store the block and its summary, update finality |
| `AttestationPool.add`                       | Figure 3, lines 10-11: retain one copy of each processed attestation                                     |
| `attestationInput`                          | Figure 3, lines 12-15: height inputs from fg_confirmed and finality inputs from head, for Lambda         |
| `updateFinality`                            | Figure 3, lines 16-21: update h_max, lexicographic J, then compatible viable F                           |
| `fgContest`                                 | Figure 3, lines 22-26: inspect all accepted F-descendant frontier blocks                                 |
| `headHeightFloor`                           | Figure 3, lines 27-30: h_max in a contest, otherwise h_max - 1                                           |
| `getFCRoot`                                 | Figure 3, lines 31-34: J at an uncontested frontier, otherwise F                                         |
| `isViable`                                  | Figure 3, lines 35-36: compare chain-state height against the floor                                      |
| `hasViableDescendant`                       | Figure 3, lines 37-38: test B and all its accepted descendants                                           |
| `toAC`                                      | Figure 3, lines 39-43: derive the F-rooted frame and viable-head set                                     |
| `AttestationPool.select`, `includedOnChain` | Figure 3, lines 44-45: valid against H (StateSource), absent from H's chain, in pool order               |
| `SigningRecord.createAttestation`           | Figure 4: choose pairs, suppress duplicates, record before send                                          |
| `ChainState.stateTransition`                | Figure 5: validate against parent, process all rows, then height events                                  |

All references are to the PDF's numbered figures, not Zig line numbers.
Helper functions implement indexing, bounded storage, and root comparison without new protocol rules.

## Ingress contract

Section 1.2 requires authentication before invoking handlers. Before calling FG, Node must verify:

- The proposer and attestation signatures for their specified keys and identities.
- The fixed digest of the complete ordered block content.
- `ac_valid_payload`, including the signatures and membership of carried AC votes.
- The wire shapes and identity membership of attestations, standalone and carried.

`Node.zig` owns these runtime checks. FG/ChainState assert the validated native-input contract instead
of treating malformed wire objects as FG handler inputs. Direct native callers must honor it.

Node also drops future blocks before FG, as Figure 2 specifies. FG itself reads no clock.
`onBlock(B, proposer)` receives the assigned identity `proposer(B.slot)` as an explicit argument.
This is an input to Figure 5's assertion, not permission to accept B.proposer without comparison.

The FG does not interpret the borrowed AC payload. Its owned copy preserves the two raw lists for
future AC calls through the FG frame. Signatures and canonical byte encoding remain adapter work.

## State-transition and failure rules

- Every attestation in a candidate block validates against the unchanged parent state.
- Candidate processing never mutates the accepted parent's state.
- Process all attestation rows before any height event. Repeated rows still set only one Boolean
  per validator in each relevant participation array.
- Finalize the greatest qualifying pending height first. Then check target quorum. Only without a
  target quorum does delayed progress trigger a timeout advance.
- Advance height at most once per block. Set T_h to that block and clear current participation.
- Keep the newest K_W pending pairs. Older useful finality votes are accepted only while their pair
  remains pending. The pool itself has no age or per-validator eviction rule.
- Update finality caches only after accepting a block and storing its summary.
  A chain's finalized root need not become Sigma.F until it has a viable descendant.
- Refused candidates and all resource failures leave the store and the pool unchanged.
- `stateTransition` is also a low-level candidate builder: false leaves its output unchanged, but
  callers must discard its output on a capacity error. The StateSource never publishes such an output.
- A null signing result or signing-record capacity error leaves Lambda unchanged. A successful result
  has already updated Lambda; its caller must persist that record before signing/broadcasting.

No mutable FG data is exposed to AC. `toAC` writes headers to a caller-owned `FrameBuffer`; the
returned `FinalityFrame` borrows those headers and FG-owned payload lists. Rebuild it after FG changes.
The physical accepted tree retains blocks outside the F-rooted projection.

## Constants and supported-run bounds

Protocol parameters and initial constants:

- `n >= 1`: fixed unit-weight validators, Section 1.1.
- `q = ceil(2*n/3)`: calculated by `Config.quorum`, Section 1.1.
- `K_W >= 2`: pending-finality window, Section 2.1. There is no invented upper validity bound.
- `delta_t >= 0`: timeout delay in slots, represented by an unsigned slot value, Section 2.1.
  Comparison widens to u64 so a large legal delay cannot overflow slot arithmetic.
- Chain height starts at one. Justification and finalization heights start at zero. Genesis is the
  initial L, T_h, J, and F. Participation and pending finality start empty, Section 2.1.

Storage constants are documented in `limits.zig`; none are additional wire quorum rules:

- `max_heights = max_slots + 1`: height-indexed storage with index zero retained. Strictly increasing
  parent slots and a single advance per block bound the maximum reachable height within a run.
- `max_attestations_per_block`: supported ordered input and proposal-output list size.
- `max_attestations`: retained pool capacity, not an eviction threshold.
- `max_sent_attestations`: retained validator signing history, not a pruning permission.

Oversized lists or exhausted storage terminate an incomplete simulation run. Do not treat capacity
errors as hostile-message rejection, drop history, or silently select fewer proposal attestations.
Attestation wire heights are not restricted to `max_heights`; unknown and old entries remain in the
pool. Height bounds apply to indexed local chain/signing state, not to arbitrary received tuples.

## Validation and remaining work

Sibling suites test the FG types, chain transitions, validator record, and FG store/caches.
The main composed driver is `testing/Simulator.zig`, with real Nodes instantiated over concrete
Clock, Transport, Storage, and Signer types. Its scenarios include non-genesis finalization,
FG stalls while AC advances, wake/recovery, partitions, seeded replay, storage failure, and seeded
Byzantine faults with cross-node finality and liveness checks.
See [testing/README.md](../testing/README.md) and [NODE.md](../NODE.md).

Remaining work includes shrinking, trace-file replay, and real client adapters. These bounded
scenarios do not establish TSQ or a universal healing/security bound.
