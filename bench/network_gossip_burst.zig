//! The gossip_burst case: a hub NetworkCore on production gossip options takes a slot's attestation
//! burst from spoke NetworkCores over loopback QUIC, applies verdicts as the host does, and forwards
//! each accepted message to its mesh. Each spoke runs on its own thread; the hub owns the main one.
//!
//! Topology: subnet `s` has `mesh` subscribing spokes, starting at spoke `s * peers / topics`. Every
//! subscriber joins the hub's mesh, so a forward selects `mesh - 1` recipients. Slow spokes receive
//! but never publish, read `slow_rate` messages per second and advertise a 512 KiB stream window,
//! so their back-pressure reaches the hub within seconds.
//!
//! Schedule: `background` messages per second over the whole run, `burst` messages spread evenly
//! over `window_ms` after `lead_ms`, and `columns` column sidecars over the lead-in. Each
//! attestation also reaches the hub as `duplicates` copies from other subscribers, `duplicate_ms`
//! apart, as mesh peers forward it back.
//!
//! Host: every admitted message is accepted `delay_ms` after admission, reaches the owner at the
//! next `exchange_ms` tick, and the owner applies at most `batch` verdicts per host apply.
const std = @import("std");
const network = @import("network");
const config = @import("config");
const preset = @import("preset");

const gossip = network.gossipsub;
const Kind = gossip.topic.Kind;
const Origin = gossip.delivery.Origin;
const Now = network.Now;
const t = network.peers.types;
const chain_config = if (preset.active_preset == .minimal) &config.minimal.config else &config.mainnet.config;
const mib = 1024 * 1024;

const Options = struct {
    /// Spoke peers connected to the hub.
    peers: u16 = 24,
    /// Attestation subnets, and column subnets when columns are sent.
    topics: u16 = 64,
    /// Subscribers per subnet, all in the hub's mesh; a forward selects `mesh - 1` of them.
    mesh: u16 = 10,
    /// Slow receivers among the spokes, and the messages per second each reads.
    slow: u16 = 0,
    slow_rate: u32 = 100,
    burst: u32 = 35_000,
    window_ms: u32 = 2_000,
    /// Messages per second over the whole run, inside the burst too.
    background: u32 = 250,
    /// Copies of each attestation that other subscribers send the hub, and their spacing; feat4
    /// sas receives 6.25 duplicates per message.
    duplicates: u16 = 6,
    duplicate_ms: u32 = 25,
    lead_ms: u32 = 1_000,
    tail_ms: u32 = 3_000,
    /// Admission to verdict, the host exchange cadence that hands verdicts to the owner (zero hands
    /// each over when due), and verdicts applied per owner apply.
    delay_ms: u32 = 20,
    exchange_ms: u32 = 10,
    batch: u32 = 64,
    /// Column sidecars spread over the lead-in, and each one's SSZ size.
    columns: u32 = 0,
    column_bytes: u32 = 16 * 1024,
    /// Gossip call budgets; zero keeps the production default.
    calls_per_pump: u32 = 0,
    calls_per_peer: u32 = 0,
    sample_ms: u32 = 250,
    receive_per_turn: u16 = 32,
    /// Active validators from which the hub scores attestation subnets as Lodestar does, leaving
    /// every other kind unscored as Lodestar leaves columns; zero keeps the default score parameters.
    validators: u32 = 0,

    fn durationMs(self: *const Options) u64 {
        return @as(u64, self.lead_ms) + self.window_ms + self.tail_ms;
    }

    /// Attestations, then column sidecars when the run sends them.
    fn kinds(self: *const Options) []const bool {
        return message_kinds[0 .. @as(usize, 1) + @intFromBool(self.columns > 0)];
    }

    fn attestations(self: *const Options) u64 {
        return self.background * self.durationMs() / 1000 + self.burst;
    }

    fn messages(self: *const Options) u64 {
        return self.attestations() * (1 + self.duplicates) + self.columns;
    }

    fn validate(self: *const Options) error{InvalidOptions}!void {
        if (self.peers < self.mesh or self.peers > peers_max or self.mesh < 2 or self.mesh > gossip.constants.mesh_d_high or
            self.topics == 0 or self.topics > Kind.beacon_attestation.countMax() or self.slow > 4 or @as(u32, self.slow) + self.duplicates >= self.mesh or
            (self.slow > 0 and self.slow_rate == 0) or (self.burst > 0 and self.window_ms == 0) or self.durationMs() > 30_000 or
            self.delay_ms > 10_000 or self.exchange_ms > 1_000 or self.batch == 0 or self.batch > 1024 or self.columns > 4096 or self.sample_ms < 10 or
            self.receive_per_turn == 0 or self.receive_per_turn > network.Transport.receive_per_turn_max or self.messages() > messages_max) return error.InvalidOptions;
    }
};

const peers_max = 64;
const messages_max = 400_000;
const presets = [_]struct { []const u8, Options }{
    .{ "sas_burst", .{} },
    .{ "slow_peer", .{ .burst = 0, .background = 2_500, .duplicates = 0, .slow = 1, .slow_rate = 100 } },
};

const Parsed = struct { name: []const u8, options: Options };

/// An optional preset name first, then `field=value` overrides.
fn parse(args: []const []const u8) !Parsed {
    var result: Parsed = .{ .name = presets[0][0], .options = presets[0][1] };
    for (args, 0..) |arg, index| {
        const split = std.mem.findScalar(u8, arg, '=') orelse {
            if (index != 0) return error.InvalidOptions;
            for (presets) |entry| {
                if (std.mem.eql(u8, entry[0], arg)) result = .{ .name = entry[0], .options = entry[1] };
            }
            if (!std.mem.eql(u8, result.name, arg)) return error.InvalidPreset;
            continue;
        };
        const key = arg[0..split];
        inline for (std.meta.fields(Options)) |field| {
            if (std.mem.eql(u8, key, field.name)) {
                @field(result.options, field.name) = try std.fmt.parseInt(field.type, arg[split + 1 ..], 10);
                break;
            }
        } else return error.InvalidOptions;
    }
    try result.options.validate();
    return result;
}

