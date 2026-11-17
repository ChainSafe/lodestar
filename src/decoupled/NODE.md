# Shared Goldilocks Node

`Node.zig` implements Sections 1.2-1.6 and Figure 2 of `fgsa-spec.pdf`. The exact artifact is
identified in [ROADMAP.md](./ROADMAP.md). The AC lives in `ac/` and the FG store, ChainState,
AttestationPool, and SigningRecord in `fg/`; they remain independent protocol components. Node owns
the pool and Lambda; the store owns the tree and the finality caches.

## Configuration

`Node.Config` keeps `B_gen`, `n`, and `val_index` shared so AC and FG use the same genesis and
validator set. `ac: ACConfig` holds `delta`, `R`, and `k`. `fg: FGConfig` holds `delta_f`, `K_W`,
and `delta_t`. Field documentation in `Node.zig` defines the units and protocol constraints.

`delta_f` belongs to FG delivery, but AC also uses it to validate the minimum round length.
Node passes each parameter to the existing component configuration without changing its validation.
Storage capacities remain separate in `limits.zig`.

## Compile-time dependencies

Instantiate `NodeType(Clock, Transport, Storage, Signer, StateSource)`. Node stores typed pointers to these
objects. Calls use static dispatch. There is no runtime callback table or opaque context pointer.

The dependency interfaces are the methods Node calls:

- `Clock.now()` returns exact local processing time in configured integer units.
- `Transport.broadcastVote`, `broadcastBlock`, and `broadcastAttestation` submit borrowed objects.
- `Transport.Peer` names the sender of a delivery. `Transport.forwardBlock` passes on a block Node
  accepted from a peer; `requestBlock(peer, root)` and `sendBlock(peer, B)` address one peer.
- `Storage.persist(Lambda)` returns success only after the validator record is durable.
- `Storage.appendBlock(B)` and `appendAttestation(a)` add one entry to the journal, and
  `persistAC(record)` replaces the AC record. Each is durable when it returns.
- `Storage.loadRecord`, `journalEntry(i)` and `loadAC` read these back for `restore()`.
- `Signer.proposer(slot)` supplies the fixed proposer assignment.
- `Signer.verifyVote`, `verifyAttestation`, and `verifyBlock` authenticate their exact inputs.
- `Signer.prepareBlock` sets the content root and prepares the local proposer signature.
- `StateSource.transition(B, proposer)` runs Figure 5 for a block the store admits and returns its
  `BlockSummary`, or null when the transition rejects the block.
- `StateSource.validAttestation(H, a)` answers Figure 5, lines 10-14 against sigma[H] for proposals.

Transport, Storage, Signer, and StateSource expose an `Error` set for their fallible operations. Verification
returns false on invalid input. Node's instantiation checks method signatures at compile time, not
cryptographic correctness or storage durability. Those remain implementation contracts.

The simulator supplies concrete types under `testing/`: `Clock.zig`, `Transport.zig`, `Storage.zig`,
`Signer.zig`, and `StateSource.zig`, which runs `ChainState` per accepted block. A client can instantiate the same Node with production types. An eventual NAPI
class can wrap that concrete instantiation. No production dependency stubs or NAPI exports exist.

## Ownership and lifetime

Node owns `t`, `Sigma`, `A`, `Lambda`, its frame buffer, and lifecycle/tick bookkeeping. Dependencies
must have stable addresses for the Node's lifetime. Allocate Node in place on the heap. Serialize all
calls to one instance. The reentry guard does not synchronize threads.

Every change to a Node enters as one call that carries one value and runs to completion; reads such
as `tips()` change no protocol state. [DESIGN.md](./DESIGN.md) records where the code does not yet
follow this.

Dependencies complete synchronously. Transport must copy data needed after a broadcast returns.
Dependencies must not mutate or reenter Node. The clock advances externally; Node reads it at each
entry point. A signature result must belong to the exact tuple, signer, and slot seat, not a related
message. The simulation uses signature witnesses, not real BLS. A client must retain real signatures.

`init` creates a new genesis instance and a fresh signing record. Never use `init` to restart an
existing validator. Sleep/wake keeps FG and signing state. `restore()` rebuilds a Node from Storage
after its memory was lost.

## Order and validation

Node runs its public ticks in order at their nominal times, delta apart. A host calls `advance()`
whenever it gets to run; Node runs every tick up to now, then processes at now. A tick reached less
than delta late still performs its validator duties. A later one runs only the store duties: lock
expiry, unlocking, and the confirmation update. The vote, proposal, or attestation it would have
produced is dropped and `late_ticks` counts it. The simulator calls `onTick()`, which requires now to
be exactly the next tick, so the simulator's own discipline stays checked. At each tick Node runs:

