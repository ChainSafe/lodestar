//! Bounded, seeded cluster of real Nodes. Dependencies use static dispatch, not callbacks.
//! All allocations happen at creation. Exhaustion ends an incomplete run, never simulated loss.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const node_module = @import("../Node.zig");
const FG = @import("../fg/FinalityGadget.zig");
const Frame = @import("../fg/FinalityFrame.zig");
const types = @import("../types.zig");
const limits = @import("../limits.zig");
const Clock = @import("Clock.zig");
const Transport = @import("Transport.zig");
const Storage = @import("Storage.zig");
const Signer = @import("Signer.zig");
const StateSource = @import("StateSource.zig");
const Hash = @import("Hash.zig");
pub const Node = node_module.NodeType(Clock, Transport, Storage, Signer, StateSource);
const Simulator = @This();
const Time = types.Time;
const Root = types.Root;

/// Simulator bounds, not protocol constants. Sixteen Nodes reserve substantial FG storage.
pub const max_nodes = 16;
/// Retained signed objects. Relaying reuses an object rather than allocating another.
pub const max_packets = 4096;
/// Includes both in-flight deliveries and messages retained across sleep.
pub const max_pending = 16384;
/// Total delivery work at one instant, independent of simultaneous queue occupancy.
pub const max_deliveries_per_instant = 16384;
/// Explicit input actions, separate from the Nodes' protocol duties.
pub const max_commands = 256;
/// Trace exhaustion is an error, not silent truncation. A heavy fuzz run to slot 48 with seven
/// nodes writes about 100k entries.
pub const max_trace = 262144;
/// Maximum integer time steps. Delta may contain multiple units for sub-tick delivery.
pub const max_time = 4096;
/// Upper bound on fault slots of each kind in a fuzz plan.
pub const max_fault_slots = 8;
/// At most one observation per node per instant: a later answer in the same instant replaces the
/// earlier one.
pub const max_history = max_nodes * max_time;

pub const Error = Node.Error || error{
    OutOfMemory,
    InvalidConfiguration,
    InvalidAction,
    PacketCapacity,
    QueueCapacity,
    CommandCapacity,
    TraceCapacity,
    InvariantViolation,
    IncompleteRun,
    FinalityConflict,
    ConfirmationConflict,
    HeightProgressStall,
    FinalizationStall,
    DeliveryWorkCapacity,
};
pub const Channel = enum { blocks_votes, attestations };
pub const Delay = struct { min: Time = 1, max: Time = 1 };
pub const Config = struct {
    protocol: node_module.Config,
    seed: u64 = 1,
    blocks_votes: Delay = .{},
    attestations: Delay = .{},
    /// null selects slot % n; otherwise every slot has this assigned proposer.
    proposer: ?u32 = null,
    /// Cross-node checks, evaluated once per public tick after that tick's deliveries.
    checks: Checks = .{},
    /// Seeded Byzantine and network faults in the ByzzFuzz style. null runs no fuzz plan.
    fuzz: ?Fuzz = null,
    /// Write a hashed state snapshot to the trace after every tick and delivery. Replay comparisons
    /// need it; a sweep that only wants the checks does not, and it is most of a run's cost.
    snapshots: bool = true,
    /// Twins: extra replicas that run the honest Node under an existing validator's identity, so one
    /// signer has two views and equivocates coherently without attack code. Twin identities are the
    /// first Byzantine validators of the fuzz plan, or validators 0.. without a plan; they are marked
    /// faulty. Nodes are n + twins and must fit max_nodes.
    twins: u32 = 0,
    /// Whether the transport carries a Node's request for a missing parent block. false loses
    /// every request: a kept block is then released only when its parent arrives by broadcast.
    block_requests: bool = true,
};
/// A fuzz plan is drawn from the seed at creation: a Byzantine set, process-fault slots, and
/// network-fault slots with a partition each. Byzantine validators run the honest Node. In a
/// process-fault slot the transport drops, delays, or mutates each of their outgoing objects per
/// receiver, so receivers can see different objects from one signer. Mutated objects carry a valid
/// witness: the Byzantine signer signed them. Fuzz partitions overwrite scripted link controls.
pub const Fuzz = struct {
    /// Byzantine validators, drawn without replacement. Marked faulty for the cluster checks.
    byzantine: u32 = 1,
    /// Slots with process faults and slots with a partition, each drawn without replacement
    /// from [first_slot, last_slot]. A partition lasts its slot and heals at the next slot start.
    process_fault_slots: u32 = 2,
    network_fault_slots: u32 = 2,
    first_slot: u32 = 1,
    last_slot: u32 = 8,
    /// Per-receiver outcome rates per mille for a Byzantine object in a process-fault slot.
    /// The remainder of 1000 delivers the object unchanged with an honest delay.
    drop_rate: u32 = 100,
    late_rate: u32 = 200,
    mutation_rate: u32 = 500,
    /// Greatest late delay in instants; a late delay is drawn from [delta + 1, late_max].
    late_max: Time = 32,
};
/// Small-scope mutations: one step away from the honest object, and still well formed.
pub const Mutation = enum(u8) {
    vote_head_parent,
    vote_head_sibling,
    vote_slot_down,
    vote_slot_up,
    attestation_tau,
    attestation_height_up,
    attestation_height_down,
    attestation_target_parent,
    attestation_finality_drop,
    attestation_finality_add,
    block_no_attestations,
    block_no_support,
    block_parent_up,
    block_no_votes,
};
/// Trace values of fuzz entries that are not mutations.
pub const fuzz_drop: u64 = 100;
pub const fuzz_late: u64 = 101;
pub const fuzz_partition: u64 = 200;
pub const fuzz_heal: u64 = 201;
/// The drawn plan. Public for tests and reports; the digest covers it.
pub const Plan = struct {
    byzantine: u64 = 0,
    process_slots: [max_fault_slots]?u32 = @splat(null),
    network_slots: [max_fault_slots]?u32 = @splat(null),
    /// Per network-fault slot: a group per node, the group count, and a channel bitmask
    /// (bit 0 blocks_votes, bit 1 attestations).
    groups: [max_fault_slots][max_nodes]u8 = @splat(@splat(0)),
    group_count: [max_fault_slots]u8 = @splat(0),
    channels: [max_fault_slots]u8 = @splat(0),
};
/// Experimental checker premises, not safety theorems or deadlines supplied by the PDF.
pub const Checks = struct {
    /// Compare retained finality observations of non-faulty nodes, including sleeping nodes,
    /// while 3 * faulty < n. Confirmation compares only current awake outputs.
    finality: bool = true,
    /// Compare confirmed tips while confirmationPremises holds: 2 * faulty < n, and within
    /// the last k + 2 slots no honest cut or honest sleep/wake.
    confirmation: bool = true,
    /// Under heightProgressPremises, some honest node must report a higher justified height within
    /// this bound. This is not finalization or recovery. Fault inputs, honest cuts/churn, and any
    /// such advance reset the timer. A height that advances by timeout alone does not count.
    height_progress_bound: ?Time = null,
    /// Caller-selected per-node finalization inactivity bound, starting at genesis.
    /// Applies only to fault-free, continuously awake/connected runs with strict block/vote delay.
    /// No post-partition recovery claim or universal finalization deadline is implied.
    finalization_bound: ?Time = null,
};
pub const CheckCoverage = struct {
    active: u32 = 0,
    skipped: u32 = 0,
    /// Startup samples before the confirmation window is complete. Comparisons still run
    /// when their premises hold, but cannot establish mature campaign coverage.
    warmup: u32 = 0,

    fn record(self: *CheckCoverage, applies: bool, warmed_up: bool) bool {
        if (!warmed_up) self.warmup += 1 else if (applies) self.active += 1 else self.skipped += 1;
        return applies;
    }
};
pub const Coverage = struct {
    finality: CheckCoverage = .{},
    confirmation: CheckCoverage = .{},
    height_progress: CheckCoverage = .{},
    finalization: CheckCoverage = .{},
};
pub const Verdict = enum { passed, property_failure, incomplete };
/// What a node told its clients, recorded when the answer changes. The cluster checks read this
/// history, the shared block store and the simulator's own fault record, never a Node's fields.
pub const Observation = struct { time: Time, node: u32, tips: node_module.Tips };
pub const Link = struct { from: u32, to: u32, channel: Channel, connected: bool };
pub const Control = union(enum) {
    sleep: u32,
    /// A sleep that also loses the node's memory: the next wake rebuilds the Node from Storage.
    crash: u32,
    wake: u32,
    link: Link,
    storage_failure: struct { node: u32, enabled: bool },
    /// A late host: the node runs no ticks and receives nothing until `until`, then catches up
    /// through `Node.advance` and receives everything that arrived meanwhile. Unlike sleep, AC does
    /// not restart. `until` must be after the control's time.
    host_pause: struct { node: u32, until: Time },
};
pub const Kind = enum {
    tick,
    publish,
    queued,
    deliver,
    drop,
    retained,
    sleep,
    wake,
    host_pause,
    host_resume,
    control,
    persist,
    snapshot,
    /// A fuzz action: value is a Mutation tag, fuzz_drop, fuzz_late, fuzz_partition, or fuzz_heal.
    fuzz,
    /// A request for the parent of block `packet`: node is the peer asked, peer the requester,
    /// value the due time.
    block_request,
    /// The answer to a request: node is the peer asked, peer the requester. value is 1 with the
    /// parent's packet when served, 0 with the request's packet when the peer lacks the parent.
    block_response,
    crash,
};
pub const Trace = struct {
    time: Time,
    kind: Kind,
    node: u32,
    peer: u32 = 0,
    packet: u32 = 0,
    value: u64 = 0,
    state: Root = @splat(0),
};
const Body = union(enum) { block: u32, vote: types.GoldfishVote, attestation: FG.Attestation };
/// `sender` is the node that published the packet; `validator` is the identity that signed it,
/// which twins share. `derived` marks a mutated copy: it is never mutated again, so a fuzz plan
/// stays one step from the honest object and the block store stays bounded.
const Packet = struct {
    sender: u32,
    validator: u32,
    created: Time,
    authenticated: bool,
    derived: bool,
    body: Body,
};
const Pending = struct {
    packet: u32,
    from: u32,
    to: u32,
    sent: Time,
    delay: Time,
    due: ?Time,
    sequence: u64,
    /// A request from `from` to `to` for the parent of block `packet`, not a delivery of it.
    request: bool = false,
};
const Command = struct {
    time: Time,
    body: union(enum) { control: Control, publish: struct { packet: u32, targets: u64 } },
};
const Replica = struct {
    node: Node,
    clock: Clock,
    transport: Transport,
    storage: Storage,
    signer: Signer,
    state_source: StateSource,
    /// Index in the history of this node's latest observation; null only during creation.
    reported: ?u32,
    /// Greatest justified height this node reported at a cluster check; progress raises it.
    justified_height_seen: u32,
    /// Time of the latest observed finalized-root advance; zero starts the genesis deadline.
    last_finalization: Time,
    /// The validator identity this replica signs as. Equal to the replica index unless it is a twin.
    validator: u32,
    /// Set by a host_pause control until the resume instant.
    paused_until: ?Time,
    /// Set by a crash control until the wake that restores the node.
    crashed: bool,
};
const Block = struct {
    root: Root,
    slot: u32,
    parent: Root,
    proposer: u32,
    votes: BoundedArray(Frame.SignedVote, limits.max_vote_set),
    support: BoundedArray(types.GoldfishVote, limits.max_vote_set),
    attestations: FG.AttestationList,

    fn init(self: *Block, B: *const FG.Block) void {
        self.root = B.root;
        self.slot = B.slot;
        self.parent = B.parent;
        self.proposer = B.proposer;
        self.votes = .{};
        self.support = .{};
        self.attestations = .{};
        for (B.ac_payload.votes) |v| self.votes.push(v);
        for (B.ac_payload.support_votes) |v| self.support.push(v);
        for (B.attestations) |a| self.attestations.push(a);
    }
    fn view(self: *const Block) FG.Block {
        return .{
            .root = self.root,
            .slot = self.slot,
            .parent = self.parent,
            .proposer = self.proposer,
            .ac_payload = .{
                .votes = self.votes.constSlice(),
                .support_votes = self.support.constSlice(),
            },
            .attestations = self.attestations.constSlice(),
        };
    }
};