fn firstSubscriber(options: *const Options, subnet: u16) u16 {
    return @intCast(@as(u32, subnet) * options.peers / options.topics);
}

fn subscribes(options: *const Options, spoke: u16, subnet: u16) bool {
    return (spoke + options.peers - firstSubscriber(options, subnet)) % options.peers < options.mesh;
}

fn isSlow(options: *const Options, spoke: u16) bool {
    return spoke >= options.peers - options.slow;
}

/// The subnet's publishing subscribers, which skip slow spokes, taken in rotation.
fn publisher(options: *const Options, subnet: u16, rotation: usize) u16 {
    var publishers: [gossip.constants.mesh_d_high]u16 = undefined;
    var count: usize = 0;
    for (0..options.mesh) |k| {
        const spoke: u16 = @intCast((firstSubscriber(options, subnet) + k) % options.peers);
        if (isSlow(options, spoke)) continue;
        publishers[count] = spoke;
        count += 1;
    }
    return publishers[rotation % count];
}

/// A message, or with `copy` above zero that copy of it from another subscriber.
const Message = struct { at_us: u64, id: u32 = 0, subnet: u16 = 0, column: bool, copy: u16 = 0 };
const message_kinds = [_]bool{ false, true };

/// Every message in send order, grouped by source spoke through `offsets`.
const Schedule = struct {
    messages: []Message,
    offsets: [peers_max + 1]usize,

    fn init(allocator: std.mem.Allocator, options: *const Options) !Schedule {
        const background = options.background * options.durationMs() / 1000;
        const originals: usize = @intCast(options.attestations() + options.columns);
        const total: usize = @intCast(options.messages());
        const ordered = try allocator.alloc(Message, total);
        defer allocator.free(ordered);
        const sources = try allocator.alloc(u16, total);
        defer allocator.free(sources);
        var count: usize = 0;
        for (0..background) |k| {
            ordered[count] = .{ .at_us = k * std.time.us_per_s / options.background, .column = false };
            count += 1;
        }
        for (0..options.burst) |k| {
            ordered[count] = .{ .at_us = (@as(u64, options.lead_ms) * options.burst + k * options.window_ms) * 1000 / options.burst, .column = false };
            count += 1;
        }
        for (0..options.columns) |k| {
            ordered[count] = .{ .at_us = k * @as(u64, options.lead_ms) * 1000 / options.columns, .column = true };
            count += 1;
        }
        std.debug.assert(count == originals);
        std.mem.sort(Message, ordered[0..originals], {}, earlier);
        // Subnets rotate per kind; each subnet's sources rotate over its publishers, and a copy
        // comes from the publishers after the source.
        var rotation: [2]usize = @splat(0);
        for (ordered[0..originals], sources[0..originals], 0..) |*message, *source, index| {
            const kind: usize = @intFromBool(message.column);
            message.id = @intCast(index);
            message.subnet = @intCast(rotation[kind] % options.topics);
            source.* = publisher(options, message.subnet, rotation[kind] / options.topics);
            if (!message.column) for (1..options.duplicates + 1) |copy| {
                ordered[count] = message.*;
                ordered[count].copy = @intCast(copy);
                ordered[count].at_us += copy * @as(u64, options.duplicate_ms) * 1000;
                sources[count] = publisher(options, message.subnet, rotation[kind] / options.topics + copy);
                count += 1;
            };
            rotation[kind] += 1;
        }
        std.debug.assert(count == total);
        var counts: [peers_max]usize = @splat(0);
        for (sources) |source| counts[source] += 1;
        var offsets: [peers_max + 1]usize = @splat(0);
        for (0..options.peers) |spoke| offsets[spoke + 1] = offsets[spoke] + counts[spoke];
        const messages = try allocator.alloc(Message, total);
        var cursors = offsets;
        for (ordered, sources) |message, source| {
            messages[cursors[source]] = message;
            cursors[source] += 1;
        }
        for (0..options.peers) |spoke| std.mem.sort(Message, messages[offsets[spoke]..offsets[spoke + 1]], {}, earlier);
        return .{ .messages = messages, .offsets = offsets };
    }

    fn earlier(_: void, a: Message, b: Message) bool {
        return a.at_us < b.at_us or (a.at_us == b.at_us and a.id < b.id);
    }

    fn deinit(self: *Schedule, allocator: std.mem.Allocator) void {
        allocator.free(self.messages);
    }

    fn of(self: *const Schedule, spoke: u16) []const Message {
        return self.messages[self.offsets[spoke]..self.offsets[spoke + 1]];
    }
};