1. AC's schedule and any vote broadcast. AC already admitted its local vote.
2. The proposal duty at a slot start, only for the assigned proposer and only when `s > 0`.
3. The FG action at `a_r = 4*delta*r*R + 6*delta`, using a fresh frame.

A proposal takes its parent and payload from AC and all eligible pool entries in pool order.
Node prepares and broadcasts the block, accepts it through FG, then notifies AC. An FG action takes
AC's source and head, records the new attestation, persists Lambda, broadcasts, and admits it locally.

Incoming calls are `onBlock(from, B)`, `onBlockRequest(from, root)`, `onACMessage(vote)`, and
`onAttestation(a)`. Node owns:

- Monotonic time, horizon, tick-before-input ordering, and duty scheduling.
- Future-block rejection, bounded ingress scanning, signature/root validation, and wire shapes.
- Calling `ac_valid_payload` before FG can publish a candidate.
- Notifying AC only after FG acceptance, without processing carried objects on refusal.

AC retains its stateless payload predicate, committee/slot admission rules, joined guards, cutoffs,
and locks. FG retains duplicate/parent/finalized-ancestry checks and the Figure 5 transition checks.
These protocol rules are not replaced by dependency implementations.

A future block is refused, not queued. A block whose parent is unknown is refused too, and Node then
recovers the parent itself:

- It checks the block's signature, keeps a copy (`orphans`, at most `limits.max_orphans`, oldest
  dropped first), and asks the peer that delivered it for the parent through `requestBlock`.
- `onBlockRequest` answers with `sendBlock` when the store has the block, and stays silent otherwise.
- The answer arrives through `onBlock`. If its parent is unknown as well it is kept and requested in
  turn, so a gap closes one block per round trip.
- Every accepted block releases the kept blocks that build on it, in the same call. Each one accepted
  is forwarded; one still refused is dropped.

There is no timer and no retry: a request goes out only when a block arrives, to the peer that sent
it. A repeat delivery of a kept block asks its own sender. Kept blocks are not protocol state. A
refused object changes no protocol state; its processing may advance Node's
clock. `tips()` returns copied roots with the same clock discipline. Direct native FG/AC callers must establish Node's premises.

## Durable state and restore

A Node writes to Storage everything that sleep would have kept, before it acts on it:

- The journal holds, in acceptance order, every accepted block and every attestation admitted to
  the pool on its own. A block is appended before FG accepts it, an attestation before the pool
  takes it. Attestations that arrive inside a block are not journaled; replaying the block pools
  them again.
- The AC record holds the locks and the confirmation record. Node writes it after a tick changes
  it and before that tick's vote is sent.
- The signing record is written before an attestation is sent, as before.

`restore(config, dependencies)` starts from genesis, loads the signing record, replays the journal
through the state transition, FG and the pool, loads the AC record, and then joins exactly as
`wake()` does. The caller supplies a StateSource initialized as for `init`. The result equals the
Node that `wake()` would have resumed, with one difference: kept orphan blocks are gone, because
they are a cache and are never written.

Limits of this model: every write is atomic and durable on return, so a write that is lost or torn
by the crash is not modelled; a crash happens between calls, never inside one; and replay starts
from genesis, with no checkpoint.

## Lifecycle and errors

An asleep node has no ticks, reception, or output. Transport owns retained sleep messages. A sleep
may replace a boundary tick but cannot skip an earlier awake tick. A late host is not asleep: it
kept receiving, so it catches up through `advance()` without an AC restart. `wake()` restarts AC before any
wake-time work, preserves Sigma and Lambda, and retains AC lock deadlines. At a public wake time,
run that tick next. Between ticks, retained deliveries may follow wake immediately.

Wire refusal does not stop Node. A resource or dependency failure stops the instance because part
of a duty may already have reached storage or transport. Do not retry the tick or reset Lambda.
The simulator marks that run incomplete. A production client needs an explicit recovery procedure.

FG publication is atomic. AC receipt storage cannot exhaust first: FG retains genesis plus accepted
blocks, while AC observes at most those non-genesis blocks. Paired assertions check this relationship.

## Testing

The main driver is [testing/Simulator.zig](./testing/Simulator.zig), not a mock Node fixture.
Run `zig build test:decoupled` for composed scenarios. Focused AC/FG tests remain useful for
algorithm boundaries. See [testing/README.md](./testing/README.md) for simulation inputs and limits.
