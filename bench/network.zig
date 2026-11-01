const std = @import("std");
const network = @import("network");
const config = @import("config");
const preset = @import("preset");
const rr = network.reqresp;
const t = network.peers.types;
const turns = 512;
const sink_size = rr.Protocol.blocks_by_range_v2.info().response_max;
const chain_config = if (preset.active_preset == .minimal) &config.minimal.config else &config.mainnet.config;
const warmup_turns = 64;
const network_gossip_burst = @import("network_gossip_burst.zig");
const network_recovery = @import("network_recovery.zig");
const network_scores = @import("network_scores.zig");
/// The gossip_burst case runs dozens of nodes; their startup info lines would bury its report.
pub const std_options: std.Options = .{ .log_level = .warn };

const Source = enum { transport_backlog, transport_events, transport_timer, gossip, reqresp, identify, negotiation, peers, discovery, host };
const source_count = std.meta.fields(Source).len;

fn dueSources(node: *const network.NetworkCore, now: network.Now, outputs: network.NetworkCore.Outputs, host_deadline: ?std.Io.Clock.Timestamp) [source_count]bool {
    var due: [source_count]bool = @splat(false);
    const engine = &node.transport.engine;
    due[@intFromEnum(Source.transport_backlog)] = engine.backlog();
    due[@intFromEnum(Source.transport_events)] = engine.eventsPending() or engine.releasesPending();
    due[@intFromEnum(Source.transport_timer)] = if (engine.nextDeadlineNs()) |deadline| deadline <= now.monotonic.raw.nanoseconds else false;
    due[@intFromEnum(Source.gossip)] = node.protocols.applications_open and node.protocols.gossipsub.schedule().due(now.monotonic);
    due[@intFromEnum(Source.reqresp)] = node.protocols.reqresp.schedule(outputs.application.len).merge(node.protocols.control_reqresp.schedule(network.NetworkCore.controls_per_turn)).due(now.monotonic);
    due[@intFromEnum(Source.identify)] = node.protocols.identify.schedule(network.NetworkCore.identify_per_turn).due(now.monotonic);
    due[@intFromEnum(Source.negotiation)] = node.protocols.router.schedule(network.Router.outcomes_per_pump).due(now.monotonic);
    due[@intFromEnum(Source.peers)] = node.peer_manager.schedule(node.protocols.gossipsub, now, .{ .peers = outputs.peers.len, .dials = network.NetworkCore.dials_per_turn }).due(now.monotonic);
    due[@intFromEnum(Source.discovery)] = if (node.peer_manager.phase == .running and node.discovery != null) node.discovery.?.schedule().due(now.monotonic) else false;
    due[@intFromEnum(Source.host)] = node.host_runnable or if (host_deadline) |deadline| deadline.compare(.lte, now.monotonic) else false;
    return due;
}