/// The newest chain boundary, so topics carry the current fork's message sizes.
const Chain = struct {
    network_config: network.chain.Config,
    update: network.local_state.LocalUpdate,
    boundary: usize,
    slot: u64,
    clock: network.SlotClock,
    attestation_bytes: usize,

    fn init(options: *const Options, io: std.Io) !Chain {
        const network_config = try network.chain.Config.init(chain_config, false);
        const boundary: usize = network_config.boundary_count - 1;
        const slot = network_config.boundaries[boundary].epoch * preset.preset.SLOTS_PER_EPOCH;
        const local: t.LocalState = .{ .metadata = .{ .custody_group_count = chain_config.chain.CUSTODY_REQUIREMENT }, .status = .{ .earliest_available_slot = 0 } };
        const rules = &network_config.topics[boundary].rules;
        const attestation = rules[@intFromEnum(Kind.beacon_attestation)];
        if (attestation.count < options.topics) return error.InvalidOptions;
        if (options.columns > 0) {
            const column = rules[@intFromEnum(Kind.data_column_sidecar)];
            if (column.count < options.topics or options.column_bytes < column.ssz_min or options.column_bytes > column.ssz_max) return error.InvalidColumnSize;
        }
        const unix_s: u64 = @intCast((try Now.read(io)).unixSeconds());
        const clock = try network.SlotClock.init(&chain_config.chain, unix_s - slot * chain_config.chain.SECONDS_PER_SLOT);
        return .{ .network_config = network_config, .update = try network_config.update(local, null, slot), .boundary = boundary, .slot = slot, .clock = clock, .attestation_bytes = attestation.ssz_min };
    }

    fn digest(self: *const Chain) [4]u8 {
        return self.network_config.boundaries[self.boundary].digest;
    }

    fn topic(self: *const Chain, column: bool, subnet: u16, out: *[gossip.topic.topic_max_len]u8) []const u8 {
        return gossip.topic.buildCanonical(.{ .digest = self.digest(), .name = .{ .kind = if (column) .data_column_sidecar else .beacon_attestation, .subnet = subnet } }, out);
    }

    /// The hub's subnets, or with `spoke` the ones that spoke subscribes to.
    fn subscribe(self: *const Chain, node: *network.NetworkCore, options: *const Options, spoke: ?u16, now: Now) !void {
        var boundary: gossip.local_intent.Boundary = .{ .digest = self.digest() };
        for (options.kinds()) |column| {
            const kind: Kind = if (column) .data_column_sidecar else .beacon_attestation;
            for (0..options.topics) |index| {
                const subnet: u16 = @intCast(index);
                if (spoke) |value| if (!subscribes(options, value, subnet)) continue;
                boundary.mask(kind)[subnet / 8] |= @as(u8, 1) << @intCast(subnet % 8);
                boundary.lengths[@intFromEnum(kind)] = @max(boundary.lengths[@intFromEnum(kind)], @as(u8, @intCast(subnet / 8 + 1)));
            }
        }
        const intent: network.NetworkCore.LocalIntent = .{
            .update = .{ .local = node.localState(), .schedule = node.fork_schedule, .endpoints = node.advertisementEndpoints(), .capabilities = node.protocols.router.capabilities() },
            .demand = node.peer_manager.demand,
            .subscriptions = &.{boundary},
        };
        _ = try node.applyIntent(&intent, now);
    }

    /// Whether every subscribed topic's mesh holds `members`, or with null at least one peer.
    fn meshed(self: *const Chain, node: *const network.NetworkCore, options: *const Options, spoke: ?u16, members: ?usize) bool {
        const overlay = node.protocols.gossipsub.overlay;
        var buffer: [gossip.topic.topic_max_len]u8 = undefined;
        for (0..options.topics) |index| {
            const subnet: u16 = @intCast(index);
            if (spoke) |value| if (!subscribes(options, value, subnet)) continue;
            for (options.kinds()) |column| {
                const row = overlay.findTopic(self.topic(column, subnet, &buffer)) orelse return false;
                const count = overlay.mesh(row).count();
                if (if (members) |expected| count != expected else count == 0) return false;
            }
        }
        return true;
    }
};

/// Processor limits as Lodestar's `createNativeConfig` derives them, with the attestation items
/// sized from one slot's messages as Lodestar sizes them from active validators.
fn processorLimits(chain: *const Chain, options: *const Options) network.gossip_processor.limits.Limits {
    const items = [_]u32{ 8, 2048, 0, 32, 32, 128, 128, 1024, 8, 8, 128, 256, 256 };
    const weights_mib = [_]usize{ 24, 8, 8, 1, 4, 1, 2, 2, 2, 2, 1, 8, 16 };
    const slot_messages = @as(u64, options.burst) + @as(u64, options.background) * chain_config.chain.SLOT_DURATION_MS / 1000;
    var limits: network.gossip_processor.limits.Limits = undefined;
    for (&limits, items, weights_mib, 0..) |*limit, count, weight, kind| {
        var largest: usize = 0;
        for (chain.network_config.topics[0..chain.network_config.boundary_count]) |boundary| largest = @max(largest, boundary.rules[kind].ssz_max);
        limit.* = .{
            .items = if (kind == @intFromEnum(Kind.beacon_attestation)) @intCast(@max(128, (slot_messages * 11 + 9) / 10)) else count,
            .bytes = @intCast(std.mem.alignForward(usize, @max(gossip.constants.maxCompressedLen(largest), weight * mib), 4096)),
        };
    }
    return limits;
}

/// The feat4 sas owner: 210 peers and Lodestar's gossip policy and processor limits.
fn hubResolved(chain: *const Chain, options: *const Options) !network.configuration.Resolved {
    const limits = processorLimits(chain, options);
    var gossip_options: gossip.Gossipsub.Options = .{
        .topic_policy = chain.network_config.topics[0..chain.network_config.boundary_count],
        .message_id_policy = .{ .phase0_digest = chain.network_config.phase0_digest },
        .iwant_followup_ms = 12_000,
        .large_frame_timeout_ms = 30_000,
        .opportunistic_graft_interval_ms = 42_000,
        .calls_per_pump = if (options.calls_per_pump == 0) (gossip.Gossipsub.Options{}).calls_per_pump else options.calls_per_pump,
        .calls_per_peer = if (options.calls_per_peer == 0) (gossip.Gossipsub.Options{}).calls_per_peer else options.calls_per_peer,
        .topic_params = if (options.validators == 0) null else lodestarTopics(options.validators),
    };
    try gossip_options.setPayloadLimits(&limits);
    return network.configuration.resolve(.{
        .seed = 7,
        .work_limits = .{ .receive_per_turn_max = options.receive_per_turn },
        .forks = chain.network_config.forks[0..chain.network_config.boundary_count],
        .admission_policy = chain.network_config.requestPolicy(),
        .limits = .{ .connections_max = 242, .handshaking_max = 32, .handshaking_per_source_max = 32, .dialing_max = 32, .receive_budget_bytes = 512 * mib },
        .peers = .{ .capacity = 420, .outbound_reserve = 32, .target_peers = 200, .max_peers = 210, .min_outbound = 50 },
        .byte_limit = 2048 * mib,
        .router = .{ .capabilities = chain.update.capabilities },
        .gossip = gossip_options,
    });
}