allocator: std.mem.Allocator,
config: Config,
now: Time,
next_time: Time,
failed: bool,
failure: ?Error,
delivery_packet: ?u32,
rng: u64,
sequence: u64,
/// Injected signers, not an unconditional declaration that all other nodes satisfy network bounds.
faulty: u64,
/// Cluster-check bookkeeping: the latest instant a scripted command ran, the latest public tick with
/// a cut between two non-faulty nodes (including cut/heal controls between ticks), the latest
/// honest sleep/wake, and the latest public tick at which an honest node raised h_max.
last_fault: Time,
last_honest_cut: ?Time,
last_honest_churn: ?Time,
last_height_progress: Time,
/// First time after the latest fault input that an honest node reported a higher justified
/// height. Not evidence of recovery.
first_height_progress_after_fault: ?Time,
coverage: Coverage,
plan: Plan,
replicas: []Replica,
blocks: BoundedArray(Block, limits.max_blocks),
packets: BoundedArray(Packet, max_packets),
pending: BoundedArray(Pending, max_pending),
commands: BoundedArray(Command, max_commands),
trace: BoundedArray(Trace, max_trace),
history: BoundedArray(Observation, max_history),
links: [2][max_nodes][max_nodes]bool,

pub fn create(allocator: std.mem.Allocator, config: *const Config) Error!*Simulator {
    const n = config.protocol.n;
    if (n == 0 or n > max_nodes or config.twins > n or n + config.twins > max_nodes) {
        return error.InvalidConfiguration;
    }
    if (config.proposer) |v| if (v >= n) return error.InvalidConfiguration;
    if (!validDelay(config.blocks_votes, config.protocol.ac.delta) or
        !validDelay(config.attestations, config.protocol.fg.delta_f)) return error.InvalidConfiguration;
    if (config.fuzz) |fuzz| {
        if (!validFuzz(fuzz, n, config.protocol.ac.delta)) return error.InvalidConfiguration;
    }
    const self = try allocator.create(Simulator);
    errdefer allocator.destroy(self);
    self.replicas = try allocator.alloc(Replica, n + config.twins);
    errdefer allocator.free(self.replicas);
    self.allocator = allocator;
    self.config = config.*;
    self.now = 0;
    self.next_time = 0;
    self.failed = false;
    self.failure = null;
    self.delivery_packet = null;
    self.rng = config.seed;
    self.sequence = 0;
    self.faulty = 0;
    self.last_fault = 0;
    self.last_honest_cut = null;
    self.last_honest_churn = null;
    self.last_height_progress = 0;
    self.first_height_progress_after_fault = null;
    self.coverage = .{};
    self.plan = .{};
    self.blocks = .{};
    self.packets = .{};
    self.pending = .{};
    self.commands = .{};
    self.trace = .{};
    self.history = .{};
    self.links = @splat(@splat(@splat(true)));
    if (config.fuzz) |fuzz| {
        self.drawPlan(&fuzz);
        self.faulty = self.plan.byzantine;
    }
    for (self.replicas, 0..) |*replica, v| {
        replica.validator = if (v < n) @intCast(v) else self.twinIdentity(@intCast(v - n));
        if (v >= n) self.faulty |= bit(replica.validator);
        replica.clock = .{ .time = &self.now };
        replica.storage = .{ .simulator = self, .index = @intCast(v), .record = undefined };
        replica.transport = .{
            .simulator = self,
            .index = @intCast(v),
            .storage = &replica.storage,
        };
        replica.signer = .{ .simulator = self, .index = @intCast(v) };
        try replica.state_source.init(&.{
            .B_gen = config.protocol.B_gen,
            .n = n,
            .K_W = config.protocol.fg.K_W,
            .delta_t = config.protocol.fg.delta_t,
        });
        var protocol = config.protocol;
        protocol.val_index = replica.validator;
        try replica.node.init(&protocol, &.{
            .clock = &replica.clock,
            .transport = &replica.transport,
            .storage = &replica.storage,
            .signer = &replica.signer,
            .state_source = &replica.state_source,
        });
        replica.storage.record = replica.node.Lambda;
        replica.reported = null;
        replica.justified_height_seen = 0;
        replica.last_finalization = 0;
        replica.paused_until = null;
        replica.crashed = false;
    }
    for (0..self.replicas.len) |v| try self.record(@intCast(v));
    return self;
}