const Samples = struct {
    ns: [turns]u64 = undefined,
    received: u64 = 0,
    sent: u64 = 0,
    backlog: u64 = 0,
    immediate: usize = 0,
    due: [source_count]u64 = @splat(0),
    visits_start: network.quic.Engine.Visits = .{},
    reqresp_visits_start: u64 = 0,
    negotiation_visits_start: u64 = 0,
    gossip_visits_start: u64 = 0,
    control_visits_start: u64 = 0,
    /// Due-now turns under a transport source whose previous turn hit no per-turn cap.
    uncapped_backlog: u64 = 0,
    uncapped_events: u64 = 0,
    previous_backlog: bool = false,
    previous_events: bool = false,

    fn begin(node: *const network.NetworkCore) Samples {
        return .{
            .visits_start = node.transport.engine.visits,
            .reqresp_visits_start = node.protocols.reqresp.visits + node.protocols.control_reqresp.visits,
            .negotiation_visits_start = node.protocols.router.negotiator.visits,
            .gossip_visits_start = node.protocols.gossipsub.sessions.visits,
            .control_visits_start = node.peer_manager.control.visits,
        };
    }

    fn record(self: *Samples, index: usize, elapsed: u64, due: [source_count]bool, result: network.NetworkCore.Result, immediate: bool) !void {
        if (result.failure) |err| return err;
        self.ns[index] = elapsed;
        self.received += result.transport.datagrams_received;
        self.sent += result.transport.datagrams_sent;
        self.backlog += @intFromBool(result.transport.backlog);
        self.immediate += @intFromBool(immediate);
        for (due, &self.due) |ready, *count| count.* += @intFromBool(ready);
        const backlog_due = due[@intFromEnum(Source.transport_backlog)];
        const events_due = due[@intFromEnum(Source.transport_events)];
        self.uncapped_backlog += @intFromBool(backlog_due and !self.previous_backlog);
        self.uncapped_events += @intFromBool(events_due and !self.previous_events);
        self.previous_backlog = result.transport.backlog;
        self.previous_events = result.transport.events_pending;
    }

    fn print(self: *Samples, node: *const network.NetworkCore, name: []const u8) void {
        std.mem.sort(u64, &self.ns, {}, std.sort.asc(u64));
        const visits = node.transport.engine.visits;
        std.debug.print("case={s} turns={} wait_max_ms=0 p50_ns={} p95_ns={} p99_ns={} max_ns={} rx={} tx={} backlog_turns={} immediate_deadlines={} visits_timer={} visits_advance={} visits_flush={} uncapped_backlog_due={} uncapped_events_due={}\n", .{ name, turns, self.ns[turns / 2], self.ns[turns * 95 / 100], self.ns[turns * 99 / 100], self.ns[turns - 1], self.received, self.sent, self.backlog, self.immediate, visits.timer - self.visits_start.timer, visits.advance - self.visits_start.advance, visits.flush - self.visits_start.flush, self.uncapped_backlog, self.uncapped_events });
        std.debug.print("case={s} visits_reqresp={} visits_negotiation={} visits_gossip={} visits_control={}\n", .{ name, node.protocols.reqresp.visits + node.protocols.control_reqresp.visits - self.reqresp_visits_start, node.protocols.router.negotiator.visits - self.negotiation_visits_start, node.protocols.gossipsub.sessions.visits - self.gossip_visits_start, node.peer_manager.control.visits - self.control_visits_start });
        std.debug.print("case={s} due_now", .{name});
        inline for (std.meta.fields(Source)) |field| {
            std.debug.print(" {s}={}", .{ field.name, self.due[field.value] });
        }
        std.debug.print("\n", .{});
    }

    /// Connection, slot, session and row visits by the engine and every owner since begin.
    fn visited(self: *const Samples, node: *const network.NetworkCore) u64 {
        const visits = node.transport.engine.visits;
        return (visits.timer - self.visits_start.timer) + (visits.advance - self.visits_start.advance) + (visits.flush - self.visits_start.flush) +
            (node.protocols.reqresp.visits + node.protocols.control_reqresp.visits - self.reqresp_visits_start) + (node.protocols.router.negotiator.visits - self.negotiation_visits_start) +
            (node.protocols.gossipsub.sessions.visits - self.gossip_visits_start) + (node.peer_manager.control.visits - self.control_visits_start);
    }
};

/// Admits gossip as the gossip processor does and keeps each validation handle.
const GossipSink = struct {
    handles: [256]network.gossipsub.Gossipsub.ValidationHandle = undefined,
    count: usize = 0,
    excess: bool = false,
    sink: network.gossipsub.Gossipsub.MessageSink = undefined,

    /// The sink must not move while the node holds it.
    fn attach(self: *GossipSink, node: *network.NetworkCore) void {
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        node.protocols.gossipsub.message_sink = &self.sink;
    }

    fn hasCapacity(context: *anyopaque, _: network.gossipsub.topic.Kind, _: usize) bool {
        const self: *GossipSink = @ptrCast(@alignCast(context));
        if (self.count < self.handles.len) return true;
        self.excess = true;
        return false;
    }

    fn admit(context: *anyopaque, candidate: *network.gossipsub.Gossipsub.MessageAdmission) bool {
        const self: *GossipSink = @ptrCast(@alignCast(context));
        if (self.count == self.handles.len or !candidate.sourceRoom() or !candidate.fits(&candidate.room())) return false;
        candidate.commit();
        self.handles[self.count] = candidate.event.handle;
        self.count += 1;
        return true;
    }
};

fn timestamp(io: std.Io) u64 {
    return @intCast(std.Io.Clock.awake.now(io).nanoseconds);
}

