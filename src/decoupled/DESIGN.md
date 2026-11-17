# Design decisions

One entry per decision. Each entry says what we chose, what we rejected, and why. Dated. Append;
do not rewrite history. The specification is `fgsa-spec.pdf`, identified in [ROADMAP.md](./ROADMAP.md).

## Byzantine nodes on purpose (2026-10-28)

TigerBeetle's simulator assumes a non-Byzantine network. Its documentation states that messages may
be dropped, duplicated, reordered and corrupted "in a non-byzantine way": the corruption is
accidental, a checksum catches it, and no replica lies. Every replica runs the same trusted code,
so the VOPR only has to search over delivery schedules and crashes.

That assumption does not hold for Goldilocks. Section 1.1 of the specification defines a faulty
validator as arbitrary code, and every guarantee holds only while the faulty count stays under a
bound: `3 * faulty < n` for finality, `2 * faulty < n` for confirmation. The rules that make up
most of the AC exist against adversaries, not accidents: equivocation discounting, the two-vote
pool cap, the support cutoff, lock vetoes and unlocking, the joined guard. A simulator that only
drops and reorders messages never exercises them.

So we keep TigerBeetle's method, one deterministic process, seeded schedules, replay by seed, and
add the adversary TigerBeetle does not have. We chose:

- A Byzantine set, drawn from the seed and marked faulty for the cross-node checks. Byzantine nodes
  run the honest `Node`. Their behaviour comes from the transport, which per receiver drops, delays
  or mutates what they send in process-fault slots. Different receivers see different outcomes,
  which is how equivocation and selective release arise without attack code.
- Mutations that are one step from the honest object and still well formed, signed by the same
  sender, so they pass authentication and reach the protocol logic rather than the drop path.
- Twins: a second replica under an existing validator's identity. The two views diverge under a
  partition or a fuzz delivery, and one signer then votes, attests and proposes on two chains,
  coherently, from honest code. This is the adversary a one-field mutation cannot produce.
- Valid keys for the adversary. The signature witness model gives Byzantine senders the same
  witnesses as honest ones. A message that fails authentication is dropped with no effect, so a
  "bad signature" fault tests nothing; the fault worth testing is a well-signed lie.

We rejected:

- Hand-scripted attack scenarios as the primary search. They encode the attack the author already
  imagined. The seeded plan found two relay failures and the inclusive-bound stall (seed 204038)
  that no script asked for. A failing seed is the scenario.
- Attack code inside `Node`. A simulation mode in the protocol engine is a second protocol, and it
  cannot be trusted to match the honest one. The adversary lives in the transport and in replica
  layout, never in protocol code.
- A per-validator "fails x% of signatures" ratio. Verification failure is a property of a message,
  and the honest response is one line: drop. The ratio belongs on the sender side, per message.

What this buys: the cross-node checks can state their premises in the specification's terms
(`faulty` count, cuts, sleeps, proposer assignment) and compare only awake non-faulty nodes.
What it does not buy: a proof. Passing seeds are evidence under the sampled schedules, and a
mutation is one step adaptive; it cannot wait for the honest head and then choose.

## Tick before delivery (2026-10-26)

At a public time, every awake node runs its tick before any object delivered at that instant, and a
zero-latency send still arrives after the receiver's tick. This follows Section 1.6 of the
specification and differs from TigerBeetle's IO order. The support cutoff and the freeze are strict,
so an object stamped at the boundary must land on the late side. See [testing/README.md](./testing/README.md).

## Every knob is an option, the seed draws the rest (2026-11-08)

Roguestar had five scenarios: three scripts and two fuzz profiles. A script encodes the fault the
author imagined; a profile is one point in the configuration space. Following TigerBeetle's VOPR,
the executable now takes every simulator knob as an option and draws the unpinned ones from the
seed within a range, so a bare seed is a swarm run and pinned options narrow it. The old scenarios
are command lines in `testing/README.md`; the scripted regressions stay in `simulator_test.zig`.
The swarm leaves a fault-free suffix so the confirmation premise can hold at the end of a run,
because a draw that never lets a check sample is noise, not a finding.

