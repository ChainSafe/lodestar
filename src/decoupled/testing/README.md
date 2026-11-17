# Goldilocks deterministic simulator

The simulator is the main composed test driver. It runs the shared
`NodeType(Clock, Transport, Storage, Signer, StateSource)` with concrete simulation dependencies.
`StateSource.zig` runs `ChainState` for every accepted block; a client would answer from beacon
states. AC and FG transitions are unchanged. There is no separate mock Node harness or runtime callback table.

## Run

Roguestar (`roguestar.zig`) is the executable: one seed, every knob an option.

- All decoupled tests, the composed scenarios and the algorithm unit tests:
  `zig build test:decoupled`. This includes the determinism check (`determinism.zig`): it fails when node code, meaning everything outside
  `testing/`, `roguestar.zig` and test files, reads a clock, randomness, threads, I/O or a hash map.
- A swarm run: `zig build run:roguestar -- 7`. Every knob not given is drawn from the seed within
  its range: validators, delta, round length, lock window, delivery latencies, Byzantine count,
  twins, process-fault and partition slots, run length. `--help` lists the options and ranges.
  Without a seed one is drawn at random and printed.
- A pinned run: `zig build run:roguestar -- 7 --n 4 --delta 4 --byzantine 0 --network 0 --twins 0`.
  Pinned options narrow the swarm without shifting the other draws of the same seed.
- Scripted faults, repeatable, `NODE@FROM-UNTIL` in instants: `--sleep 2@0-128` (no ticks or
  reception, memory kept), `--crash 2@0-128` (the same, but memory is lost and the node is
  rebuilt from its storage at the end), `--pause 1@15-30` (late host), `--storage-fail 0@50-60`, and
  `--partition 0,1:2,3@32-160` (listed groups lose both channels to each other).
- A sweep over seeds: `zig build run:roguestar -- 1 --sweep 64`. It prints each seed's verdict
  and resolved options and the first failing seed. It exits with an error if a seed fails, is
  incomplete, or has an enabled check with no mature active sample. A sweep runs with snapshots
  off, which skips the per-delivery state hashing and makes a seed about fifty times cheaper;
  replay a failing seed on its own to get the snapshots back.
- Detailed event trace: `--trace`. Attestation probe: `--probe` prints, at every attestation tick,
  each node's head, its deepest viable fast-confirmed block with that chain's height and `T_h`,
  and the vote pool of the slot whose confirmation update just ran, with `!` on votes that do not
  count as support.
- Block requests are on by default; `--no-block-requests` makes the transport lose every request,
  and a node that missed a block then stays without it unless another delivery brings it.
- Checks: `--height-progress-bound B` (default four rounds when faults are planned),
  `--finalization-bound B` (default off; only meaningful fault-free with strict delivery, see the
  premises below), `--no-finality`, `--no-confirmation`.

The swarm leaves a fault-free suffix of `k + 3` slots, longer than the confirmation window, so the
check samples at the end of every run, and twins reuse a Byzantine identity only, so the faulty
count stays what the premises count. Pinned options may break this and leave the check with no
active sample.

The executable reports the resolved options, then seed, verdict, final virtual time, trace count,
replay digest, per-node finalization progress, and each check's enabled/active/skipped/warmup
counts. Repeating the same seed and options reproduces the event order and state. The trace is
available in memory and as executable output. No independent trace-input file format or automatic
shrinker is implemented yet.

## Driver and dependencies

`Simulator.tick()` processes one virtual-time instant. The first call processes time zero.
`runUntil(end)` is only a bounded loop over `tick()`. Time advances in integer units finer than a
public tick when `delta > 1`. Each instant runs:

1. Scripted controls in insertion order, including sleep/wake before boundary-time work.
2. Every awake, unpaused Node whose public tick is due, through `onTick()`.
3. Every paused host whose resume instant is now, through `advance()`, which runs its missed ticks.
4. Network arrivals ordered by due time, then stable send sequence.

Zero-latency sends still arrive after every receiver's public tick at that instant. This order follows
Goldilocks Section 1.6, even where it differs from TigerBeetle's IO order.

Dependencies live beside the simulator:

- `Clock.zig` reads the virtual clock, which advances even while a node sleeps.
- `Transport.zig` queues copied outgoing objects. It never calls a receiver from a broadcast.
- `Storage.zig` retains the validator record, the journal and the AC record in memory. They are
  all a crashed node keeps. Scripted write failures stop the node at its next write.
- `Signer.zig` supplies proposer assignments and checks simulation signature witnesses and roots.