fn turn(node: *network.NetworkCore, io: std.Io, outputs: network.NetworkCore.Outputs) !network.NetworkCore.Result {
    const now = try network.Now.read(io);
    const result = network.driver.step(node, io, now, outputs, .deadlineOnly(network.time.optionalMilliseconds(now.millis())));
    if (result.failure) |err| return err;
    return result;
}

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len > 2 and std.mem.eql(u8, args[1], "gossip_burst")) return network_gossip_burst.run(init, args[2..]);
    if (args.len > 2) return error.InvalidBenchmark;
    const selected = if (args.len == 2) args[1] else return error.InvalidBenchmark;
    if (std.mem.eql(u8, selected, "gossip_burst")) return network_gossip_burst.run(init, &.{});
    if (std.mem.eql(u8, selected, "idle_wait")) return idleWait(init);
    if (std.mem.eql(u8, selected, "recovery_resolve")) return network_recovery.run(init);
    if (std.mem.eql(u8, selected, "score_collection")) return network_scores.run(init);
    if (std.mem.eql(u8, selected, "idle_transport")) return idleTransport(init);
    if (std.mem.eql(u8, selected, "idle_connections")) return idleConnections(init);
    if (!std.mem.eql(u8, selected, "owner")) return error.InvalidBenchmark;
    std.debug.print("preset={s} optimize={s} warmup_turns={} measured_turns={} payload=synthetic_transport_bytes host_consensus_validation=false\n", .{ @tagName(preset.active_preset), @tagName(@import("builtin").mode), warmup_turns, turns });
    const network_config = try network.chain.Config.init(chain_config, false);
    const io = init.io;
    const allocator = init.gpa;
    const sinks = try allocator.alloc(u8, 4 * sink_size);
    defer allocator.free(sinks);
    const key_a = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{11}));
    const key_b = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{12}));
    const a = try allocator.create(network.NetworkCore);
    defer allocator.destroy(a);
    var backing_a = std.testing.FailingAllocator.init(allocator, .{});
    try initialize(a, backing_a.allocator(), io, &key_a, &network_config);
    defer a.deinit(io);
    std.debug.print("history_entry_bytes={} history_owner_bytes={} startup_requested_zig_bytes={} inline_bytes={} gossip_bytes={} allocation_calls={} native_allocator_os_excluded=true\n", .{ @sizeOf(network.gossipsub.mcache.HistoryEntry), @sizeOf(network.gossipsub.mcache.History), a.allocations.bytes, @sizeOf(network.NetworkCore), a.protocols.gossipsub.memoryPlan().total_bytes, backing_a.allocations });
    std.debug.print("gossip_metadata_bytes={}\n", .{a.protocols.gossipsub.memoryPlan().metadata_bytes});
    for (0..warmup_turns) |_| _ = try turn(a, io, .{});
    const idle_allocations = backing_a.allocations;
    var samples: Samples = .begin(a);
    for (0..turns) |i| {
        const now = try network.Now.read(io);
        const immediate = a.schedule(now, .{}).due(now.monotonic);
        const due_before = dueSources(a, now, .{}, now.monotonic);
        const start = timestamp(io);
        const result = try turn(a, io, .{});
        try samples.record(i, timestamp(io) - start, due_before, result, immediate);
    }
    samples.print(a, "idle");
    std.debug.print("case=idle turn_allocation_calls={}\n", .{backing_a.allocations - idle_allocations});
    printReconciliation(a, "idle");
    const b = try allocator.create(network.NetworkCore);
    defer allocator.destroy(b);
    var backing_b = std.testing.FailingAllocator.init(allocator, .{});
    try initialize(b, backing_b.allocator(), io, &key_b, &network_config);
    defer b.deinit(io);
    var topic_buffer: [network.gossipsub.topic.topic_max_len]u8 = undefined;
    const topic = network.gossipsub.topic.build(network_config.forks[0].digest, "beacon_block", &topic_buffer);
    try connectPair(a, b, io, topic);
    for (0..warmup_turns) |_| {
        _ = try turn(a, io, .{});
        _ = try turn(b, io, .{});
    }
    const allocations_a = backing_a.allocations;
    const allocations_b = backing_b.allocations;
    try pressure(a, b, sinks, io, topic, network_config.forks[0]);
    printReconciliation(a, "connected_cumulative");
    std.debug.print("turn_allocation_calls_a={} turn_allocation_calls_b={} process_rss=external_time_maximum_resident_set_kbytes\n", .{ backing_a.allocations - allocations_a, backing_b.allocations - allocations_b });
}

fn slotClock(io: std.Io) !network.SlotClock {
    const now: u64 = @intCast((try network.Now.read(io)).unixSeconds());
    return network.SlotClock.init(&chain_config.chain, now - 100 * chain_config.chain.SECONDS_PER_SLOT);
}

fn initialize(node: *network.NetworkCore, a: std.mem.Allocator, io: std.Io, key: *const network.KeyPair, network_config: *const network.chain.Config) !void {
    const update = try network_config.update(.{ .metadata = .{ .custody_group_count = chain_config.chain.CUSTODY_REQUIREMENT } }, null, 0);
    const resolved = try network.configuration.resolve(.{
        .seed = 7,
        .forks = network_config.forks[0..network_config.boundary_count],
        .admission_policy = network_config.requestPolicy(),
        .byte_limit = 1024 * 1024 * 1024,
        .router = .{ .capabilities = update.capabilities },
        .gossip = .{ .topic_policy = network_config.topics[0..network_config.boundary_count], .message_id_policy = .{ .phase0_digest = network_config.phase0_digest } },
    });
    try node.init(a, io, &resolved, .{
        .host = key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = update.local,
        .schedule = update.schedule,
        .clock = try slotClock(io),
    });
}