/// Lodestar's `getTopicScoreParams` for attestation subnets at `validators` active validators, with
/// every other kind unscored.
fn lodestarTopics(validators: u32) [gossip.topic_policy.kind_count]gossip.score.TopicPolicy {
    var result = (network.application_policy.gossip(&chain_config.chain, validators) catch unreachable).topic_params.?;
    for (&result, 0..) |*policy, i| if (i != @intFromEnum(Kind.beacon_attestation)) {
        policy.params.weight = 0;
    };
    return result;
}

const slow_tick_ms = 10;

/// A bounded spoke with a 100 ms heartbeat, so it grafts the hub quickly. A slow spoke reads
/// its tick's share of `slow_rate` per pump and advertises the smallest stream window.
fn spokeResolved(chain: *const Chain, options: *const Options, index: u16, slow: bool) !network.configuration.Resolved {
    const frame_bytes = chain.attestation_bytes + 64;
    const input: usize = @max(1, @as(usize, options.slow_rate) * frame_bytes * slow_tick_ms / 1000);
    const slow_limits: network.Limits = .{ .connections_max = 16, .handshaking_max = 8, .dialing_max = 4, .receive_budget_bytes = 16 * mib };
    return network.configuration.resolve(.{
        .seed = 1_000 + index,
        .forks = chain.network_config.forks[0..chain.network_config.boundary_count],
        .admission_policy = chain.network_config.requestPolicy(),
        .limits = if (slow) slow_limits else .{ .connections_max = 16, .handshaking_max = 8, .dialing_max = 4, .receive_budget_bytes = 64 * mib },
        .peers = .{ .capacity = 64, .outbound_reserve = 4, .target_peers = 8, .max_peers = 12, .min_outbound = 2 },
        .socket_buffers = .{ .quic = .{ .receive = 4 * mib, .send = 4 * mib } },
        .router = .{ .capabilities = chain.update.capabilities },
        .gossip = .{
            .topic_policy = chain.network_config.topics[0..chain.network_config.boundary_count],
            .message_id_policy = .{ .phase0_digest = chain.network_config.phase0_digest },
            .heartbeat_interval_ms = 100,
            .receive_arena_bytes = 16 * mib,
            .seen_capacity = 4096,
            .validation_capacity = 64,
            .mcache_arena_bytes = 16 * mib,
            .mcache_capacity = 4096,
            .input_per_peer = if (slow) input else (gossip.Gossipsub.Options{}).input_per_peer,
            .input_per_pump = if (slow) input else (gossip.Gossipsub.Options{}).input_per_pump,
        },
    });
}

/// Admits every feasible message and applies `accept` verdicts `delay_ms` after admission, handed
/// over at the next `exchange_ms` tick, at most `batch` per owner apply, as the host's gossip flags do.
const Host = struct {
    const Pending = struct { handle: gossip.Gossipsub.ValidationHandle, due_ms: u64 };
    const ring_len = 65_536;

    ring: []Pending,
    head: usize = 0,
    len: usize = 0,
    delay_ms: u64,
    exchange_ms: u64,
    batch: usize,
    sink: gossip.Gossipsub.MessageSink = undefined,
    admitted: u64 = 0,
    refused: u64 = 0,
    applied: u64 = 0,
    applies: u64 = 0,
    failed_verdicts: u64 = 0,

    /// The host must not move while the hub holds its sink.
    fn attach(self: *Host, node: *network.NetworkCore) void {
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        node.protocols.gossipsub.message_sink = &self.sink;
    }

    fn hasCapacity(context: *anyopaque, _: Kind, _: usize) bool {
        const self: *Host = @ptrCast(@alignCast(context));
        return self.len < self.ring.len;
    }

    fn admit(context: *anyopaque, candidate: *gossip.Gossipsub.MessageAdmission) bool {
        const self: *Host = @ptrCast(@alignCast(context));
        if (self.len == self.ring.len or !candidate.sourceRoom() or !candidate.fits(&candidate.room())) {
            self.refused += 1;
            return false;
        }
        candidate.commit();
        const due_ms = candidate.event.admitted_ms + self.delay_ms;
        self.ring[(self.head + self.len) % self.ring.len] = .{ .handle = candidate.event.handle, .due_ms = if (self.exchange_ms == 0) due_ms else (due_ms + self.exchange_ms - 1) / self.exchange_ms * self.exchange_ms };
        self.len += 1;
        self.admitted += 1;
        return true;
    }

    fn apply(context: *anyopaque, core: *network.NetworkCore, tick: Now) network.NetworkCore.HostProgress {
        const self: *Host = @ptrCast(@alignCast(context));
        var count: usize = 0;
        while (count < self.batch and self.len > 0 and self.ring[self.head].due_ms <= tick.millis()) : (count += 1) {
            if (core.reportValidation(self.ring[self.head].handle, .accept, tick) == .applied) self.applied += 1 else self.failed_verdicts += 1;
            self.head = (self.head + 1) % self.ring.len;
            self.len -= 1;
        }
        self.applies += @intFromBool(count > 0);
        return .{ .runnable = self.len > 0 and self.ring[self.head].due_ms <= tick.millis() };
    }

    fn deadline(self: *const Host) ?u64 {
        return if (self.len == 0) null else self.ring[self.head].due_ms;
    }
};