These types implement the methods used by Node. A production dependency is a different concrete
type, not a simulation mode inside the protocol. Production implementations do not exist yet.

## Network and faults

Blocks/AC votes and FG attestations have separate configurable latency ranges. SplitMix64 samples
per-delivery delay from a fixed seeded stream. Equal-time arrivals use stable sequence numbers.
Link controls are directed and channel-specific. A blocked link drops an object at send or arrival.
The simulator records honest cuts and their closing times at the controls themselves, including
controls between public ticks. Healing does not restore dropped objects.

Sleep is different. It retains both in-flight objects and new objects addressed to the sleeping node.
Wake restarts AC first. Retained deliveries use their sampled delay from the later of send and wake.

A `host_pause` control models a late host rather than a crash: the node runs no ticks and receives
nothing until the resume instant, then catches up through `Node.advance()` and receives everything
retained meanwhile at once. AC does not restart. Ticks reached a full delta late run without
validator duties, so a paused proposer skips its slot. Pause and resume count as churn for the
confirmation premises and as a fault input for the height-progress bound.
A public-time arrival follows that time's Node tick. An off-tick wake permits deliveries afterward.
FG and the in-memory durable signing record survive wake. No output is queried while asleep.

Each publication sends once to its selected recipients. Node forwards a block once, when it first
accepts it from a peer, and the transport sends it to other nodes over connected links. FG refuses
duplicates, so repeat delivery does not trigger another forward.
Each pending delivery records its physical sender separately from the packet's publisher and signer,
so arrival-time link checks use the forwarding node. There are no periodic block reannouncements,
relay retries, or retries triggered by healing a link.

Recovery of a missing parent is Node's work, described in [NODE.md](../NODE.md). The simulator only
carries the two messages Node sends for it:

- `Transport.requestBlock` queues a request to the named peer on the block channel, with a sampled
  delay and the usual link checks at send and arrival. A request to a sleeping or paused peer is
  retained like any other delivery. On arrival the simulator calls `Node.onBlockRequest`.
- `Transport.sendBlock` queues the answer as an ordinary block delivery. A Byzantine peer in a
  process-fault slot withholds it at `drop_rate`.