## Host time is a catch-up loop (2026-11-08)

A client host does not fire exactly every delta. `Node.advance()` runs every public tick up to now in
order at its nominal time, then processes at now. Store duties (lock expiry, unlocking, confirmation)
always run, because the spec's `on_tick` state depends on them. Validator duties run only when the
tick is reached less than delta late; a vote or proposal after its window is noise. The simulator
keeps the exact-tick `onTick()` for its own ticks and models the late host as a `host_pause` fault,
distinct from sleep, which is a crash and restarts AC.

## Static dispatch for dependencies (2026-10-27)

`NodeType(Clock, Transport, Storage, Signer, StateSource)` takes concrete types at compile time. No vtable, no
opaque context pointer. The simulator and a future client are two instantiations of one `Node`,
not a mode flag inside it. See [NODE.md](./NODE.md).

## The protocol engine has no environment (2026-10-25)

AC and FG read no clock, draw no randomness, verify no signature, send nothing. Time, delivery,
authentication results, proposer assignment and restart are inputs. This is what makes a run
reproducible from a seed and lets the same code ship in the client.

## No automatic block retries (2026-10-28)

Section 1.6 refuses a block whose parent is missing and permits a later delivery to try again.
It does not schedule retransmission. Section 1.1 requires retention across sleep; Section 3.3
refers to relaying, but neither specifies periodic reannouncement of stored blocks.

The simulator publishes each object once and relays a block once when a receiver first accepts it.
We removed periodic originator reannouncement and relay retries. A cut link or in-flight drop does
not cause another send when the link heals. Pending deliveries still survive sleep and follow the
wake-relative delivery bound.

Missing history will require explicit block requests, as in beacon chain networking. Requests and
synchronization are not implemented yet, and refused children are not buffered. We reject automatic
retries added merely to make a recovery scenario pass. A stall after packet loss can reflect this
missing network capability rather than a protocol defect.

## Check the claimed property (2026-11-02)

Height advancement, finalization, and recovery are separate observations. The simulator now names
its existing height metric `firstHeightProgressDelay` and its inactivity check
`height_progress_bound`. Neither establishes finalization or recovery.

A separate opt-in `finalization_bound` checks every node's own finalized-root progress. Its
experimental premise requires a fault-free, continuously awake/connected run with strict block/vote
delivery. The caller selects the bound. The PDF supplies no universal deadline. Missing-history
recovery remains outside this check, rather than being concealed by automatic retries.

Finality compatibility includes retained outputs from sleeping honest nodes. Checker regressions
use deliberately corrupted state as negative controls, not as protocol-generated counterexamples.
The earlier entry's descriptions of faulty thresholds as guarantees from Section 1.1 were too
strong: the checker conditions are experimental premises, not theorems stated by that section.

Reports distinguish passed, property failure, and incomplete execution. Confirmation warmup
samples do not count as active coverage, even when the initial comparisons run. We retain the
existing confirmation premise instead of weakening it merely to obtain active checks.

## Verdicts are pass or fail (2026-11-09)

The `uncovered` verdict excused a run whose enabled check never sampled. It is gone: a run passes
or fails on the checks that ran, and the per-check active, skipped, and warmup counts are the only
record of how often each check applied. A stall is a failure even when the model, not the
protocol, is the cause; the answer is to extend the model, not to relabel the run.

## Confirmation premise keeps faulty proposers (2026-11-09)

The premise used to skip every instant whose `k + 2`-slot window contained a faulty assigned
proposer. Nothing in the paper asks for that: confirmation safety rests on an honest majority and
synchrony, and an honest proposer is a liveness condition. The clause left the Byzantine profile
with zero active samples. Removing it changed no verdict over 48 swarm seeds with a Byzantine
validator and 24 runs of the seven-validator, two-faulty profile with process faults in every
window; the one conflict found (seed 44) fails with or without the clause and is a partition-era
confirmation that persists because the minority never recovers the block it missed.