/// Run-wide state shared by the hub thread and the spoke threads.
const Shared = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    chain: *const Chain,
    options: *const Options,
    schedule: *const Schedule,
    hub_id: t.PeerId,
    hub_address: network.Address,
    /// Spokes whose mesh holds the hub on every subscribed topic.
    ready: std.atomic.Value(u32) = .init(0),
    /// Monotonic milliseconds at which the schedule starts; zero until setup completes.
    start_ms: std.atomic.Value(u64) = .init(0),
    stop: std.atomic.Value(bool) = .init(false),
    failed: std.atomic.Value(bool) = .init(false),
};

const Spoke = struct {
    shared: *Shared,
    index: u16,
    core: network.NetworkCore = undefined,
    published: u64 = 0,
    copies: u64 = 0,
    pressured: u64 = 0,
    publish_failures: u64 = 0,
    received: u64 = 0,
    failure: ?anyerror = null,

    fn main(self: *Spoke) void {
        self.run() catch |err| {
            self.failure = err;
            self.shared.failed.store(true, .release);
        };
    }

    fn run(self: *Spoke) !void {
        const shared = self.shared;
        const io = shared.io;
        const options = shared.options;
        const slow = isSlow(options, self.index);
        const resolved = try spokeResolved(shared.chain, options, self.index, slow);
        var secret: [32]u8 = @splat(0);
        std.mem.writeInt(u16, secret[30..32], 3_000 + self.index, .big);
        const key = try network.KeyPair.fromSecretKey(&secret);
        try self.core.init(shared.allocator, io, &resolved, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .local = shared.chain.update.local, .schedule = shared.chain.update.schedule, .clock = shared.chain.clock });
        defer self.core.deinit(io);
        const payload = try shared.allocator.alloc(u8, @max(shared.chain.attestation_bytes, options.column_bytes));
        defer shared.allocator.free(payload);
        var now = try network.Now.read(io);
        try self.core.connectUntil(&shared.hub_id, &.{shared.hub_address}, now, network.time.milliseconds(now.millis() + 10_000));
        try shared.chain.subscribe(&self.core, options, self.index, now);
        const schedule = shared.schedule.of(self.index);
        var peer_events: [16]t.Event = undefined;
        var application: [4]network.reqresp.ReqResp.Event = undefined;
        const outputs: network.NetworkCore.Outputs = .{ .peers = &peer_events, .application = &application };
        var cursor: usize = 0;
        var signalled = false;
        var next_tick: u64 = 0;
        for (0..1 << 40) |_| {
            if (shared.stop.load(.acquire)) break;
            now = try network.Now.read(io);
            if (!signalled and shared.chain.meshed(&self.core, options, self.index, null)) {
                signalled = true;
                _ = shared.ready.fetchAdd(1, .acq_rel);
            }
            const start = shared.start_ms.load(.acquire);
            var wake = if (start == 0) now.millis() + 10 else self.publishDue(schedule, &cursor, start, payload, now);
            if (slow) {
                if (now.millis() < next_tick) try io.sleep(.fromMilliseconds(@intCast(next_tick - now.millis())), .awake);
                next_tick = @max(next_tick, now.millis()) + slow_tick_ms;
                now = try network.Now.read(io);
                wake = now.millis();
            }
            const result = network.driver.step(&self.core, io, now, outputs, .deadlineOnly(network.time.optionalMilliseconds(wake)));
            if (result.readiness.failure) |err| return err;
        }
        // A spoke runs without a host, so it refuses every message it receives for storage.
        for (self.core.protocols.gossipsub.messages.storage_refusals) |count| self.received += count;
    }

    /// Publishes up to 64 due messages and returns when the spoke should step again.
    fn publishDue(self: *Spoke, schedule: []const Message, cursor: *usize, start_ms: u64, payload: []u8, now: Now) u64 {
        for (0..64) |_| {
            if (cursor.* == schedule.len) return now.millis() + 10;
            const due = start_ms + schedule[cursor.*].at_us / 1000;
            if (due > now.millis()) return @min(due, now.millis() + 10);
            self.publish(&schedule[cursor.*], payload, now);
            cursor.* += 1;
        }
        return now.millis();
    }

    fn publish(self: *Spoke, message: *const Message, payload: []u8, now: Now) void {
        const chain = self.shared.chain;
        const bytes = payload[0..if (message.column) self.shared.options.column_bytes else chain.attestation_bytes];
        var random = std.Random.DefaultPrng.init(message.id);
        random.random().bytes(bytes);
        std.mem.writeInt(u32, bytes[0..4], message.id, .little);
        var buffer: [gossip.topic.topic_max_len]u8 = undefined;
        const outcome = self.core.publishGossipWithOptions(chain.topic(message.column, message.subnet, &buffer), bytes, .{}, now) catch {
            self.publish_failures += 1;
            return;
        };
        if (outcome.queued == 0) {
            self.pressured += 1;
        } else if (message.copy > 0) self.copies += 1 else self.published += 1;
    }
};

const Gossipsub = gossip.Gossipsub;
const Delivery = @FieldType(Gossipsub, "delivery_metrics");
const Outcome = Delivery.Outcome;
const Session = @typeInfo(@FieldType(gossip.sessions.Sessions, "rows")).pointer.child;
const DropReason = @FieldType(@FieldType(@FieldType(Session, "io"), "tx"), "last_drop");
const origin_count = @typeInfo(Origin).@"enum".fields.len;
const outcome_count = @typeInfo(Outcome).@"enum".fields.len;