pub fn destroy(self: *Simulator) void {
    const allocator = self.allocator;
    allocator.free(self.replicas);
    allocator.destroy(self);
}

/// The identity of twin `i`: the i-th Byzantine validator of the fuzz plan while there are enough,
/// otherwise validator `i`.
fn twinIdentity(self: *const Simulator, i: u32) u32 {
    var remaining = i;
    var bits = self.plan.byzantine;
    while (bits != 0) : (bits &= bits - 1) {
        if (remaining == 0) return @ctz(bits);
        remaining -= 1;
    }
    return i;
}

/// Instants from the latest fault input to the first higher justified height an honest node
/// reported after it, or null when none did. With no faults it is the time to first progress.
pub fn firstHeightProgressDelay(self: *const Simulator) ?Time {
    const progress = self.first_height_progress_after_fault orelse return null;
    if (progress < self.last_fault) return null;
    return progress - self.last_fault;
}

/// A passed result covers only checks that sampled; the coverage counters say which did.
pub fn verdict(self: *const Simulator) Verdict {
    if (self.failed) return switch (self.failure orelse return .incomplete) {
        error.FinalityConflict,
        error.ConfirmationConflict,
        error.InvariantViolation,
        error.HeightProgressStall,
        error.FinalizationStall,
        => .property_failure,
        else => .incomplete,
    };
    return .passed;
}
pub fn node(self: *Simulator, index: u32) *const Node {
    assert(index < self.replicas.len);
    return &self.replicas[index].node;
}
pub fn all(self: *const Simulator) u64 {
    return (@as(u64, 1) << @intCast(self.replicas.len)) - 1;
}

pub fn schedule(self: *Simulator, time: Time, action: Control) Error!void {
    try self.checkInput(time);
    switch (action) {
        .sleep, .crash, .wake => |v| try self.checkNode(v),
        .storage_failure => |f| try self.checkNode(f.node),
        .host_pause => |pause| {
            try self.checkNode(pause.node);
            if (pause.until <= time or pause.until >= self.horizon()) return error.InvalidAction;
        },
        .link => |link| {
            try self.checkNode(link.from);
            try self.checkNode(link.to);
        },
    }
    if (self.commands.full()) return error.CommandCapacity;
    self.commands.push(.{ .time = time, .body = .{ .control = action } });
}

/// An injection marks its physical sender faulty. targets=0 registers a signature witness only.
pub fn injectVote(
    self: *Simulator,
    time: Time,
    sender: u32,
    targets: u64,
    vote: *const types.GoldfishVote,
    authenticated: bool,
) Error!u32 {
    return self.inject(time, sender, targets, .{ .vote = vote.* }, authenticated);
}
pub fn injectAttestation(
    self: *Simulator,
    time: Time,
    sender: u32,
    targets: u64,
    a: *const FG.Attestation,
    authenticated: bool,
) Error!u32 {
    return self.inject(time, sender, targets, .{ .attestation = a.* }, authenticated);
}
pub fn injectBlock(
    self: *Simulator,
    time: Time,
    sender: u32,
    targets: u64,
    B: *const FG.Block,
    authenticated: bool,
) Error!u32 {
    try self.checkInput(time);
    try self.checkNode(sender);
    try self.checkTargets(targets);
    if (self.commands.full()) return error.CommandCapacity;
    if (self.packets.full()) return error.PacketCapacity;
    const index = try self.storeBlock(B);
    return self.inject(time, sender, targets, .{ .block = index }, authenticated);
}

/// At each integer instant: controls, all awake public ticks, then same-time arrivals.
pub fn runUntil(self: *Simulator, end: Time) Error!void {
    if (self.failed) return error.IncompleteRun;
    if (end < self.next_time or end >= self.horizon()) return error.InvalidAction;
    for (self.next_time..end + 1) |_| try self.tick();
}

pub fn digest(self: *const Simulator) Root {
    var h: Hash = .{};
    h.add(&self.config);
    h.add(.{ self.now, self.next_time, self.rng, self.sequence, self.faulty, self.failed });
    h.add(.{ self.last_fault, self.last_honest_cut, self.last_honest_churn, self.last_height_progress });
    h.add(self.first_height_progress_after_fault);
    h.add(&self.coverage);
    h.add(if (self.failure) |err| @errorName(err) else "");
    h.add(self.delivery_packet);
    h.add(&self.plan);
    h.add(self.commands.constSlice());
    h.add(self.pending.constSlice());
    h.add(&self.links);
    h.add(self.packets.count);
    for (self.packets.constSlice()) |*p| h.add(self.packetDigest(p));
    for (self.replicas) |*replica| {
        h.add(Hash.nodeDigest(&replica.node));
        h.add(&replica.state_source);
        h.add(&replica.storage.record);
        h.add(.{ replica.storage.fail_writes, replica.reported, replica.justified_height_seen, replica.last_finalization, replica.validator });
        h.add(.{ replica.paused_until, replica.node.late_ticks, replica.crashed });
        h.add(.{ &replica.storage.journal, &replica.storage.ac });
    }
    h.add(self.trace.constSlice());
    h.add(self.history.constSlice());
    return h.finish();
}

/// Advance one virtual-time unit: controls, all due Node ticks, then network arrivals.
pub fn tick(self: *Simulator) Error!void {
    if (self.failed) return error.IncompleteRun;
    if (self.next_time >= self.horizon()) return error.InvalidAction;
    errdefer |err| {
        self.failed = true;
        if (self.failure == null) self.failure = err;
    }
    self.now = self.next_time;
    for (self.commands.constSlice(), 0..) |*command, i| {
        if (command.time != self.now) continue;
        self.last_fault = self.now;
        switch (command.body) {
            .control => |action| try self.applyControl(action, @intCast(i)),
            .publish => |p| try self.multicast(p.packet, p.targets),
        }
    }
    if (self.config.fuzz != null and self.now % (4 * self.config.protocol.ac.delta) == 0) {
        try self.applyFuzzNetwork(self.slotOf(self.now));
    }
    if (self.now % self.config.protocol.ac.delta == 0) {
        for (self.replicas, 0..) |*replica, v| {
            if (!replica.node.awake or replica.paused_until != null) continue;
            try self.log(.{ .time = self.now, .kind = .tick, .node = @intCast(v) });
            replica.node.onTick() catch |err| return self.failure orelse err;
            try self.observe(@intCast(v));
        }
    }
    for (self.replicas, 0..) |*replica, v| {
        const until = replica.paused_until orelse continue;
        if (until > self.now) continue;
        try self.resumeHost(@intCast(v));
    }
    for (0..max_deliveries_per_instant) |_| {
        const i = self.nextDelivery() orelse break;
        const delivery = self.pending.buffer[i];
        self.pending.buffer[i] = self.pending.pop().?;
        try self.deliver(&delivery);
    }
    if (self.nextDelivery() != null) return error.DeliveryWorkCapacity;
    if (self.now % self.config.protocol.ac.delta == 0) {
        if (self.honestPartitioned()) self.last_honest_cut = self.now;
        try self.checkCluster();
    }
    self.next_time = self.now + 1;
}