## Block requests recover missing history (2026-11-11)

After a partition a node could stay stuck for the rest of the run. It had missed a block sent
while the link was cut, nothing sent that block again, and the node refused every later block
because each one descended from the block it lacked. Three seeds in two 64-seed sweeps failed the
height-progress check this way (8 with one Byzantine validator; 15 and 28 in the bare swarm).

The simulator now does what the 2026-10-28 entry deferred. When a node refuses a block because it
lacks the parent, the simulator keeps that block for the node and asks the peer that delivered it
for the parent. The peer answers when its own store has the parent. The answer is an ordinary
block delivery, so a parent whose own parent is also missing is kept and requested in turn, one
block per round trip, back to a block the node has. Each accepted block releases the kept blocks
that build on it.

There is still no timer and no retry. A request goes out only when a block arrives, to the peer
that sent it. A repeat delivery of a kept block from a second peer asks that peer, so one peer
that never answers does not end the recovery. A Byzantine peer in a process-fault slot withholds
answers at the plan's drop rate. The logic lives in the simulator, not in `Node`: `Node` still
only refuses, and a client's sync layer would do the same work from the same refusal.

We rejected relaying on heal and periodic reannouncement for the reasons in the earlier entry: the
sender cannot know what a receiver missed, and the receiver can. `block_requests = false`
(`--no-block-requests`) restores the old behaviour, and the three seeds stall again with it.

## Recovery lives in Node, not in the simulator (2026-11-17)

The 2026-11-11 entry put block requests in the simulator and called them the host's job. That
holds only if this module is one part of a client. The target is the whole node, so recovery is
product code, and code that exists only in the simulator would have to be written a second time
and would run untested. TigerBeetle draws the same line: its simulator delivers, drops and delays
messages, and the replica repairs itself.

`Node.onBlock` now takes the delivering peer. Node keeps a refused block whose parent is unknown,
asks that peer for the parent, answers such requests from its own store, and releases kept blocks
when their parent is accepted. It also forwards a block it first accepts from a peer, because a
released block has no delivery the simulator could relay. The simulator lost its kept-block list
and the three functions that worked on it; it gained three transport calls that only queue.

Two behaviours changed. Node checks a block's signature before keeping it, so an unauthenticated
block neither takes a slot nor triggers a request. `block_requests = false` now means the transport
loses requests; Node still keeps the block and releases it if the parent arrives by broadcast.

## The module is the whole node (2026-11-17)

The target is the entire consensus node in Zig: one `Node` that runs unchanged under the simulator
and in the client. It is not a module that replaces only Lodestar's fork choice.

We considered the narrower target first: a drop-in replacement for Lodestar's `IForkChoice`, with
sync, networking and validator duties left in the TypeScript host. We rejected it for two reasons.
Whatever stays in the host is never simulated, so the stalls of 2026-11-11 would have been fixed in
code the simulator cannot run. And `IForkChoice` is about 80 synchronous methods over a shared
tree, called from many places in the beacon node; a boundary of that shape cannot be scheduled,
dropped or replayed.

What follows from the choice: anything a node must do to stay correct belongs in `Node` or in a
module beside it, and it reaches the outside only through a dependency. Recovery of missing blocks
and forwarding already moved (previous entry). Block storage, restart from disk, wire encoding and
peer handling are still outside and are listed in [ROADMAP.md](./ROADMAP.md).

The state transition is the one part we do not write here. Upstream Lodestar has a Zig state
transition through Gloas. Once it gains the Goldilocks fork it becomes the production
`StateSource`, and `fg/ChainState.zig` stays as the simulator's fast stand-in.

Not decided: the surface Lodestar's TypeScript uses to reach this node, and how much of the
existing beacon node is reused around it.