/// Cumulative hub counters at one instant; windows and samples are differences of two.
const Totals = struct {
    at_ms: u64 = 0,
    /// Data messages the hub read, duplicates included.
    received: u64 = 0,
    admitted: u64 = 0,
    refused: u64 = 0,
    applied: u64 = 0,
    applies: u64 = 0,
    forwarded: u64 = 0,
    score_evaluations: u64 = 0,
    recipients: [origin_count][outcome_count]u64 = @splat(@splat(0)),
    queue_drops: [@typeInfo(DropReason).@"enum".fields.len]u64 = @splat(0),
    write_calls: u64 = 0,
    would_block: u64 = 0,
    steps: u64 = 0,
    step_ns: u64 = 0,
    udp_sent: u64 = 0,
    udp_received: u64 = 0,

    fn read(hub: *const network.NetworkCore, host: *const Host, steps: u64, now_ms: u64) Totals {
        const g = hub.protocols.gossipsub;
        var result: Totals = .{
            .at_ms = now_ms,
            .admitted = host.admitted,
            .refused = host.refused,
            .applied = host.applied,
            .applies = host.applies,
            .recipients = g.delivery_metrics.recipients,
            .queue_drops = g.retired_queue_drops,
            .write_calls = g.sessions.writes,
            .would_block = g.sessions.blocked_writes,
            .score_evaluations = g.peers.scores.calculations,
            .steps = steps,
            .step_ns = @intCast(hub.step_duration.sum),
            .udp_sent = hub.transport.counters.sent_datagrams,
            .udp_received = hub.transport.counters.received_datagrams,
        };
        for (g.topic_metrics.counts) |counts| {
            result.received += counts.received;
            result.forwarded += counts.forwarded;
        }
        for (g.sessions.rows) |*row| for (&result.queue_drops, row.io.tx.drops) |*total, value| {
            total.* += value;
        };
        return result;
    }

    fn minus(self: *const Totals, earlier: *const Totals) Totals {
        var result = self.*;
        inline for (std.meta.fields(Totals)) |field| {
            const value = &@field(result, field.name);
            const before = &@field(earlier, field.name);
            switch (@typeInfo(field.type)) {
                .int => value.* -= before.*,
                .array => |array| switch (@typeInfo(array.child)) {
                    .int => for (value, before) |*item, previous| {
                        item.* -= previous;
                    },
                    .array => for (value, before) |*row, *previous_row| for (row, previous_row) |*item, previous| {
                        item.* -= previous;
                    },
                    else => comptime unreachable,
                },
                else => comptime unreachable,
            }
        }
        return result;
    }
};

fn ratio(numerator: u64, denominator: u64) f64 {
    if (denominator == 0) return 0;
    return @as(f64, @floatFromInt(numerator)) / @as(f64, @floatFromInt(denominator));
}

/// Instant hub state with the cumulative counters at one sample.
const Sample = struct {
    totals: Totals,
    queued: usize,
    peer_max: usize,
    full_peers: usize,
    pending_verdicts: usize,

    fn read(hub: *const network.NetworkCore, host: *const Host, steps: u64, now_ms: u64) Sample {
        const g = hub.protocols.gossipsub;
        var result: Sample = .{
            .totals = .read(hub, host, steps, now_ms),
            .queued = 0,
            .peer_max = 0,
            .full_peers = 0,
            .pending_verdicts = host.len,
        };
        for (g.sessions.rows) |*row| {
            result.queued += row.io.tx.data.count;
            result.peer_max = @max(result.peer_max, row.io.tx.data.count);
            result.full_peers += @intFromBool(row.io.tx.data.full());
        }
        return result;
    }

    fn print(self: *const Sample, previous: *const Totals, start_ms: u64) void {
        const delta = self.totals.minus(previous);
        const forward = delta.recipients[@intFromEnum(Origin.forward)];
        std.debug.print("case=gossip_burst sample t_ms={d} admitted={d} applied={d} pending_verdicts={d} forward_queued={d} forward_dropped={d} forward_completed={d} queued_frames={d} peer_max_frames={d} full_peers={d} steps={d} owner_busy={d:.2}\n", .{
            self.totals.at_ms - start_ms,          delta.admitted,                           delta.applied,                            self.pending_verdicts,
            forward[@intFromEnum(Outcome.queued)], forward[@intFromEnum(Outcome.pressured)], forward[@intFromEnum(Outcome.completed)], self.queued,
            self.peer_max,                         self.full_peers,                          delta.steps,                              ratio(delta.step_ns, delta.at_ms * std.time.ns_per_ms),
        });
    }
};

const windows = [_][]const u8{ "lead", "burst", "tail" };
const step_samples_max = 1_000_000;