/// Cross-node checks at a public tick, after its deliveries. See Checks for the premises.
fn checkCluster(self: *Simulator) Error!void {
    const checks = self.config.checks;
    const n = self.config.protocol.n;
    const faulty_count: u32 = @popCount(self.faulty);
    var finalized: [max_nodes]?Root = @splat(null);
    var confirmed: [max_nodes]?Root = @splat(null);
    var awake_honest: u32 = 0;
    for (self.replicas, 0..) |*replica, i| {
        if (self.isFaulty(replica.validator)) continue;
        const reported = self.tips(@intCast(i));
        finalized[i] = reported.finalized.root;
        if (!replica.node.awake) continue;
        awake_honest += 1;
        if (reported.justified.height > replica.justified_height_seen) {
            replica.justified_height_seen = reported.justified.height;
            self.last_height_progress = self.now;
            if (self.first_height_progress_after_fault == null or
                self.first_height_progress_after_fault.? < self.last_fault)
            {
                self.first_height_progress_after_fault = self.now;
            }
        }
        confirmed[i] = reported.confirmed.root;
    }
    if (checks.finality and self.coverage.finality.record(3 * faulty_count < n, true)) {
        try self.pairwiseCompatible(&finalized, error.FinalityConflict);
    }
    if (checks.confirmation and self.coverage.confirmation.record(
        self.confirmationPremises(),
        self.now >= self.confirmationWindow(),
    )) {
        try self.pairwiseCompatible(&confirmed, error.ConfirmationConflict);
    }
    if (checks.height_progress_bound) |bound| {
        if (self.coverage.height_progress.record(self.heightProgressPremises(awake_honest), true)) {
            var quiet = @max(self.last_fault, self.last_height_progress);
            if (self.last_honest_cut) |t| quiet = @max(quiet, t);
            if (self.last_honest_churn) |t| quiet = @max(quiet, t);
            if (self.now - quiet > bound) return error.HeightProgressStall;
        }
    }
    if (checks.finalization_bound) |bound| {
        if (self.coverage.finalization.record(self.finalizationPremises(), true)) {
            for (self.replicas) |*replica| {
                if (self.now - replica.last_finalization > bound) return error.FinalizationStall;
            }
        }
    }
}

fn pairwiseCompatible(self: *const Simulator, roots: *const [max_nodes]?Root, failure: Error) Error!void {
    for (roots, 0..) |a_opt, i| {
        const a = a_opt orelse continue;
        for (roots[i + 1 ..]) |b_opt| {
            const b = b_opt orelse continue;
            if (!self.compatible(&a, &b)) return failure;
        }
    }
}

/// Two roots are compatible when equal or when one descends from the other in the global block store.
pub fn compatible(self: *const Simulator, a: *const Root, b: *const Root) bool {
    return self.descends(a, b) or self.descends(b, a);
}

/// Whether `descendant` is `ancestor` or descends from it, walking parents through stored blocks.
/// A root that no stored block carries ends the walk: an unknown block descends from nothing.
fn descends(self: *const Simulator, ancestor: *const Root, descendant: *const Root) bool {
    var cursor = descendant.*;
    for (0..limits.max_blocks + 1) |_| {
        if (std.mem.eql(u8, &cursor, ancestor)) return true;
        if (std.mem.eql(u8, &cursor, &self.config.protocol.B_gen)) return false;
        const index = self.findBlock(&cursor) orelse return false;
        cursor = self.blocks.buffer[index].parent;
    }
    return false;
}

pub fn findBlock(self: *const Simulator, root: *const Root) ?u32 {
    for (self.blocks.constSlice(), 0..) |*B, i| {
        if (std.mem.eql(u8, &B.root, root)) return @intCast(i);
    }
    return null;
}

fn isFaulty(self: *const Simulator, v: u32) bool {
    return self.faulty & bit(v) != 0;
}

/// Whether deliveries to this node are due now rather than retained: awake and not paused.
fn receiving(self: *const Simulator, v: u32) bool {
    const replica = &self.replicas[v];
    return replica.node.awake and replica.paused_until == null;
}

/// Whether any link between two non-faulty nodes is cut on any channel right now.
fn honestPartitioned(self: *const Simulator) bool {
    for (self.replicas, 0..) |*from_replica, from| {
        if (self.isFaulty(from_replica.validator)) continue;
        for (self.replicas, 0..) |*to_replica, to| {
            if (from == to or self.isFaulty(to_replica.validator)) continue;
            for (&self.links) |*channel_links| {
                if (!channel_links[from][to]) return true;
            }
        }
    }
    return false;
}

fn recent(self: *const Simulator, time: ?Time, window: Time) bool {
    const t = time orelse return false;
    return self.now - t < window;
}

/// Premises of the confirmation check: fewer than half the nodes faulty, and within the last k + 2
/// slots no cut between non-faulty nodes and no sleep or wake of a non-faulty node. The window
/// covers a lock's life plus its unlock and expiry ticks. Faulty proposers are in scope: the
/// paper's confirmation safety rests on an honest majority and synchrony, not on the proposer.
pub fn confirmationPremises(self: *const Simulator) bool {
    const n = self.config.protocol.n;
    if (2 * @as(u32, @popCount(self.faulty)) >= n) return false;
    const window = self.confirmationWindow();
    if (self.recent(self.last_honest_cut, window)) return false;
    if (self.recent(self.last_honest_churn, window)) return false;
    return true;
}

fn confirmationWindow(self: *const Simulator) Time {
    const ac = self.config.protocol.ac;
    return 4 * ac.delta * (ac.k + 2);
}

/// Premises of the aggregate height-progress check, not a finalization or recovery theorem.
pub fn heightProgressPremises(self: *const Simulator, awake_honest: u32) bool {
    const n = self.config.protocol.n;
    if (3 * @as(u32, @popCount(self.faulty)) >= n) return false;
    if (awake_honest < (2 * n + 2) / 3) return false;
    return !self.honestPartitioned();
}

pub fn finalizationPremises(self: *const Simulator) bool {
    if (self.faulty != 0 or self.last_honest_cut != null or self.last_honest_churn != null) return false;
    if (self.config.blocks_votes.max >= self.config.protocol.ac.delta) return false;
    for (self.replicas) |*replica| {
        if (!replica.node.awake or replica.node.stopped or replica.storage.fail_writes) return false;
    }
    return !self.honestPartitioned();
}

fn applyControl(self: *Simulator, action: Control, index: u32) Error!void {
    try self.log(.{
        .time = self.now,
        .kind = .control,
        .node = 0,
        .value = index,
        .state = Hash.of(action),
    });
    switch (action) {
        .link => |l| {
            if (self.honestPartitioned()) self.last_honest_cut = self.now;
            self.links[@intFromEnum(l.channel)][l.from][l.to] = l.connected;
            if (self.honestPartitioned()) self.last_honest_cut = self.now;
        },
        .storage_failure => |f| self.replicas[f.node].storage.fail_writes = f.enabled,
        .host_pause => |pause| {
            const replica = &self.replicas[pause.node];
            if (pause.until <= self.now or pause.until >= self.horizon()) return error.InvalidAction;
            if (!replica.node.awake or replica.paused_until != null) return error.InvalidAction;
            replica.paused_until = pause.until;
            if (!self.isFaulty(replica.validator)) self.last_honest_churn = self.now;
            for (self.pending.slice()) |*p| {
                if (p.to == pause.node and p.due != null) {
                    p.due = null;
                    try self.log(.{
                        .time = self.now,
                        .kind = .retained,
                        .node = pause.node,
                        .peer = p.from,
                        .packet = p.packet,
                    });
                }
            }
            try self.log(.{ .time = self.now, .kind = .host_pause, .node = pause.node, .value = pause.until });
        },
        .sleep, .crash => |v| {
            try self.replicas[v].node.sleep();
            self.replicas[v].crashed = action == .crash;
            if (!self.isFaulty(self.replicas[v].validator)) self.last_honest_churn = self.now;
            for (self.pending.slice()) |*p| {
                if (p.to == v and p.due != null) {
                    p.due = null;
                    try self.log(.{
                        .time = self.now,
                        .kind = .retained,
                        .node = v,
                        .peer = p.from,
                        .packet = p.packet,
                    });
                }
            }
            try self.log(.{ .time = self.now, .kind = if (action == .crash) .crash else .sleep, .node = v });
        },
        .wake => |v| {
            if (self.replicas[v].crashed) try self.restoreReplica(v) else try self.replicas[v].node.wake();
            if (!self.isFaulty(self.replicas[v].validator)) self.last_honest_churn = self.now;
            for (self.pending.slice()) |*p| {
                if (p.to == v and p.due == null) {
                    p.due = @max(p.sent, self.now) + p.delay;
                    try self.log(.{
                        .time = self.now,
                        .kind = .queued,
                        .node = v,
                        .peer = p.from,
                        .packet = p.packet,
                        .value = p.due.?,
                    });
                }
            }
            try self.log(.{ .time = self.now, .kind = .wake, .node = v });
            if (self.now % self.config.protocol.ac.delta != 0) try self.observe(v);
        },
    }
}