fn connectPair(a: *network.NetworkCore, b: *network.NetworkCore, io: std.Io, topic: []const u8) !void {
    try a.addDirectPeer(&b.peerId(), &.{b.transport.localAddress()}, try network.Now.read(io));
    var rows: [4]t.Snapshot = undefined;
    var peer: ?t.PeerRef = null;
    for (0..10000) |_| {
        _ = try turn(a, io, .{});
        _ = try turn(b, io, .{});
        for (rows[0..a.peer_manager.snapshots(&rows)]) |row| {
            if (row.relevant) peer = row.peer;
        }
        if (peer != null and b.peerCounts().relevant == 1) break;
    }
    if (peer == null) return error.ConnectionDeadline;
    try b.addDirectPeer(&a.peerId(), &.{a.transport.localAddress()}, try network.Now.read(io));
    var peer_events: [4]t.Event = undefined;
    var subscription: network.gossipsub.local_intent.Boundary = .{ .digest = network.gossipsub.topic.parseCanonical(topic).?.digest };
    subscription.mask(.beacon_block)[0] = 1;
    subscription.lengths[@intFromEnum(network.gossipsub.topic.Kind.beacon_block)] = 1;
    for ([_]*network.NetworkCore{ a, b }) |node| {
        const intent: network.NetworkCore.LocalIntent = .{
            .update = .{ .local = node.localState(), .schedule = node.fork_schedule, .endpoints = node.advertisementEndpoints(), .capabilities = node.protocols.router.capabilities() },
            .demand = node.peer_manager.demand,
            .subscriptions = &.{subscription},
        };
        _ = try node.applyIntent(&intent, try network.Now.read(io));
    }
    for (0..4000) |_| {
        const now_a = try network.Now.read(io);
        const result_a = network.driver.step(a, io, now_a, .{ .peers = &peer_events }, .deadlineOnly(network.time.optionalMilliseconds(now_a.millis() +| 1)));
        if (result_a.failure) |err| return err;
        const now_b = try network.Now.read(io);
        const result_b = network.driver.step(b, io, now_b, .{ .peers = &peer_events }, .deadlineOnly(network.time.optionalMilliseconds(now_b.millis() +| 1)));
        if (result_b.failure) |err| return err;
        if (a.protocols.gossipsub.resourceSnapshot().remote_subscriptions > 0 and a.protocols.gossipsub.peers.rows[0].direct) break;
        try io.sleep(.fromMilliseconds(1), .awake);
    }
    if (a.protocols.gossipsub.resourceSnapshot().remote_subscriptions == 0) {
        std.debug.print("setup a={any} b={any} gossip_a={any} gossip_b={any}\n", .{ a.peerCounts(), b.peerCounts(), a.protocols.gossipsub.resourceSnapshot(), b.protocols.gossipsub.resourceSnapshot() });
        return error.SubscriptionDeadline;
    }
}