## Writes are messages, reads are queries (2026-11-17)

Every change to a `Node` enters as one call that carries one value and runs to completion:
`advance`/`onTick`, `onBlock`, `onBlockRequest`, `onACMessage`, `onAttestation`. Everything a node
says leaves through `Transport`, and everything it must keep leaves through `Storage`. Nodes share
no memory. Reads such as `tips()` change no protocol state. The write calls are the unit the
simulator orders and a proof would reason about; the reads can grow into a wide query surface
without adding schedules to explore.

We do not split AC and FG into two parts that exchange messages. The paper defines their
interface as synchronous calls inside one tick, and a message boundary there would add orderings
the specification does not have.

The code does not fully follow the rule yet:

- `Node` pulls from `Clock`, `Signer`, `StateSource` and `Storage` with synchronous calls. The
  simulator controls their answers, but it cannot delay one or fail one in the middle, except for
  a storage write failure.
- The cluster checks read `node.fg` and `node.ac` fields directly instead of a query.
- `tips()` moves Node's processing time forward, so it is not free of side effects.

## Determinism rules are a test (2026-11-17)

Replay by seed holds only while the node code takes time, randomness and I/O from its
dependencies. Until now that was a convention. A single clock read in a handler would pass every
test and show up months later as a failing seed that passes on rerun.

`testing/determinism.zig` tokenizes each node file and fails `zig build test:decoupled` on a use of
`std.time`, `std.Random`, `std.crypto.random`, `std.Thread`, the I/O namespaces (`std.Io`, `fs`,
`net`, `http`, `posix`, `os`, `c`, `process`), a hash map, `@intFromPtr` or `@cImport`. The node
files are an explicit list. A relative import of a file outside the list is itself a violation, so
a new file cannot stay unchecked, and only `root.zig` may import from `testing/`.

Hash maps are banned for a weaker reason than the others. Zig's maps hash with a fixed seed, so
iteration repeats within one build. The order still depends on std's hash function and the map's
growth history, which are not protocol state, and the node code needs no hash map today.

We rejected a rule in the repository's `test/tidy.zig`: it lists files through git, which this
workspace does not have, and the rule should travel with the module. The check does not see into
the named modules the node code may import (`std`, `bounded_array`), and it cannot catch a
dependency that itself behaves differently between runs.

## A crash loses memory; restore rebuilds from Storage (2026-11-17)

Sleep kept the whole `Node` in memory, so nothing tested what a real restart needs on disk. A
crash is now a sleep that also discards the `Node` and its chain states. The next wake calls
`Node.restore`, which rebuilds both from `Storage`.

We made the durable set exactly what the paper keeps across sleep: the FG store, the attestation
pool, the signing record, and the AC locks with the confirmation record. Storage holds them as a
journal of accepted blocks and admitted attestations in acceptance order, plus two small records.
Replaying the journal reproduces the pool's order, which proposals depend on, without storing the
pool itself. Every write precedes the action that depends on it: the block entry before FG accepts
the block, the AC record before the tick's vote, the signing record before the attestation.

The test for the durable set is an equivalence. Two runs with the same seed take one node down
over the same window, one by sleep and one by crash, and every node must end with the same state
digest. Dropping attestations from the journal makes that test fail, so it is not vacuous.

We rejected storing a snapshot of the pool and FG caches: a snapshot can disagree with the blocks
it was derived from, and a journal cannot. We also rejected persisting kept orphans; they are a
cache that block requests refill.

Not modelled yet: a write lost or torn by the crash, a crash between a write and the send that
follows it, and a checkpoint to avoid replay from genesis. The first two need storage calls that
complete on a later tick.

Cut/heal controls record their times between public ticks. Consecutive fuzz partitions clear the
previous partition before applying the next. Queue occupancy and per-instant delivery work have
separate limits; work exhaustion returns an incomplete-run error. Replay hashes include checker
history and coverage, and the main simulator target selects the whole sibling scenario suite.