pub fn run(init: std.process.Init, args: []const []const u8) !void {
    const parsed = try parse(args);
    const options = &parsed.options;
    const io = init.io;
    const allocator = init.gpa;
    const chain = try allocator.create(Chain);
    defer allocator.destroy(chain);
    chain.* = try Chain.init(options, io);
    var schedule = try Schedule.init(allocator, options);
    defer schedule.deinit(allocator);
    const hub_resolved = try hubResolved(chain, options);
    const policy = &hub_resolved.core.protocols.gossipsub;
    std.debug.print("case=gossip_burst preset={s} chain_preset={s} optimize={s} peers={d} topics={d} mesh={d} recipients={d} slow={d} slow_rate={d} attestation_ssz_bytes={d} burst={d} window_ms={d} background={d} duplicates={d} duplicate_ms={d} lead_ms={d} tail_ms={d} delay_ms={d} exchange_ms={d} batch={d} columns={d} column_bytes={d} validators={d} messages={d}\n", .{ parsed.name, @tagName(preset.active_preset), @tagName(@import("builtin").mode), options.peers, options.topics, options.mesh, options.mesh - 1, options.slow, options.slow_rate, chain.attestation_bytes, options.burst, options.window_ms, options.background, options.duplicates, options.duplicate_ms, options.lead_ms, options.tail_ms, options.delay_ms, options.exchange_ms, options.batch, options.columns, options.column_bytes, options.validators, schedule.messages.len });
    std.debug.print("case=gossip_burst hub receive_per_turn={d} calls_per_pump={d} calls_per_peer={d} peers_per_pump={d} per_peer_descriptors={d} local_descriptors={d} attestation_items={d} validation_capacity={d}\n", .{ options.receive_per_turn, policy.calls_per_pump, policy.calls_per_peer, policy.peers_per_pump, gossip.delivery.per_peer_limit, gossip.constants.tx_local_descriptors, policy.payload_limits.?[@intFromEnum(Kind.beacon_attestation)].items, policy.validation_capacity });

    const hub = try allocator.create(network.NetworkCore);
    defer allocator.destroy(hub);
    const hub_key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{21}));
    try hub.init(allocator, io, &hub_resolved, .{
        .host = &hub_key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = chain.update.local,
        .schedule = chain.update.schedule,
        .clock = chain.clock,
    });
    defer hub.deinit(io);
    var host: Host = .{ .ring = try allocator.alloc(Host.Pending, Host.ring_len), .delay_ms = options.delay_ms, .exchange_ms = options.exchange_ms, .batch = options.batch };
    defer allocator.free(host.ring);
    host.attach(hub);
    defer hub.protocols.gossipsub.message_sink = null;
    try chain.subscribe(hub, options, null, try network.Now.read(io));

    var shared: Shared = .{ .io = io, .allocator = allocator, .chain = chain, .options = options, .schedule = &schedule, .hub_id = hub.peerId(), .hub_address = hub.transport.localAddress() };
    const spokes = try allocator.alloc(Spoke, options.peers);
    defer allocator.free(spokes);
    var threads: [peers_max]std.Thread = undefined;
    var spawned: usize = 0;
    defer {
        shared.stop.store(true, .release);
        for (threads[0..spawned]) |thread| thread.join();
    }
    for (spokes, 0..) |*spoke, index| {
        spoke.* = .{ .shared = &shared, .index = @intCast(index) };
        threads[index] = try std.Thread.spawn(.{}, Spoke.main, .{spoke});
        spawned += 1;
    }

    var peer_events: [64]t.Event = undefined;
    var application: [16]network.reqresp.ReqResp.Event = undefined;
    const outputs: network.NetworkCore.Outputs = .{ .peers = &peer_events, .application = &application };
    const setup_start = try network.Now.read(io);
    for (0..1 << 20) |_| {
        const now = try network.Now.read(io);
        const result = network.driver.step(hub, io, now, outputs, .{ .handler = .{ .context = &host, .apply = Host.apply }, .deadline = network.time.milliseconds(now.millis() + 5) });
        if (result.readiness.failure) |err| return err;
        if (shared.failed.load(.acquire)) return spokeFailure(spokes);
        if (shared.ready.load(.acquire) == options.peers and hubReady(hub, chain, options)) break;
        if (now.millis() > setup_start.millis() + 20_000) {
            std.debug.print("case=gossip_burst setup_failed ready={d} peers={any} gossip={any}\n", .{ shared.ready.load(.acquire), hub.peerCounts(), hub.protocols.gossipsub.resourceSnapshot() });
            return error.SetupDeadline;
        }
    }
    const setup_end = try network.Now.read(io);
    const start_ms = setup_end.millis() + 20;
    std.debug.print("case=gossip_burst setup_ms={d} connected={d}\n", .{ setup_end.millis() - setup_start.millis(), hub.peerCounts().connected });

    const steps = try allocator.alloc(u32, windows.len * step_samples_max);
    defer allocator.free(steps);
    var recorded: [windows.len]usize = @splat(0);
    var unrecorded: usize = 0;
    const samples = try allocator.alloc(Sample, options.durationMs() / options.sample_ms + 2);
    defer allocator.free(samples);
    var sample_count: usize = 0;
    var edges: [windows.len + 1]Totals = undefined;
    const bounds = [_]u64{ start_ms, start_ms + options.lead_ms, start_ms + options.lead_ms + options.window_ms, start_ms + options.durationMs() };
    const udp_drops_before = udpDrops(hub);
    var step_count: u64 = 0;
    var window: usize = 0;
    var next_sample = start_ms + options.sample_ms;
    shared.start_ms.store(start_ms, .release);
    for (0..1 << 40) |_| {
        const now = try network.Now.read(io);
        while (window < bounds.len and now.millis() >= bounds[window]) : (window += 1) edges[window] = .read(hub, &host, step_count, now.millis());
        if (window == bounds.len) break;
        if (now.millis() >= next_sample and sample_count < samples.len) {
            samples[sample_count] = .read(hub, &host, step_count, now.millis());
            sample_count += 1;
            next_sample += options.sample_ms * ((now.millis() - next_sample) / options.sample_ms + 1);
        }
        const deadline = @min(host.deadline() orelse next_sample, next_sample, bounds[window]);
        const before = hub.step_duration.sum;
        const result = network.driver.step(hub, io, now, outputs, .{ .handler = .{ .context = &host, .apply = Host.apply }, .deadline = network.time.optionalMilliseconds(deadline) });
        if (result.readiness.failure) |err| return err;
        if (shared.failed.load(.acquire)) return spokeFailure(spokes);
        step_count += 1;
        if (window == 0) continue;
        if (recorded[window - 1] == step_samples_max) {
            unrecorded += 1;
            continue;
        }
        steps[(window - 1) * step_samples_max + recorded[window - 1]] = @intCast(@min(hub.step_duration.sum - before, std.math.maxInt(u32)));
        recorded[window - 1] += 1;
    }
    const udp_drops = udpDrops(hub) -| udp_drops_before;
    const final: Sample = .read(hub, &host, step_count, bounds[windows.len]);
    shared.stop.store(true, .release);
    for (threads[0..spawned]) |thread| thread.join();
    spawned = 0;
    if (shared.failed.load(.acquire)) return spokeFailure(spokes);

    var previous = edges[0];
    for (samples[0..sample_count]) |*entry| {
        entry.print(&previous, start_ms);
        previous = entry.totals;
    }
    var packed_len: usize = 0;
    for (windows, 0..) |name, index| {
        const window_steps = steps[index * step_samples_max ..][0..recorded[index]];
        printWindow(name, &edges[index + 1].minus(&edges[index]), window_steps);
        std.mem.copyForwards(u32, steps[packed_len..][0..window_steps.len], window_steps);
        packed_len += window_steps.len;
    }
    const total = edges[windows.len].minus(&edges[0]);
    printWindow("run", &total, steps[0..packed_len]);
    var published: u64 = 0;
    var copies: u64 = 0;
    var pressured: u64 = 0;
    var failures: u64 = 0;
    var received: u64 = 0;
    var slow_received: u64 = 0;
    for (spokes) |*spoke| {
        published += spoke.published;
        copies += spoke.copies;
        pressured += spoke.pressured;
        failures += spoke.publish_failures;
        if (isSlow(options, spoke.index)) slow_received += spoke.received else received += spoke.received;
    }
    std.debug.print("case=gossip_burst end spokes_published={d} spokes_copies={d} spokes_publish_pressured={d} spokes_publish_failed={d} spokes_received={d} slow_received={d} hub_refused={d} verdict_failures={d} pending_verdicts={d} queued_frames={d} full_peers={d} hub_udp_drops={d} unrecorded_steps={d}\n", .{ published, copies, pressured, failures, received, slow_received, host.refused, host.failed_verdicts, final.pending_verdicts, final.queued, final.full_peers, udp_drops, unrecorded });
}