fn pressure(a: *network.NetworkCore, b: *network.NetworkCore, sinks: []u8, io: std.Io, topic: []const u8, context: network.types.ForkEntry) !void {
    var payload: [64 * 1024]u8 = undefined;
    var random = std.Random.DefaultPrng.init(123);
    random.random().bytes(&payload);
    var gossip_queued: usize = 0;
    var gossip_pressured: usize = 0;
    var peak_descriptors: usize = 0;
    var peak_validations: usize = 0;
    var gossip: GossipSink = .{};
    gossip.attach(b);
    defer b.protocols.gossipsub.message_sink = null;
    var request: [32]u8 = @splat(0);
    request[8] = 1;
    request[16] = 1;
    var requests: [4]rr.ReqResp.RequestHandle = undefined;
    for (&requests, 0..) |*handle, i| {
        const protocol: rr.Protocol = if (i < 2) .blocks_by_range_v2 else .blocks_by_root_v2;
        handle.* = try a.sendReqRespRequest(&b.peerId(), protocol, request[0..if (i < 2) 24 else 32], sinks[i * sink_size ..][0..sink_size], .{ .expected_chunks = 1 }, try network.Now.read(io));
    }
    var status = b.localState().status;
    status.head_slot = 42;
    try b.updateStatus(&status);
    _ = a.reStatusPeer(&b.peerId(), try network.Now.read(io));
    var samples: Samples = .begin(a);
    for (0..turns) |i| {
        if (i < 256) {
            std.mem.writeInt(u64, payload[0..8], i, .little);
            const published = try a.publishGossipWithOptions(topic, &payload, .{}, try network.Now.read(io));
            gossip_queued += published.queued;
            gossip_pressured += published.pressured;
        }
        _ = try turn(b, io, .{});
        if (gossip.excess) return error.ExcessGossip;
        const sender = a.protocols.gossipsub.resourceSnapshot();
        const receiver = b.protocols.gossipsub.resourceSnapshot();
        peak_descriptors = @max(peak_descriptors, sender.queued_descriptors);
        peak_validations = @max(peak_validations, receiver.pending_validations);
        const now = try network.Now.read(io);
        const immediate = a.schedule(now, .{}).due(now.monotonic);
        const due_before = dueSources(a, now, .{}, now.monotonic);
        const start = timestamp(io);
        const result = try turn(a, io, .{});
        try samples.record(i, timestamp(io) - start, due_before, result, immediate);
    }
    samples.print(a, "connected_slow_application_control");
    std.debug.print("gossip_attempted_bytes={} queued={} pressured={} peak_descriptors={} peak_pending_validations={}\n", .{ 256 * payload.len, gossip_queued, gossip_pressured, peak_descriptors, peak_validations });
    if (gossip_queued == 0 or gossip.count == 0 or peak_validations == 0) return error.GossipDidNotDeliver;
    var rows: [4]t.Snapshot = undefined;
    var control_progress = false;
    for (rows[0..a.peer_manager.snapshots(&rows)]) |row| {
        if (row.status) |remote| if (remote.head_slot == 42) {
            control_progress = true;
        };
    }
    if (!control_progress) return error.ControlDidNotProgress;
    std.debug.print("control_status_head_slot=42 progress=true request_count=4 caller_sink_bytes={} gossip_resources={any}\n", .{ sinks.len, b.protocols.gossipsub.resourceSnapshot() });
    for (gossip.handles[0..gossip.count]) |handle| {
        const verdict = b.reportValidation(handle, .ignore, try network.Now.read(io));
        if (verdict != .applied) return error.GossipVerdictFailed;
    }
    const delivered_gossip = gossip.count;
    gossip.count = 0;
    try drain(a, b, io, requests.len, &payload, context, &gossip, delivered_gossip);
}

fn drain(a: *network.NetworkCore, b: *network.NetworkCore, io: std.Io, expected: usize, payload: []const u8, context: network.types.ForkEntry, gossip: *GossipSink, delivered_gossip: usize) !void {
    var events: [8]rr.ReqResp.Event = undefined;
    var received: usize = 0;
    var chunks: usize = 0;
    var terminals: usize = 0;
    var served: usize = 0;
    var messages = delivered_gossip;
    for (0..turns) |_| {
        const result = try turn(b, io, .{ .application = &events });
        for (gossip.handles[0..gossip.count]) |handle| {
            messages += 1;
            _ = b.reportValidation(handle, .ignore, try network.Now.read(io));
        }
        gossip.count = 0;
        for (events[0..result.counts.application]) |event| switch (event) {
            .request => |value| {
                received += 1;
                try b.respond(value.request, payload, context, try network.Now.read(io));
            },
            .chunk_sent => |value| if (!b.finishResponse(value.request, try network.Now.read(io))) {
                return error.FinishFailed;
            },
            .served => served += 1,
            else => return error.UnexpectedServerEvent,
        };
        const sent = try turn(a, io, .{ .application = &events });
        for (events[0..sent.counts.application]) |event| switch (event) {
            .chunk => |value| {
                if (value.fork != context.fork or !std.mem.eql(u8, value.bytes, payload)) return error.InvalidResponse;
                if (!a.consumeResponse(value.request, try network.Now.read(io))) return error.ConsumeFailed;
                chunks += 1;
            },
            .done => |value| {
                if (value.chunks != 1) return error.InvalidChunkCount;
                terminals += 1;
            },
            else => return error.UnexpectedApplicationEvent,
        };
        if (received == expected and terminals == expected and served == expected) break;
    }
    if (received != expected or chunks != expected or terminals != expected or served != expected) return error.RequestsDidNotDrain;
    std.debug.print("successful_requests={} response_chunks={} response_bytes={} gossip_delivered={} gossip_verdict=ignore\n", .{ terminals, chunks, chunks * payload.len, messages });
}

fn printReconciliation(node: *network.NetworkCore, name: []const u8) void {
    const c = node.peer_manager.counters;
    const score = &node.protocols.gossipsub.peers.scores;
    std.debug.print("case={s} candidate_selections={} score_calculations={} score_topic_visits={}\n", .{ name, c.candidate_selections, score.calculations, score.topic_visits });
}

/// CI fails the idle_wait case above this many turns in its 1 s window.
const idle_wait_turns_max = 8;