/// Nothing of the crashed Node survives: it and its chain states are rebuilt from Storage.
fn restoreReplica(self: *Simulator, v: u32) Error!void {
    const replica = &self.replicas[v];
    const protocol_config = &self.config.protocol;
    replica.node = undefined;
    try replica.state_source.init(&.{
        .B_gen = protocol_config.B_gen,
        .n = protocol_config.n,
        .K_W = protocol_config.fg.K_W,
        .delta_t = protocol_config.fg.delta_t,
    });
    var protocol = protocol_config.*;
    protocol.val_index = replica.validator;
    replica.node.restore(&protocol, &.{
        .clock = &replica.clock,
        .transport = &replica.transport,
        .storage = &replica.storage,
        .signer = &replica.signer,
        .state_source = &replica.state_source,
    }) catch |err| return self.failure orelse err;
    replica.crashed = false;
}

/// The paused host calls advance at the resume instant, before this instant's deliveries, and then
/// receives everything retained meanwhile at once. Catch-up is a churn event for the checker premises.
fn resumeHost(self: *Simulator, v: u32) Error!void {
    const replica = &self.replicas[v];
    replica.paused_until = null;
    if (!self.isFaulty(replica.validator)) self.last_honest_churn = self.now;
    self.last_fault = self.now;
    try self.log(.{ .time = self.now, .kind = .host_resume, .node = v, .value = replica.node.late_ticks });
    replica.node.advance() catch |err| return self.failure orelse err;
    for (self.pending.slice()) |*p| {
        if (p.to == v and p.due == null) {
            p.due = self.now;
            try self.log(.{
                .time = self.now,
                .kind = .queued,
                .node = v,
                .peer = p.from,
                .packet = p.packet,
                .value = self.now,
            });
        }
    }
    try self.observe(v);
}

/// Publish once to each target, with per-recipient Byzantine faults. No automatic retransmission.
fn multicast(self: *Simulator, index: u32, targets: u64) Error!void {
    const packet = &self.packets.buffer[index];
    try self.log(.{
        .time = self.now,
        .kind = .publish,
        .node = packet.sender,
        .packet = index,
        .value = targets,
        .state = self.packetDigest(packet),
    });
    for (self.replicas, 0..) |_, to| {
        if (targets & bit(@intCast(to)) == 0) continue;
        if (!self.links[@intFromEnum(channel(packet))][packet.sender][to]) {
            try self.log(.{
                .time = self.now,
                .kind = .drop,
                .node = @intCast(to),
                .peer = packet.sender,
                .packet = index,
            });
            continue;
        }
        if (self.pending.full()) return error.QueueCapacity;
        const policy = if (channel(packet) == .blocks_votes)
            self.config.blocks_votes
        else
            self.config.attestations;
        var delivered = index;
        var delay = self.sample(policy);
        switch (try self.byzantineFault(index, @intCast(to))) {
            .none => {},
            .drop => continue,
            .late => |late| delay = late,
            .mutated => |mutated| delivered = mutated,
        }
        const due: ?Time = if (self.receiving(@intCast(to))) self.now + delay else null;
        self.pending.push(.{
            .packet = delivered,
            .from = packet.sender,
            .to = @intCast(to),
            .sent = self.now,
            .delay = delay,
            .due = due,
            .sequence = self.sequence,
        });
        self.sequence += 1;
        try self.log(.{
            .time = self.now,
            .kind = if (due == null) .retained else .queued,
            .node = @intCast(to),
            .peer = packet.sender,
            .packet = delivered,
            .value = due orelse 0,
        });
    }
}

const Fault = union(enum) { none, drop, late: Time, mutated: u32 };

/// The per-receiver fuzz outcome for one queued object: none unless a fuzz plan is set, the sender
/// is Byzantine, and the current slot is a process-fault slot. Every outcome is logged as a fuzz
/// trace entry with the receiver as node and the sender as peer, and counts as a fault input.
fn byzantineFault(self: *Simulator, index: u32, to: u32) Error!Fault {
    const fuzz = self.config.fuzz orelse return .none;
    const sender = self.packets.buffer[index].sender;
    if (self.packets.buffer[index].derived) return .none;
    if (self.plan.byzantine & bit(self.packets.buffer[index].validator) == 0) return .none;
    if (!self.processFaultSlot(self.slotOf(self.now))) return .none;
    const draw = self.random() % 1000;
    if (draw < fuzz.drop_rate) {
        self.last_fault = self.now;
        try self.log(.{ .time = self.now, .kind = .fuzz, .node = to, .peer = sender, .packet = index, .value = fuzz_drop });
        return .drop;
    }
    if (draw < fuzz.drop_rate + fuzz.late_rate) {
        const delta = self.config.protocol.ac.delta;
        const late = delta + 1 + @as(Time, @intCast(self.random() % (fuzz.late_max - delta)));
        self.last_fault = self.now;
        try self.log(.{ .time = self.now, .kind = .fuzz, .node = to, .peer = sender, .packet = index, .value = fuzz_late });
        return .{ .late = late };
    }
    if (draw < fuzz.drop_rate + fuzz.late_rate + fuzz.mutation_rate) {
        if (try self.mutate(index, to)) |mutated| return .{ .mutated = mutated };
    }
    return .none;
}