fn spokeFailure(spokes: []const Spoke) anyerror {
    for (spokes) |*spoke| if (spoke.failure) |err| {
        std.debug.print("case=gossip_burst spoke={d} failed={s}\n", .{ spoke.index, @errorName(err) });
        return err;
    };
    return error.SpokeFailed;
}

/// Every subnet mesh holds all its subscribers and every session can write.
fn hubReady(hub: *const network.NetworkCore, chain: *const Chain, options: *const Options) bool {
    if (!chain.meshed(hub, options, null, options.mesh)) return false;
    for (hub.protocols.gossipsub.sessions.rows) |*row| if (row.active and row.outStream() == null) return false;
    return true;
}

fn udpDrops(hub: *network.NetworkCore) u64 {
    var total: u64 = 0;
    for (hub.transport.sockets.drops()) |value| total += value orelse 0;
    return total;
}

fn printWindow(name: []const u8, delta: *const Totals, steps: []u32) void {
    std.debug.print("case=gossip_burst window={s} ms={d} received={d} admitted={d} hub_refused={d} verdicts={d} applies={d} verdicts_per_apply={d:.1} forwarded={d} steps={d} owner_busy={d:.2} owner_ns_per_received={d:.0} score_evaluations={d} evaluations_per_1k_received={d:.1}\n", .{ name, delta.at_ms, delta.received, delta.admitted, delta.refused, delta.applied, delta.applies, ratio(delta.applied, delta.applies), delta.forwarded, delta.steps, ratio(delta.step_ns, delta.at_ms * std.time.ns_per_ms), ratio(delta.step_ns, delta.received), delta.score_evaluations, 1000 * ratio(delta.score_evaluations, delta.received) });
    inline for (@typeInfo(Origin).@"enum".fields) |origin| {
        const outcomes = delta.recipients[origin.value];
        if (outcomes[@intFromEnum(Outcome.selected)] > 0 or outcomes[@intFromEnum(Outcome.completed)] > 0) {
            std.debug.print("case=gossip_burst window={s} origin={s} selected={d} queued={d} pressured={d} unavailable={d} completed={d} cancelled={d} dropped_share={d:.3}\n", .{ name, origin.name, outcomes[@intFromEnum(Outcome.selected)], outcomes[@intFromEnum(Outcome.queued)], outcomes[@intFromEnum(Outcome.pressured)], outcomes[@intFromEnum(Outcome.unavailable)], outcomes[@intFromEnum(Outcome.completed)], outcomes[@intFromEnum(Outcome.cancelled)], ratio(outcomes[@intFromEnum(Outcome.pressured)], outcomes[@intFromEnum(Outcome.selected)]) });
        }
    }
    std.debug.print("case=gossip_burst window={s} queue_drops", .{name});
    inline for (@typeInfo(DropReason).@"enum".fields) |field| std.debug.print(" {s}={d}", .{ field.name, delta.queue_drops[field.value] });
    std.debug.print("\ncase=gossip_burst window={s} write_calls={d} write_would_block={d} udp_sent={d} udp_received={d}\n", .{ name, delta.write_calls, delta.would_block, delta.udp_sent, delta.udp_received });
    std.mem.sort(u32, steps, {}, std.sort.asc(u32));
    std.debug.print("case=gossip_burst window={s} step_p50_us={d:.1} step_p99_us={d:.1} step_max_us={d:.1} step_le_100us={d:.4} step_le_1ms={d:.4} step_le_10ms={d:.4}\n", .{ name, stepQuantile(steps, 0.5), stepQuantile(steps, 0.99), stepQuantile(steps, 1), stepShare(steps, 100_000), stepShare(steps, 1_000_000), stepShare(steps, 10_000_000) });
}

/// The nearest-rank quantile of sorted step durations, in microseconds.
fn stepQuantile(sorted: []const u32, q: f64) f64 {
    if (sorted.len == 0) return 0;
    const rank: usize = @intFromFloat(@ceil(q * @as(f64, @floatFromInt(sorted.len))));
    return @as(f64, @floatFromInt(sorted[@max(rank, 1) - 1])) / 1000;
}

/// The share of sorted step durations at or under `limit_ns`, as a cumulative histogram bucket.
fn stepShare(sorted: []const u32, limit_ns: u32) f64 {
    var below: usize = 0;
    for (sorted) |value| {
        if (value > limit_ns) break;
        below += 1;
    }
    return ratio(below, sorted.len);
}