/// A host with no queued work: it drains its nonblocking wake pipe when applied and counts the calls.
const IdleHost = struct {
    pipe: [2]std.c.fd_t,
    applies: u32 = 0,

    fn apply(context: *anyopaque, _: *network.NetworkCore, _: network.Now) network.NetworkCore.HostProgress {
        const self: *IdleHost = @ptrCast(@alignCast(context));
        self.applies += 1;
        var buffer: [64]u8 = undefined;
        _ = std.c.read(self.pipe[0], &buffer, buffer.len);
        return .{};
    }
};

/// A fully idle node with a host attached through its wake pipe and a host
/// deadline at the end of a 1 s window. Every wait comes from a deadline.
fn idleWait(init: std.process.Init) !void {
    const io = init.io;
    const key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{11}));
    const node = try init.gpa.create(network.NetworkCore);
    defer init.gpa.destroy(node);
    const network_config = try network.chain.Config.init(chain_config, false);
    var backing = std.testing.FailingAllocator.init(init.gpa, .{});
    try initialize(node, backing.allocator(), io, &key, &network_config);
    defer node.deinit(io);
    var host: IdleHost = .{ .pipe = undefined };
    if (std.c.pipe(&host.pipe) != 0) return error.PipeFailed;
    defer for (host.pipe) |fd| {
        _ = std.c.close(fd);
    };
    const flags = std.c.fcntl(host.pipe[0], std.c.F.GETFL);
    const nonblock: c_int = @bitCast(std.c.O{ .NONBLOCK = true });
    if (flags < 0 or std.c.fcntl(host.pipe[0], std.c.F.SETFL, flags | nonblock) < 0) return error.PipeFailed;
    try node.setHostWake(host.pipe[0]);
    const calls = backing.allocations;
    const start = timestamp(io);
    const window_end_ms = (try network.Now.read(io)).millis() + 1_000;
    var count: u32 = 0;
    var immediate: u32 = 0;
    var elapsed_turns: u64 = 0;
    var due: [source_count]u64 = @splat(0);
    for (0..10_000) |_| {
        const before = timestamp(io);
        if (before - start >= 1_000_000_000) break;
        const now = try network.Now.read(io);
        immediate += @intFromBool(node.schedule(now, .{}).due(now.monotonic));
        for (dueSources(node, now, .{}, network.time.optionalMilliseconds(window_end_ms)), &due) |ready, *total| total.* += @intFromBool(ready);
        const result = network.driver.step(node, io, now, .{}, .{ .handler = .{ .context = &host, .apply = IdleHost.apply }, .deadline = network.time.optionalMilliseconds(window_end_ms) });
        if (result.failure) |err| return err;
        elapsed_turns += timestamp(io) - before;
        count += 1;
    }
    const elapsed = timestamp(io) - start;
    if (elapsed < 1_000_000_000) return error.TurnLimit;
    std.debug.print("case=idle_wait window_ms=1000 elapsed_ns={} turns={} host_applies={} immediate_deadlines={} turn_elapsed_ns={} turn_allocation_calls={} turns_max={}\n", .{ elapsed, count, host.applies, immediate, elapsed_turns, backing.allocations - calls, idle_wait_turns_max });
    std.debug.print("case=idle_wait due_now", .{});
    inline for (std.meta.fields(Source)) |field| std.debug.print(" {s}={}", .{ field.name, due[field.value] });
    std.debug.print("\n", .{});
    if (count > idle_wait_turns_max) return error.IdleWaitTurns;
}

const idle_transport_spokes = 200;
/// CI fails the case above this median turn.
const idle_transport_p50_budget_ns = 15_000;