/// Store a mutated copy of a Byzantine object as a new signed packet and return its index, or null
/// when no small-scope mutation applies to this object. The copy is created now, so later witness
/// checks accept it, and it keeps the original sender.
fn mutate(self: *Simulator, index: u32, to: u32) Error!?u32 {
    const original = self.packets.buffer[index];
    var candidates: [8]Mutation = undefined;
    var count: usize = 0;
    switch (original.body) {
        .vote => |v| {
            if (self.parentOf(&v.head) != null) addCandidate(&candidates, &count, .vote_head_parent);
            if (self.siblingOf(&v.head) != null) addCandidate(&candidates, &count, .vote_head_sibling);
            if (v.slot > 0) addCandidate(&candidates, &count, .vote_slot_down);
            addCandidate(&candidates, &count, .vote_slot_up);
        },
        .attestation => |a| {
            addCandidate(&candidates, &count, .attestation_tau);
            addCandidate(&candidates, &count, .attestation_height_up);
            if (a.h > 1 and (a.h_f == null or a.h_f.? < a.h - 1)) {
                addCandidate(&candidates, &count, .attestation_height_down);
            }
            if (self.parentOf(&a.T) != null) addCandidate(&candidates, &count, .attestation_target_parent);
            if (a.h_f != null) addCandidate(&candidates, &count, .attestation_finality_drop);
            if (a.h_f == null and a.h > 1 and self.parentOf(&a.T) != null) {
                addCandidate(&candidates, &count, .attestation_finality_add);
            }
        },
        .block => |b| {
            const B = &self.blocks.buffer[b];
            if (B.attestations.count > 0) addCandidate(&candidates, &count, .block_no_attestations);
            if (B.support.count > 0) addCandidate(&candidates, &count, .block_no_support);
            if (self.parentOf(&B.parent) != null) addCandidate(&candidates, &count, .block_parent_up);
            if (B.votes.count > 0) addCandidate(&candidates, &count, .block_no_votes);
        },
    }
    if (count == 0) return null;
    const mutation = candidates[@intCast(self.random() % count)];
    var body = original.body;
    switch (mutation) {
        .vote_head_parent => body.vote.head = self.parentOf(&original.body.vote.head).?,
        .vote_head_sibling => body.vote.head = self.siblingOf(&original.body.vote.head).?,
        .vote_slot_down => body.vote.slot -= 1,
        .vote_slot_up => body.vote.slot += 1,
        .attestation_tau => body.attestation.tau = !body.attestation.tau,
        .attestation_height_up => body.attestation.h += 1,
        .attestation_height_down => body.attestation.h -= 1,
        .attestation_target_parent => body.attestation.T = self.parentOf(&original.body.attestation.T).?,
        .attestation_finality_drop => {
            body.attestation.h_f = null;
            body.attestation.T_f = null;
        },
        .attestation_finality_add => {
            body.attestation.h_f = original.body.attestation.h - 1;
            body.attestation.T_f = self.parentOf(&original.body.attestation.T).?;
        },
        .block_no_attestations, .block_no_support, .block_parent_up, .block_no_votes => {
            if (self.blocks.full()) return error.BlockCapacity;
            var copy = self.blocks.buffer[original.body.block];
            switch (mutation) {
                .block_no_attestations => copy.attestations = .{},
                .block_no_support => copy.support = .{},
                .block_parent_up => copy.parent = self.parentOf(&copy.parent).?,
                .block_no_votes => {
                    copy.votes = .{};
                    copy.support = .{};
                },
                else => unreachable,
            }
            var B = copy.view();
            B.root = Hash.blockRoot(&B);
            body = .{ .block = try self.storeBlock(&B) };
        },
    }
    if (self.packets.full()) return error.PacketCapacity;
    const mutated = self.packets.count;
    self.packets.push(.{
        .sender = original.sender,
        .validator = original.validator,
        .created = self.now,
        .authenticated = true,
        .derived = true,
        .body = body,
    });
    self.last_fault = self.now;
    try self.log(.{
        .time = self.now,
        .kind = .fuzz,
        .node = to,
        .peer = original.sender,
        .packet = mutated,
        .value = @intFromEnum(mutation),
    });
    return mutated;
}

fn addCandidate(candidates: *[8]Mutation, count: *usize, mutation: Mutation) void {
    candidates[count.*] = mutation;
    count.* += 1;
}

/// The parent root of a stored non-genesis block, or null for genesis and unknown roots.
fn parentOf(self: *const Simulator, root: *const Root) ?Root {
    if (std.mem.eql(u8, root, &self.config.protocol.B_gen)) return null;
    const index = self.findBlock(root) orelse return null;
    return self.blocks.buffer[index].parent;
}

/// Another stored block with the same parent, or null.
fn siblingOf(self: *const Simulator, root: *const Root) ?Root {
    const parent = self.parentOf(root) orelse return null;
    for (self.blocks.constSlice()) |*B| {
        if (std.mem.eql(u8, &B.parent, &parent) and !std.mem.eql(u8, &B.root, root)) return B.root;
    }
    return null;
}

/// Apply this slot's fuzz partition at its start, or heal the previous slot's partition.
fn applyFuzzNetwork(self: *Simulator, s: u32) Error!void {
    if (self.honestPartitioned()) self.last_honest_cut = self.now;
    if (s > 0 and self.networkFaultSlot(s - 1) != null) {
        self.links = @splat(@splat(@splat(true)));
        self.last_fault = self.now;
        try self.log(.{ .time = self.now, .kind = .fuzz, .node = 0, .value = fuzz_heal, .state = Hash.of(s) });
    }
    if (self.networkFaultSlot(s)) |i| {
        const mask = self.plan.channels[i];
        for (0..2) |c| {
            if (mask & (@as(u8, 1) << @intCast(c)) == 0) continue;
            for (self.replicas, 0..) |_, from| {
                for (self.replicas, 0..) |_, to| {
                    self.links[c][from][to] = self.plan.groups[i][from] == self.plan.groups[i][to];
                }
            }
        }
        self.last_fault = self.now;
        try self.log(.{
            .time = self.now,
            .kind = .fuzz,
            .node = 0,
            .value = fuzz_partition,
            .state = Hash.of(.{ s, self.plan.groups[i], self.plan.group_count[i], mask }),
        });
    }
    if (self.honestPartitioned()) self.last_honest_cut = self.now;
}

pub fn processFaultSlot(self: *const Simulator, s: u32) bool {
    for (self.plan.process_slots) |slot| {
        if (slot != null and slot.? == s) return true;
    }
    return false;
}

pub fn networkFaultSlot(self: *const Simulator, s: u32) ?usize {
    for (self.plan.network_slots, 0..) |slot, i| {
        if (slot != null and slot.? == s) return i;
    }
    return null;
}

fn drawPlan(self: *Simulator, fuzz: *const Fuzz) void {
    const n = self.config.protocol.n;
    var chosen: u32 = 0;
    while (chosen < fuzz.byzantine) {
        const v: u32 = @intCast(self.random() % n);
        if (self.plan.byzantine & bit(v) != 0) continue;
        self.plan.byzantine |= bit(v);
        chosen += 1;
    }
    self.drawSlots(&self.plan.process_slots, fuzz.process_fault_slots, fuzz);
    self.drawSlots(&self.plan.network_slots, fuzz.network_fault_slots, fuzz);
    for (0..fuzz.network_fault_slots) |i| {
        const count: u8 = @intCast(2 + self.random() % 2);
        self.plan.group_count[i] = count;
        for (0..self.replicas.len) |v| self.plan.groups[i][v] = @intCast(self.random() % count);
        self.plan.channels[i] = @intCast(1 + self.random() % 3);
    }
}

/// Partial Fisher-Yates over [first_slot, last_slot]: distinct slots, bounded work.
fn drawSlots(self: *Simulator, slots: *[max_fault_slots]?u32, count: u32, fuzz: *const Fuzz) void {
    var pool: [limits.max_slots]u32 = undefined;
    const span = fuzz.last_slot - fuzz.first_slot + 1;
    for (0..span) |i| pool[i] = fuzz.first_slot + @as(u32, @intCast(i));
    for (0..count) |i| {
        const j = i + @as(usize, @intCast(self.random() % (span - i)));
        const picked = pool[j];
        pool[j] = pool[i];
        pool[i] = picked;
        slots[i] = picked;
    }
}

fn validFuzz(fuzz: Fuzz, n: u32, delta: Time) bool {
    if (fuzz.byzantine >= n) return false;
    if (fuzz.process_fault_slots > max_fault_slots or fuzz.network_fault_slots > max_fault_slots) return false;
    if (fuzz.first_slot > fuzz.last_slot or fuzz.last_slot >= limits.max_slots) return false;
    const span = fuzz.last_slot - fuzz.first_slot + 1;
    if (span < fuzz.process_fault_slots or span < fuzz.network_fault_slots) return false;
    if (fuzz.drop_rate + fuzz.late_rate + fuzz.mutation_rate > 1000) return false;
    return fuzz.late_max > delta;
}

fn slotOf(self: *const Simulator, t: Time) u32 {
    return t / (4 * self.config.protocol.ac.delta);
}