Trace entries: `block_request` (node is the peer asked, peer the requester, packet the kept block)
and `block_response` (value 1 with the parent's packet, 0 when the peer lacks the parent). A kept
block that Node releases leaves no `deliver` entry; its forwards appear as `queued` entries.

With `block_requests = false` the transport loses every request. Node still keeps the refused
block and releases it if the parent arrives by broadcast. A branch that no peer offers again is
never requested, so restored connectivity alone does not establish recovery of lost history. The one-time block relay is a simulation dissemination policy, not a complete GossipSub model or a
claim that the paper's delivery assumptions hold during arbitrary partitions.

Typed injection methods schedule signed, malformed, or forged votes, attestations, and blocks with
selected recipients. Injected physical senders are marked faulty. `targets = 0` registers a signature
witness without wire delivery. No unconditional cross-node safety assertion treats those senders or
partition-controlled receivers as honest bounded-delivery nodes.

## Authentication and hashing

This is not BLS testing. Signature witnesses bind identity and tuple contents. A forged standalone
packet remains invalid even when another packet has a valid signature for the same tuple. Carried
objects require registered witnesses. The model does not encode real signature bytes or distinguish
multiple signature encodings for the same carried tuple.

`Hash.zig` expands traversal from type information at compile time. It borrows values and hashes
fields, active union/optional payloads, slices, active bounded-array entries, accepted FG states, and
pending participation rows. It never hashes pointers, native padding, or unused backing storage.
Schema expansion has a compile-time depth limit. There is no runtime traversal of cyclic objects.

Block roots use an explicit simulation schema: parent, slot, ordered attestations, raw vote tuples,
and support tuples, including repeats. The schema excludes the root itself, proposer identity, and
cached authentication metadata, as the paper's digest input requires. This is not a production wire
codec or a claim of canonical Ethereum SSZ. Digest compatibility across schema revisions is not
promised.

## Checks and scenarios

The simulator checks local finalization monotonicity, finalized/confirmed/head ancestry, head
ancestry from the current fork-choice root, proposal-parent agreement with AC's head, and FG source
viability/ancestry. Checks run after Node ticks and deliveries. Duty checks use separate frame storage.
Storage and transport check that an attestation's record was committed before broadcast.

The scenario suite covers healthy confirmation/finalization, an FG stall while two of four validators
sleep and AC advances, wake/recovery, directed partitions with and without block requests,
seeded replay and sweeps,
zero-latency order, sleep retention, forged objects, and storage failure. Replay compares the event
sequence, scheduler/input state, protocol state, durable records, checker history, coverage, and
failure classification, not cross-node raw equality.

Liveness scenarios use a one-unit delay with Delta equal to four units. Seeded boundary schedules
may deliver at the inclusive bound. Confirmation support still uses the specification's strict
cutoff. Passing these schedules does not prove universal liveness, TSQ, or a healing deadline.

The fuzz profiles sample honest delays from `[0, delta]`, so an honest vote sent at `t_s + delta`
can arrive at exactly `t_s + 2 * delta`, the support cutoff. The spec counts such a vote as a
participant but not as support. At `n = 4` two such votes leave the confirmation walk without a
majority, the fast set empty, and the node without an FG attestation for that round. In the earlier
reannouncement-enabled simulator, heavy seed 204038 at `--n 4 --byzantine 1` stalled this way for
144 instants after its last fault and failed the 128-instant liveness bound; with `--delay-max 3`
it healed in 4, and with a larger bound the same trace healed at 544 and finalized normally.
Removing reannouncements changes the random draw sequence, so those numbers describe that earlier
execution, not a regression expectation for the current simulator. The spec never states whether the delivery
bound is strict or inclusive. Its timing argument ("every honest vote of slot s reaches it by
t_s + 2Δ", read by the tick at that time) only holds under strict delivery. The simulator's
inclusive bound therefore exposes a case the argument does not cover. Which reading the model
intends, and so whether this is a modeling choice or a liveness gap, is an open question for
the specification. The spec gives no healing deadline, so the 128-instant bound is the
simulator's, not a specified one.

### Checks, coverage, and verdicts

`Config.checks` selects four checks, with coverage sampled once per public tick after deliveries.
Finality also compares each new finalized output immediately, including between public ticks.
The premises are explicit experimental assumptions, not theorems supplied by the PDF.
Compatibility means equal roots or ancestry in the simulator's global block store.

- `finality` (default on): compare retained finalized outputs of non-faulty nodes while
  `3 * faulty < n`. A sleeping node's last observed output remains in the comparison. Local
  monotonicity ensures later outputs extend earlier ones, so retaining the latest output covers
  its ancestors. Conflicting outputs return `FinalityConflict`.
- `confirmation` (default on): compare current awake non-faulty outputs while
  `confirmationPremises()` holds: `2 * faulty < n`, and within the last `k + 2` slots no honest
  cut or honest sleep/wake. Conflicts return `ConfirmationConflict`.
  This premise is experimental; do not remove it merely to make a campaign exercise the check.
- `height_progress_bound` (default null): the previous height-progress property, now named
  explicitly. Under `heightProgressPremises()` (fewer than a third faulty, an awake honest quorum,
  no current honest cut), fail with `HeightProgressStall` after the bound without any honest
  `h_max` advance. Fault inputs, cuts, churn, and height advances reset its aggregate timer.
- `finalization_bound` (default null): under `finalizationPremises()`, every node must advance
  its finalized root within the caller's bound, measured from genesis or that node's latest
  advance. Another node's progress cannot reset its timer. Failure returns `FinalizationStall`.
  The premises require zero faulty identities, continuously awake nodes, no honest cut or churn
  in the run's history, healthy storage, and block/vote delays strictly below `delta`.
  Attestations retain their configured `delta_f` bound. This check makes no post-partition
  recovery claim. The PDF does not specify a universal finalization deadline.

`coverage` records active and skipped public-tick samples for each enabled check. Disabled checks
have zero counts. Confirmation samples before the first complete `k + 2`-slot window count as
`warmup`: comparisons still run when their premises hold, but do not establish mature coverage.

`verdict()` and the CLI distinguish:

- `passed`: no failure. The per-check counts say how often each enabled check sampled; a check
  with zero active samples proved nothing, and this is not evidence for disabled properties.
- `property_failure`: a safety, progress, or local invariant check failed.
- `incomplete`: a resource or dependency failure stopped execution.

The CLI exits unsuccessfully for all verdicts other than `passed`. Sweeps count the three
verdicts separately and report per-seed coverage. After any execution failure the
simulator retains its error and refuses further ticks; a property failure is not relabeled as
resource exhaustion.

With block requests off, a height-progress stall after packet loss can reflect missing history,
not an AC/FG defect. A later height advance does not establish that every node recovered its
history.

## Seeded Byzantine faults

`Config.fuzz` turns a run into a ByzzFuzz-style search. Everything below is drawn from the seed at
creation and recorded in `Simulator.plan`, which the replay digest covers.

- A Byzantine set of `byzantine` validators, drawn without replacement and marked faulty for the
  cluster checks. They run the honest Node; their behaviour comes from the transport.
- `process_fault_slots` slots and `network_fault_slots` slots, each drawn without replacement from
  `[first_slot, last_slot]`.
- In a process-fault slot, each object a Byzantine validator sends gets an outcome per receiver:
  dropped (`drop_rate`), delivered late by `delta + 1` to `late_max` instants (`late_rate`), mutated
  (`mutation_rate`), or delivered unchanged. Rates are per mille. Different receivers can get
  different outcomes, which is how equivocation and selective release arise without attack code.
- In a network-fault slot, nodes are split into two or three groups on one or both channels for that
  slot. The previous partition heals before the next slot's partition is applied, including when
  consecutive slots select different channels. Fuzz partitions overwrite scripted link controls.

A mutation is one step away from the honest object and still well formed, so it exercises protocol
logic and not only the drop path:

| Object      | Mutations                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vote        | head to its parent; head to a sibling; slot down; slot up                                                              |
| Attestation | `tau` flipped; `h` up; `h` down; `T` to its parent; finality pair dropped; finality pair added as `(h - 1, parent(T))` |
| Block       | no attestations; no support list; parent to grandparent; no votes                                                      |

A mutated object is stored as a new packet, created at mutation time, signed by the same Byzantine
sender, so witness checks accept it, and later honest blocks may carry it. Every fuzz outcome is a
`fuzz` trace entry: `node` is the receiver, `peer` the sender, `value` the `Mutation` tag or one of
`fuzz_drop`, `fuzz_late`, `fuzz_partition`, `fuzz_heal`. Each outcome also counts as a fault input
for the height-progress check, so its bound runs from the last fault.

The sweep is the search: `run:roguestar -- <seed> fuzz --sweep N` runs seven validators with
two Byzantine, three process-fault slots and two partition slots in slots 1 to 10, then a fault-free
suffix to slot 31 with a height-progress bound of four rounds. A failing seed reproduces by seed. What a
mutation cannot do: wait for the honest head and then choose. The mutation applies to the object the
Byzantine node built from its own honest view, so the adversary is one step adaptive.

### Twins

`Config.twins` adds replicas that run the honest Node under an existing validator's identity. A
twin takes the identity of the fuzz plan's first Byzantine validators, or of validators 0.. without
a plan, and that identity is marked faulty. The two replicas keep separate views, so when a partition
or a fuzz delivery splits what they see, one signer votes, attests and proposes on two chains,
coherently, from honest code. That is the adversary a one-field mutation cannot produce: its
equivocations follow from a view, across message types, and they react to what each view shows.
Packets carry both the publishing node and the signing validator; witness checks use the validator.

### First height-progress delay

`firstHeightProgressDelay()` is the number of instants from the latest fault input to the first
observed honest height advance after it, or null when none occurred. With no faults, it measures
from genesis. It replaces `healingTime()` because the metric establishes neither finalization nor
per-node recovery. Sweeps report `height_progressed` and the mean/maximum delay, not healed seeds.

## Bounds and remaining work

The current run supports up to 16 Nodes, 4096 signed objects, 16384 pending deliveries, 256 scripted
commands, 262144 trace entries, and 4096 integer instants. The protocol's own 64-slot horizon can be
smaller. Block storage retains at most 256 originated/injected blocks. Capacities are documented
beside their declarations. All allocations happen at creation; cleanup uses the same allocator.

Each instant has a separate 16384-delivery work budget. Zero-delay relays can replenish the queue
while it drains, so queue capacity alone does not bound this work. A due delivery remaining after
the budget is exhausted returns `DeliveryWorkCapacity` and leaves the run incomplete.

Resource or dependency failures end an incomplete run. They are not message loss, invalid wire
rules, eviction permission, or a reason to continue a partially completed tick.

Regressions include negative controls that deliberately erase pending finality while real Nodes
continue height progress, and install conflicting finalized caches across sleep. These controls
test the checkers; they are not protocol-generated counterexamples. The suite also covers transient
cuts, consecutive partition channels, zero-delay work exhaustion, and checker-state hashing.

Next work is broader fault scheduling, scenario reduction/shrinking, trace-file replay, sustained
finality-stall experiments, and dissemination/security premises. Real cryptographic,
production storage/transport, disk restoration, and NAPI adapters remain separate work.