/// A hub Transport holding established loopback connections from spoke Transports, measured over
/// turns with no traffic. Each turn runs the transport phases of an owner turn: receive, process
/// and flush. An idle connection must cost no visit.
fn idleTransport(init: std.process.Init) !void {
    const io = init.io;
    const allocator = init.gpa;
    const hub_key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{13}));
    const hub = try allocator.create(network.Transport);
    defer allocator.destroy(hub);
    hub.* = .{};
    try hub.init(allocator, io, .{ .host = &hub_key, .bind = .{ .ip4 = .loopback(0) }, .limits = .{
        .connections_max = 256,
        .handshaking_max = 256,
        .handshaking_per_source_max = 256,
    } });
    defer hub.deinit(io);
    const spokes = try allocator.alloc(network.Transport, idle_transport_spokes);
    defer allocator.free(spokes);
    var initialized: usize = 0;
    defer for (spokes[0..initialized]) |*spoke| spoke.deinit(io);
    for (spokes, 0..) |*spoke, index| {
        var secret: [32]u8 = @splat(0);
        std.mem.writeInt(u16, secret[30..32], @intCast(1_000 + index), .big);
        const key = try network.KeyPair.fromSecretKey(&secret);
        spoke.* = .{};
        try spoke.init(allocator, io, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .limits = .{
            .connections_max = 1,
            .handshaking_max = 1,
            .dialing_max = 1,
            .receive_budget_bytes = 16 * 1024 * 1024,
        } });
        initialized += 1;
    }
    var events: [1024]network.Event = undefined;
    var established: usize = 0;
    var dialed: usize = 0;
    for (0..20_000) |_| {
        // A few handshakes at a time keep the hub's socket buffer from dropping Initials.
        while (dialed < spokes.len and dialed - established < 16) : (dialed += 1) {
            _ = try spokes[dialed].dialPeer(io, hub.localAddress(), hub.peerId(), try network.Now.read(io));
        }
        for (spokes[0..dialed]) |*spoke| {
            const stepped = network.transport_driver.step(spoke, io, &events, .{ .wait_max = .fromMilliseconds(0) });
            if (stepped.failure) |err| return err;
        }
        const stepped = network.transport_driver.step(hub, io, &events, .{ .wait_max = .fromMilliseconds(1) });
        if (stepped.failure) |err| return err;
        for (events[0..stepped.progress.events]) |event| switch (event) {
            .connected => established += 1,
            .closed => return error.SpokeClosed,
            else => {},
        };
        if (established == idle_transport_spokes) break;
    }
    if (established != idle_transport_spokes) return error.ConnectionDeadline;
    // Settle until no side sends for several rounds.
    var quiet: usize = 0;
    for (0..2_000) |_| {
        var sent: u64 = 0;
        for (spokes) |*spoke| {
            const stepped = network.transport_driver.step(spoke, io, &events, .{ .wait_max = .fromMilliseconds(0) });
            if (stepped.failure) |err| return err;
            sent += stepped.progress.datagrams_sent;
        }
        const stepped = network.transport_driver.step(hub, io, &events, .{ .wait_max = .fromMilliseconds(2) });
        if (stepped.failure) |err| return err;
        sent += stepped.progress.datagrams_sent;
        quiet = if (sent == 0 and !stepped.progress.backlog) quiet + 1 else 0;
        if (quiet == 8) break;
    }
    if (quiet < 8) return error.SettleDeadline;
    const visits = hub.engine.visits;
    var ns: [turns]u64 = undefined;
    var received: u64 = 0;
    var sent: u64 = 0;
    for (&ns) |*elapsed| {
        const start = timestamp(io);
        var result: network.Transport.Progress = .{ .now = try network.Now.read(io) };
        try hub.receive(io, &result, @splat(true));
        _ = hub.process(result.now, &events);
        try hub.flush(io, result.now, &result);
        elapsed.* = timestamp(io) - start;
        received += result.datagrams_received;
        sent += result.datagrams_sent;
    }
    std.mem.sort(u64, &ns, {}, std.sort.asc(u64));
    const after = hub.engine.visits;
    const visited = (after.timer - visits.timer) + (after.advance - visits.advance) + (after.flush - visits.flush);
    std.debug.print("case=idle_transport connections={} turns={} p50_ns={} p95_ns={} p99_ns={} max_ns={} rx={} tx={} visits_timer={} visits_advance={} visits_flush={} timeouts_fired={} p50_budget_ns={}\n", .{ idle_transport_spokes, turns, ns[turns / 2], ns[turns * 95 / 100], ns[turns * 99 / 100], ns[turns - 1], received, sent, after.timer - visits.timer, after.advance - visits.advance, after.flush - visits.flush, after.timeouts - visits.timeouts, idle_transport_p50_budget_ns });
    if (visited != 0) return error.IdleConnectionVisited;
    if (ns[turns / 2] > idle_transport_p50_budget_ns) return error.IdleTransportBudget;
}

const idle_connections_spokes = 200;
/// CI fails the case above this median turn.
const idle_connections_p50_budget_ns = 40_000;