fn nextDelivery(self: *const Simulator) ?u32 {
    var best: ?u32 = null;
    for (self.pending.constSlice(), 0..) |*p, i| {
        const due = p.due orelse continue;
        if (due > self.now) continue;
        if (best) |b| {
            const previous = &self.pending.buffer[b];
            if (due > previous.due.? or
                (due == previous.due.? and p.sequence > previous.sequence)) continue;
        }
        best = @intCast(i);
    }
    return best;
}

fn deliver(self: *Simulator, delivery: *const Pending) Error!void {
    const p = &self.packets.buffer[delivery.packet];
    const replica = &self.replicas[delivery.to];
    assert(replica.node.awake);
    assert(self.delivery_packet == null);
    if (!self.links[@intFromEnum(channel(p))][delivery.from][delivery.to]) {
        return self.log(.{
            .time = self.now,
            .kind = .drop,
            .node = delivery.to,
            .peer = delivery.from,
            .packet = delivery.packet,
        });
    }
    if (delivery.request) return self.deliverRequest(delivery);
    self.delivery_packet = delivery.packet;
    defer self.delivery_packet = null;
    const outcome: u64 = switch (p.body) {
        .vote => |vote| @intFromEnum(try replica.node.onACMessage(&.{
            .vote = vote,
            .authenticated = p.authenticated and p.validator == vote.val_index,
        })),
        .attestation => |a| @intFromBool(try replica.node.onAttestation(&a)),
        .block => @intFromBool(try self.offerBlock(delivery)),
    };
    try self.log(.{
        .time = self.now,
        .kind = .deliver,
        .node = delivery.to,
        .peer = delivery.from,
        .packet = delivery.packet,
        .value = outcome,
    });
    try self.observe(delivery.to);
}

fn offerBlock(self: *Simulator, delivery: *const Pending) Error!bool {
    const replica = &self.replicas[delivery.to];
    const stored = &self.blocks.buffer[self.packets.buffer[delivery.packet].body.block];
    for (stored.votes.slice()) |*v| {
        v.authenticated = replica.signer.hasVoteWitness(&v.vote);
    }
    const B = stored.view();
    return replica.node.onBlock(delivery.from, &B) catch |err| return self.failure orelse err;
}

fn deliverRequest(self: *Simulator, request: *const Pending) Error!void {
    const child = &self.blocks.buffer[self.packets.buffer[request.packet].body.block];
    const responder = &self.replicas[request.to].node;
    const served = responder.onBlockRequest(request.from, &child.parent) catch |err| {
        return self.failure orelse err;
    };
    if (served) return;
    try self.log(.{
        .time = self.now,
        .kind = .block_response,
        .node = request.to,
        .peer = request.from,
        .packet = request.packet,
        .value = 0,
    });
}

/// Transport.forwardBlock: Node forwards a block once, when it first accepts it from a peer.
/// Cut links and in-flight drops are not retried.
pub fn forwardBlock(self: *Simulator, from: u32, B: *const FG.Block) Error!void {
    const packet = self.blockPacket(&B.root) orelse return error.InvariantViolation;
    for (self.replicas, 0..) |_, to| {
        if (to == from) continue;
        if (!self.links[@intFromEnum(Channel.blocks_votes)][from][to]) continue;
        try self.enqueue(packet, from, @intCast(to), .queued);
    }
}

/// Transport.requestBlock. Node asks only for the parent of the block being delivered, so the
/// request is queued under that block's packet.
pub fn requestBlock(self: *Simulator, from: u32, to: u32, root: *const Root) Error!void {
    if (!self.config.block_requests or from == to) return;
    const packet = self.delivery_packet orelse return error.InvariantViolation;
    const p = &self.packets.buffer[packet];
    if (p.body != .block) return error.InvariantViolation;
    if (!std.mem.eql(u8, &self.blocks.buffer[p.body.block].parent, root)) return error.InvariantViolation;
    if (!self.links[@intFromEnum(Channel.blocks_votes)][from][to]) {
        return self.log(.{ .time = self.now, .kind = .drop, .node = to, .peer = from, .packet = packet });
    }
    try self.enqueue(packet, from, to, .block_request);
}

/// Transport.sendBlock: the answer to a block request. A Byzantine responder in a process-fault
/// slot withholds it at the plan's drop rate.
pub fn respondBlock(self: *Simulator, from: u32, to: u32, B: *const FG.Block) Error!void {
    const packet = self.blockPacket(&B.root) orelse return error.InvariantViolation;
    if (self.config.fuzz) |fuzz| {
        if (self.plan.byzantine & bit(self.replicas[from].validator) != 0 and
            self.processFaultSlot(self.slotOf(self.now)) and self.random() % 1000 < fuzz.drop_rate)
        {
            self.last_fault = self.now;
            return self.log(.{
                .time = self.now,
                .kind = .fuzz,
                .node = to,
                .peer = from,
                .packet = packet,
                .value = fuzz_drop,
            });
        }
    }
    try self.log(.{
        .time = self.now,
        .kind = .block_response,
        .node = from,
        .peer = to,
        .packet = packet,
        .value = 1,
    });
    try self.enqueue(packet, from, to, .queued);
}

/// The packet that carries a block: the one being delivered when it is that block, otherwise the
/// first one its proposer signed.
fn blockPacket(self: *const Simulator, root: *const Root) ?u32 {
    if (self.delivery_packet) |i| {
        const p = &self.packets.buffer[i];
        if (p.body == .block and std.mem.eql(u8, &self.blocks.buffer[p.body.block].root, root)) return i;
    }
    for (self.packets.constSlice(), 0..) |*p, i| {
        if (p.created > self.now or !p.authenticated or p.body != .block) continue;
        const B = &self.blocks.buffer[p.body.block];
        if (p.validator == B.proposer and std.mem.eql(u8, &B.root, root)) return @intCast(i);
    }
    return null;
}

/// Queue a block (`.queued`) or a request for its parent (`.block_request`) with a sampled delay.
fn enqueue(self: *Simulator, packet: u32, from: u32, to: u32, kind: Kind) Error!void {
    assert(kind == .queued or kind == .block_request);
    if (self.pending.full()) return error.QueueCapacity;
    const delay = self.sample(self.config.blocks_votes);
    const due: ?Time = if (self.receiving(to)) self.now + delay else null;
    self.pending.push(.{
        .packet = packet,
        .from = from,
        .to = to,
        .sent = self.now,
        .delay = delay,
        .due = due,
        .sequence = self.sequence,
        .request = kind == .block_request,
    });
    self.sequence += 1;
    try self.log(.{
        .time = self.now,
        .kind = if (due == null) .retained else kind,
        .node = to,
        .peer = from,
        .packet = packet,
        .value = due orelse 0,
    });
}

fn observe(self: *Simulator, index: u32) Error!void {
    const replica = &self.replicas[index];
    try self.record(index);
    const reported = self.tips(index);
    const fg = &replica.node.fg;
    const F = fg.find(&reported.finalized.root) orelse return error.InvariantViolation;
    const C = fg.find(&reported.confirmed.root) orelse return error.InvariantViolation;
    const H = fg.find(&reported.head.root) orelse return error.InvariantViolation;
    const Phi = try fg.toAC(&replica.node.frame_buffer);
    if (!fg.isAncestor(F, C) or !fg.isAncestor(C, H) or
        !fg.isAncestor(fg.find(&Phi.fc_root).?, H)) return error.InvariantViolation;
    const first = 6 * self.config.protocol.ac.delta;
    const period = 4 * self.config.protocol.ac.delta * self.config.protocol.ac.R;
    if (self.now >= first and (self.now - first) % period == 0) {
        const pair = try replica.node.ac.toFG(&Phi, self.now);
        if (pair.fg_confirmed) |source| {
            const s = Phi.find(&source) orelse return error.InvariantViolation;
            const head = Phi.find(&pair.head) orelse return error.InvariantViolation;
            if (!Phi.viableTree(&Phi.all())[s] or !Phi.isAncestor(s, head)) {
                return error.InvariantViolation;
            }
        }
    }
    if (!self.config.snapshots) return;
    var h: Hash = .{};
    h.add(Hash.nodeDigest(&replica.node));
    h.add(&replica.storage.record);
    try self.log(.{
        .time = self.now,
        .kind = .snapshot,
        .node = index,
        .state = h.finish(),
    });
}