/// A hub NetworkCore (256 connections, 210 max peers, 200 target peers)
/// holding 200 admitted inbound connections from spoke Transports that speak only QUIC, so the
/// hub's negotiations and its inbound Status grace wait on future deadlines. The measured turns
/// start within 1 s of the last admission. An idle connection must cost no visit in the engine or
/// in any owner.
fn idleConnections(init: std.process.Init) !void {
    const io = init.io;
    const allocator = init.gpa;
    const network_config = try network.chain.Config.init(chain_config, false);
    const update = try network_config.update(.{ .metadata = .{ .custody_group_count = chain_config.chain.CUSTODY_REQUIREMENT } }, null, 0);
    const resolved = try network.configuration.resolve(.{
        .seed = 7,
        .forks = network_config.forks[0..network_config.boundary_count],
        .admission_policy = network_config.requestPolicy(),
        .limits = .{ .connections_max = 256, .handshaking_max = 256, .handshaking_per_source_max = 256, .dialing_max = 32, .receive_budget_bytes = 512 * 1024 * 1024 },
        .peers = .{ .capacity = 512, .outbound_reserve = 32, .target_peers = 200, .max_peers = 210, .min_outbound = 16, .inbound_per_source_max = idle_connections_spokes },
        .byte_limit = 1024 * 1024 * 1024,
        .router = .{ .capabilities = update.capabilities },
        .gossip = .{ .topic_policy = network_config.topics[0..network_config.boundary_count], .message_id_policy = .{ .phase0_digest = network_config.phase0_digest } },
    });
    const hub_key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{14}));
    const hub = try allocator.create(network.NetworkCore);
    defer allocator.destroy(hub);
    try hub.init(allocator, io, &resolved, .{ .host = &hub_key, .bind = .{ .ip4 = .loopback(0) }, .local = update.local, .schedule = update.schedule, .clock = try slotClock(io) });
    defer hub.deinit(io);
    const spokes = try allocator.alloc(network.Transport, idle_connections_spokes);
    defer allocator.free(spokes);
    var initialized: usize = 0;
    defer for (spokes[0..initialized]) |*spoke| spoke.deinit(io);
    for (spokes, 0..) |*spoke, index| {
        var secret: [32]u8 = @splat(0);
        std.mem.writeInt(u16, secret[30..32], @intCast(2_000 + index), .big);
        const key = try network.KeyPair.fromSecretKey(&secret);
        spoke.* = .{};
        try spoke.init(allocator, io, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .limits = .{
            .connections_max = 1,
            .handshaking_max = 1,
            .dialing_max = 1,
            .receive_budget_bytes = 16 * 1024 * 1024,
        } });
        initialized += 1;
    }
    var events: [1024]network.Event = undefined;
    var peer_events: [64]t.Event = undefined;
    const outputs: network.NetworkCore.Outputs = .{ .peers = &peer_events };
    var dialed: usize = 0;
    var admitted_at: u64 = 0;
    for (0..20_000) |_| {
        // A few handshakes at a time keep the hub's socket buffer from dropping Initials.
        const connected = hub.peerCounts().connected;
        while (dialed < spokes.len and dialed - connected < 16) : (dialed += 1) {
            _ = try spokes[dialed].dialPeer(io, hub.transport.localAddress(), hub.peerId(), try network.Now.read(io));
        }
        for (spokes[0..dialed]) |*spoke| {
            const stepped = network.transport_driver.step(spoke, io, &events, .{ .wait_max = .fromMilliseconds(0) });
            if (stepped.failure) |err| return err;
        }
        _ = try turn(hub, io, outputs);
        if (hub.peerCounts().connected == idle_connections_spokes) {
            admitted_at = timestamp(io);
            break;
        }
    }
    if (hub.peerCounts().connected != idle_connections_spokes) return error.ConnectionDeadline;
    // Settle until no side sends for several rounds.
    var quiet: usize = 0;
    for (0..2_000) |_| {
        var sent: u64 = 0;
        for (spokes) |*spoke| {
            const stepped = network.transport_driver.step(spoke, io, &events, .{ .wait_max = .fromMilliseconds(0) });
            if (stepped.failure) |err| return err;
            sent += stepped.progress.datagrams_sent;
        }
        const result = try turn(hub, io, outputs);
        sent += result.transport.datagrams_sent;
        quiet = if (sent == 0 and !result.transport.backlog) quiet + 1 else 0;
        if (quiet == 8) break;
    }
    if (quiet < 8) return error.SettleDeadline;
    if (hub.peerCounts().connected != idle_connections_spokes) return error.SpokeClosed;
    const settled_ms = (timestamp(io) - admitted_at) / std.time.ns_per_ms;
    var samples: Samples = .begin(hub);
    for (0..turns) |i| {
        const now = try network.Now.read(io);
        const immediate = hub.schedule(now, outputs).due(now.monotonic);
        const due_before = dueSources(hub, now, outputs, now.monotonic);
        const start = timestamp(io);
        const result = try turn(hub, io, outputs);
        try samples.record(i, timestamp(io) - start, due_before, result, immediate);
    }
    const window_ms = (timestamp(io) - admitted_at) / std.time.ns_per_ms;
    samples.print(hub, "idle_connections");
    std.debug.print("case=idle_connections connections={} settled_ms={} window_ms={} p50_budget_ns={}\n", .{ hub.peerCounts().connected, settled_ms, window_ms, idle_connections_p50_budget_ns });
    if (window_ms >= 1_000) return error.WindowDeadline;
    if (samples.visited(hub) != 0) return error.IdleConnectionVisited;
    if (samples.ns[turns / 2] > idle_connections_p50_budget_ns) return error.IdleConnectionsBudget;
}