/// The latest answer node `v` gave its clients. A sleeping node's last answer stands.
pub fn tips(self: *const Simulator, v: u32) node_module.Tips {
    return self.history.buffer[self.replicas[v].reported.?].tips;
}

/// Ask the node what it reports and append the answer when it changed. A node's finalized block
/// only moves to a descendant, and a new one must agree with every honest node's latest.
fn record(self: *Simulator, v: u32) Error!void {
    const replica = &self.replicas[v];
    var scratch: FG.FrameBuffer = undefined;
    const answer = try replica.node.tips(&scratch);
    var finalized_moved = false;
    if (replica.reported) |latest| {
        const previous = &self.history.buffer[latest];
        if (std.meta.eql(previous.tips, answer)) return;
        finalized_moved = !std.mem.eql(u8, &previous.tips.finalized.root, &answer.finalized.root);
        if (finalized_moved and !self.descends(&previous.tips.finalized.root, &answer.finalized.root)) {
            return error.InvariantViolation;
        }
        if (previous.time == self.now) {
            previous.tips = answer;
        } else {
            replica.reported = self.history.count;
            self.history.push(.{ .time = self.now, .node = v, .tips = answer });
        }
    } else {
        replica.reported = self.history.count;
        self.history.push(.{ .time = self.now, .node = v, .tips = answer });
    }
    if (finalized_moved) {
        replica.last_finalization = self.now;
        try self.checkFinalityHistory(v);
    }
}

fn checkFinalityHistory(self: *const Simulator, index: u32) Error!void {
    if (!self.config.checks.finality or self.isFaulty(self.replicas[index].validator)) return;
    if (3 * @as(u32, @popCount(self.faulty)) >= self.config.protocol.n) return;
    const finalized = self.tips(index).finalized.root;
    for (self.replicas, 0..) |*other, i| {
        if (self.isFaulty(other.validator)) continue;
        if (!self.compatible(&finalized, &self.tips(@intCast(i)).finalized.root)) return error.FinalityConflict;
    }
}

fn inject(
    self: *Simulator,
    time: Time,
    sender: u32,
    targets: u64,
    body: Body,
    authenticated: bool,
) Error!u32 {
    try self.checkInput(time);
    try self.checkNode(sender);
    try self.checkTargets(targets);
    if (self.commands.full()) return error.CommandCapacity;
    if (self.packets.full()) return error.PacketCapacity;
    const index = self.packets.count;
    const validator = self.replicas[sender].validator;
    self.packets.push(.{
        .sender = sender,
        .validator = validator,
        .created = time,
        .authenticated = authenticated,
        .derived = false,
        .body = body,
    });
    self.commands.push(.{
        .time = time,
        .body = .{ .publish = .{ .packet = index, .targets = targets } },
    });
    self.faulty |= bit(validator);
    return index;
}

pub fn sendVote(self: *Simulator, sender: u32, vote: *const types.GoldfishVote) Error!void {
    try self.emit(sender, .{ .vote = vote.* });
}
pub fn sendBlock(self: *Simulator, sender: u32, B: *const FG.Block) Error!void {
    const index = try self.storeBlock(B);
    try self.emit(sender, .{ .block = index });
}
pub fn sendAttestation(self: *Simulator, sender: u32, a: *const FG.Attestation) Error!void {
    try self.emit(sender, .{ .attestation = a.* });
}
pub fn recordPersistence(self: *Simulator, index: u32, count: u32) Error!void {
    try self.log(.{ .time = self.now, .kind = .persist, .node = index, .value = count });
}
fn emit(self: *Simulator, sender: u32, body: Body) Error!void {
    if (self.packets.full()) return error.PacketCapacity;
    const index = self.packets.count;
    self.packets.push(.{
        .sender = sender,
        .validator = self.replicas[sender].validator,
        .created = self.now,
        .authenticated = true,
        .derived = false,
        .body = body,
    });
    try self.multicast(index, self.all() & ~bit(sender));
}
/// A block some Node accepted, as its Storage returns it. Acceptance verified every carried vote.
pub fn acceptedBlock(self: *Simulator, index: u32) FG.Block {
    const stored = &self.blocks.buffer[index];
    for (stored.votes.slice()) |*v| v.authenticated = true;
    return stored.view();
}
fn storeBlock(self: *Simulator, B: *const FG.Block) Error!u32 {
    if (B.ac_payload.votes.len > limits.max_vote_set or
        B.ac_payload.support_votes.len > limits.max_vote_set) return error.PayloadCapacity;
    if (B.attestations.len > limits.max_attestations_per_block) return error.AttestationCapacity;
    if (self.blocks.full()) return error.BlockCapacity;
    const index = self.blocks.count;
    self.blocks.buffer[index].init(B);
    self.blocks.count += 1;
    return index;
}
fn packetDigest(self: *const Simulator, p: *const Packet) Root {
    var h: Hash = .{};
    h.add(p);
    if (p.body == .block) {
        const B = self.blocks.buffer[p.body.block].view();
        h.add(.{ B.root, B.proposer, Hash.blockRoot(&B) });
    }
    return h.finish();
}

/// Read-only checks at the duty boundary, using a separate frame buffer, not Node's scratch space.
pub fn checkDuty(self: *const Simulator, index: u32, head: *const Root, proposal: bool) Error!void {
    const replica = &self.replicas[index];
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try replica.node.fg.toAC(&buffer);
    const H = Phi.find(head) orelse return error.InvariantViolation;
    if (!Phi.isAncestor(Phi.find(&Phi.fc_root).?, H)) return error.InvariantViolation;
    if (proposal) {
        const expected = try replica.node.ac.head(&Phi, self.now);
        if (!std.mem.eql(u8, head, &expected) or !Phi.viable_heads[H]) {
            return error.InvariantViolation;
        }
    }
}

fn sample(self: *Simulator, delay: Delay) Time {
    return delay.min + @as(u32, @intCast(self.random() % (@as(u64, delay.max) - delay.min + 1)));
}
/// SplitMix64: a fixed stream independent of std.Random implementation changes.
fn random(self: *Simulator) u64 {
    self.rng +%= 0x9e3779b97f4a7c15;
    var z = self.rng;
    z = (z ^ (z >> 30)) *% 0xbf58476d1ce4e5b9;
    z = (z ^ (z >> 27)) *% 0x94d049bb133111eb;
    return z ^ (z >> 31);
}
fn log(self: *Simulator, entry: Trace) Error!void {
    if (self.trace.full()) return error.TraceCapacity;
    self.trace.push(entry);
}
fn checkNode(self: *const Simulator, v: u32) Error!void {
    if (v >= self.replicas.len) return error.InvalidAction;
}
fn checkTargets(self: *const Simulator, targets: u64) Error!void {
    if (targets & ~self.all() != 0) return error.InvalidAction;
}
fn checkInput(self: *const Simulator, time: Time) Error!void {
    if (self.failed) return error.IncompleteRun;
    if (time < self.next_time or time >= self.horizon()) return error.InvalidAction;
}
fn horizon(self: *const Simulator) Time {
    return @min(max_time, 4 * self.config.protocol.ac.delta * limits.max_slots);
}
fn validDelay(delay: Delay, bound: Time) bool {
    return delay.min <= delay.max and delay.max <= bound and delay.max < max_time;
}
fn bit(v: u32) u64 {
    return @as(u64, 1) << @intCast(v);
}
fn channel(p: *const Packet) Channel {
    return if (p.body == .attestation) .attestations else .blocks_votes;
}

test {
    _ = @import("simulator_test.zig");
}
