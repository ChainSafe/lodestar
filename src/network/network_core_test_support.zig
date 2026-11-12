//! Two NetworkCores stepping through their real owner turn over an in-memory link. The link's
//! Io gives both cores its virtual clock and seeded entropy, and captures the datagrams each flush
//! sends. `Link.pump` delivers them and drains the engines directly until the transport settles,
//! so `Setup.step` settles the link and then runs one owner turn on each side.
const std = @import("std");
const support = @import("quic/test_support.zig");
const configuration = @import("configuration.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const constants = @import("constants.zig");
const Engine = @import("quic/Engine.zig");
const keys = @import("wire/keys.zig");
const t = @import("peers/types.zig");
const Transport = @import("transport.zig").Transport;
const types = @import("types.zig");
const local_intent = @import("gossipsub/local_intent.zig");
const topic_policy = @import("gossipsub/topic_policy.zig");
const Inbox = @import("gossipsub/test_support.zig").Inbox;
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const test_support = @import("gossipsub/test_support.zig");
const time = @import("time.zig");
const schedule_test_support = @import("schedule_test_support.zig");
const driver = @import("driver.zig");
const SlotClock = @import("slot_clock.zig").SlotClock;
const preset = @import("preset");
const ReqResp = @import("reqresp/ReqResp.zig");

const Event = Engine.Event;
const Now = Engine.Now;
const net = std.Io.net;

pub const slot_clock: SlotClock = .{ .config = .{ .genesis_time_sec = support.now_unix - 1200, .slot_duration_ms = 12000, .slots_per_epoch = preset.preset.SLOTS_PER_EPOCH } };

pub fn localState(overrides: t.LocalState) t.LocalState {
    var local = overrides;
    local.metadata.custody_group_count = local.metadata.custody_group_count orelse 1;
    local.status.earliest_available_slot = local.status.earliest_available_slot orelse 0;
    return local;
}

/// Linux's default limit for both roles, so harness sockets never log a capped request.
pub const socket_buffers: configuration.SocketBuffers = .{
    .quic = .{ .receive = 208 * 1024, .send = 208 * 1024 },
    .discovery = .{ .receive = 208 * 1024, .send = 208 * 1024 },
};

/// Explicit capacities for the two-core harness.
pub fn options() configuration.Options {
    const gc = @import("gossipsub/constants.zig");
    return .{
        .seed = 1,
        .forks = &.{.{ .digest = @splat(0), .fork = .phase0 }},
        .limits = .{
            .connections_max = 4,
            .handshaking_max = 4,
            .handshaking_per_source_max = 4,
            .dialing_max = 1,
        },
        .socket_buffers = socket_buffers,
        .peers = .{
            .capacity = 4,
            .outbound_reserve = 1,
            .max_peers = 3,
            .target_peers = 2,
            .min_outbound = 1,
        },
        .dial = .{ .capacity = 4, .concurrent_max = 1, .outbound_reserved = 1, .seed = 7 },
        .router = .{ .negotiations_max = 24, .outbound_reserved = 11 },
        .identify = .{ .inbound_max = 2, .outbound_max = 2 },
        .reqresp = .{
            .outbound_max = 13,
            .serving_max = 13,
            .outbound_per_connection_max = 8,
            .inbound_per_connection_max = 8,
        },
        .gossip = .{
            .topic_policy = comptime &.{topic_fixture.bytes(@splat(0))},
            .seen_capacity = 16,
            .mcache_capacity = 8,
            .validation_capacity = 2,
            .mcache_arena_bytes = gc.maxCompressedLen(gc.MAX_PAYLOAD_SIZE) + 4096,
            .receive_arena_bytes = std.mem.alignForward(usize, gc.GOSSIP_MAX_SIZE, 4096),
            .body_buffer_bytes = 256,
            .control_bytes = 512,
            .critical_bytes = 512,
        },
        .admission_policy = policy_fixture.config(),
    };
}

pub fn resolvedOptions() configuration.Resolved {
    return configuration.resolve(options()) catch unreachable;
}

/// Commits `local` through the owner's intent path, keeping its schedule, endpoints,
/// capabilities, subscriptions and demand. The owner assigns the metadata sequence.
pub fn updateLocal(node: *NetworkCore, local: *const t.LocalState, now: Now) !void {
    try updateLocalDemand(node, local, &node.peer_manager.demand, now);
}

/// Commits `demand` through the owner's intent path, keeping its local state, schedule,
/// endpoints, capabilities and subscriptions.
pub fn updateDemand(node: *NetworkCore, demand: *const t.Demand, now: Now) !void {
    try updateLocalDemand(node, &node.peer_manager.local, demand, now);
}

/// Commits `local` and `demand` together through the owner's intent path, keeping its schedule,
/// endpoints, capabilities and subscriptions.
pub fn updateLocalDemand(node: *NetworkCore, local: *const t.LocalState, demand: *const t.Demand, now: Now) !void {
    var boundaries: [topic_policy.boundary_max]local_intent.Boundary = undefined;
    var desired = intent(node, try test_support.subscriptionUpdate(node.protocols.gossipsub, null, false, &boundaries));
    desired.update.local = local.*;
    desired.demand = demand.*;
    _ = try node.applyIntent(&desired, now);
}

/// A datagram a core's flush sent, waiting for the next pump.
const Datagram = struct {
    from_client: bool,
    to: types.Address,
    len: usize,
    bytes: [constants.datagram_size_max]u8,
};

/// Links the client and server cores' engines in memory. Everything the client sends reaches the
/// server from `client_source`, and everything the server sends reaches the client from
/// `server_source`, unless a drop rule applies.
pub const Link = struct {
    now: Now = Now.fromMilliseconds(.{ .mono_ms = 1_000, .unix_s = support.now_unix }),
    client: *Engine = undefined,
    server: *Engine = undefined,
    client_sockets: [2]?net.Socket.Handle = .{ null, null },
    server_sockets: [2]?net.Socket.Handle = .{ null, null },
    drop_to_server: bool = false,
    client_source: types.Address = support.client_address,
    server_source: types.Address = support.server_address,
    drop_to_address: ?types.Address = null,
    base: std.Io = undefined,
    vtable: std.Io.VTable = undefined,
    entropy: std.Random.DefaultCsprng = undefined,
    sent: std.ArrayList(Datagram) = .empty,
    batch: support.Batch = undefined,

    threadlocal var active: ?*Link = null;

    /// Initialize at a stable address; the cores it serves step on this thread.
    fn init(self: *Link) void {
        std.debug.assert(active == null);
        self.* = .{};
        self.base = std.testing.io;
        self.vtable = self.base.vtable.*;
        self.vtable.now = clockHook;
        self.vtable.netSend = sendHook;
        self.vtable.random = randomHook;
        self.vtable.randomSecure = secureHook;
        self.entropy = .init(@splat(3));
        // quiche stamps each datagram's release time from the real clock, and the transport
        // asserts the release against its Io clock, so the virtual clock runs well ahead.
        const real_ms: u64 = @intCast(@divTrunc(std.Io.Clock.awake.now(self.base).nanoseconds, std.time.ns_per_ms));
        self.now.monotonic = time.milliseconds(real_ms + 1_000_000);
        active = self;
    }

    fn deinit(self: *Link) void {
        std.debug.assert(active == self);
        self.sent.deinit(std.testing.allocator);
        active = null;
    }

    pub fn io(self: *Link) std.Io {
        std.debug.assert(active == self);
        return .{ .userdata = self.base.userdata, .vtable = &self.vtable };
    }

    pub fn advance(self: *Link, ms: u64) void {
        self.now.monotonic = time.milliseconds(self.now.millis() + ms);
    }

    /// Dials the server from the client engine, outside the client's dialing policy.
    pub fn dial(self: *Link) !Engine.Handle {
        return self.client.dial(&support.server_address, self.server.tls.local_peer_id, self.now);
    }

    /// Delivers captured and pending datagrams both ways and runs both engines' timer and
    /// readiness phases until neither side has output left.
    pub fn pump(self: *Link) !void {
        var rounds: usize = 0;
        while (rounds < 64) : (rounds += 1) {
            var moved = self.deliver();
            moved = self.transfer(self.client, self.server, self.client_source, self.drop_to_server) or moved;
            moved = self.transfer(self.server, self.client, self.server_source, false) or moved;
            for ([_]*Engine{ self.client, self.server }) |engine| {
                engine.advance(self.now);
            }
            if (!moved and !self.client.backlog() and !self.server.backlog()) return;
        }
        return error.PumpDidNotSettle;
    }

    /// Takes an engine's events outside its owner, for a test that acts as the protocol peer.
    pub fn events(_: *Link, engine: *Engine, storage: []Event) []Event {
        engine.releaseReported();
        return storage[0..engine.pollEvents(storage)];
    }

    fn deliver(self: *Link) bool {
        const moved = self.sent.items.len > 0;
        for (self.sent.items) |*datagram| {
            if (datagram.from_client and self.drop_to_server) continue;
            if (self.drop_to_address) |blocked| if (datagram.to.eql(blocked)) continue;
            const from, const to = if (datagram.from_client) .{ self.client, self.server } else .{ self.server, self.client };
            const source = if (datagram.from_client) self.client_source else self.server_source;
            var response: [constants.datagram_size_max]u8 = undefined;
            const outcome = to.receive(datagram.bytes[0..datagram.len], &source, self.now, &response);
            if (outcome == .retry) {
                var reply: [constants.datagram_size_max]u8 = undefined;
                @memcpy(reply[0..outcome.retry.len], outcome.retry);
                var out: [constants.datagram_size_max]u8 = undefined;
                _ = from.receive(reply[0..outcome.retry.len], &datagram.to, self.now, &out);
            }
        }
        self.sent.clearRetainingCapacity();
        return moved;
    }

    /// Flushes the sender's dirty connections into the receiver, as the transport does.
    pub fn transfer(self: *Link, from: *Engine, to: *Engine, from_address: types.Address, drop: bool) bool {
        var moved = false;
        var remaining = from.dirtyCount();
        while (remaining > 0) : (remaining -= 1) {
            const index = from.nextDirty() orelse break;
            var replies: [Transport.send_burst_max]struct { bytes: [constants.datagram_size_max]u8, len: usize, from: types.Address } = undefined;
            var reply_count: usize = 0;
            var budget: u32 = 0;
            var drained = false;
            while (budget < Transport.send_burst_max) {
                const count = self.batch.fill(from, index, self.now);
                budget += count;
                moved = moved or count > 0;
                for (self.batch.outgoing[0..count]) |sent| {
                    if (drop) continue;
                    if (self.drop_to_address) |blocked| if (sent.to.eql(blocked)) continue;
                    var response: [constants.datagram_size_max]u8 = undefined;
                    const outcome = to.receive(@constCast(sent.bytes), &from_address, self.now, &response);
                    if (outcome == .retry) {
                        const reply = &replies[reply_count];
                        reply.* = .{ .bytes = undefined, .len = outcome.retry.len, .from = sent.to };
                        @memcpy(reply.bytes[0..outcome.retry.len], outcome.retry);
                        reply_count += 1;
                    }
                }
                if (count < constants.send_batch_max) {
                    drained = true;
                    break;
                }
            }
            from.sent(index, self.now, drained);
            // Replies re-dirty the sender after its burst ended, as a later turn would.
            for (replies[0..reply_count]) |*reply| {
                var out: [constants.datagram_size_max]u8 = undefined;
                _ = from.receive(reply.bytes[0..reply.len], &reply.from, self.now, &out);
            }
        }
        from.finishFlush(self.now);
        return moved;
    }

    fn clockHook(_: ?*anyopaque, clock: std.Io.Clock) std.Io.Timestamp {
        const self = active.?;
        return switch (clock) {
            .awake => .{ .nanoseconds = @as(i96, self.now.millis()) * std.time.ns_per_ms },
            .real => .{ .nanoseconds = @as(i96, self.now.unixSeconds()) * std.time.ns_per_s },
            else => self.base.vtable.now(self.base.userdata, clock),
        };
    }

    /// Captures what the QUIC sockets send; other sockets send for real.
    fn sendHook(_: ?*anyopaque, socket: net.Socket.Handle, messages: []net.OutgoingMessage, flags: net.SendFlags) struct { ?net.Socket.SendError, usize } {
        const self = active.?;
        const from_client = self.client_sockets[0] == socket or self.client_sockets[1] == socket;
        const from_server = self.server_sockets[0] == socket or self.server_sockets[1] == socket;
        if (!from_client and !from_server) return self.base.vtable.netSend(self.base.userdata, socket, messages, flags);
        for (messages) |message| {
            std.debug.assert(message.data_len <= constants.datagram_size_max);
            const datagram = self.sent.addOne(std.testing.allocator) catch return .{ error.SystemResources, 0 };
            datagram.* = .{ .from_client = from_client, .to = types.Address.fromNetwork(message.address.*), .len = message.data_len, .bytes = undefined };
            @memcpy(datagram.bytes[0..message.data_len], message.data_ptr[0..message.data_len]);
        }
        return .{ null, messages.len };
    }

    fn randomHook(_: ?*anyopaque, bytes: []u8) void {
        active.?.entropy.fill(bytes);
    }

    fn secureHook(_: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
        active.?.entropy.fill(bytes);
    }
};

pub const Setup = struct {
    pair: Link = .{},
    client: NetworkCore = undefined,
    server: NetworkCore = undefined,
    forks: [4]types.ForkEntry = undefined,
    /// Discovery for the client, set before init, so its local updates publish an ENR.
    client_discovery: ?NetworkCore.DiscoveryOptions = null,
    initialized: [2]bool = .{ false, false },
    client_inbox: Inbox = .{},
    server_inbox: Inbox = .{},
    client_events: [1]t.Event = undefined,
    server_events: [1]t.Event = undefined,

    pub fn init(self: *Setup, local: *const t.LocalState) !void {
        try self.initDirection(local, false);
    }

    pub fn initDirection(self: *Setup, local: *const t.LocalState, reverse: bool) !void {
        try self.initOwners(local);
        errdefer self.deinit();
        if (reverse) {
            _ = try self.pair.server.dial(&support.client_address, self.client.peerId(), self.pair.now);
        } else _ = try self.pair.dial();
    }

    pub fn initOwners(self: *Setup, local: *const t.LocalState) !void {
        try self.initOwnersWithOptions(local, resolvedOptions());
    }

    /// Serves the local fork, the Fulu digests tests move to, and a foreign digest of the local fork.
    pub fn initOwnersWithOptions(self: *Setup, overrides: *const t.LocalState, opts: configuration.Resolved) !void {
        const local = localState(overrides.*);
        self.pair.init();
        errdefer self.deinit();
        var count: usize = 0;
        for ([_]types.ForkEntry{
            .{ .digest = local.fork.digest, .fork = local.fork.fork },
            .{ .digest = @splat(1), .fork = .fulu },
            .{ .digest = @splat(2), .fork = .fulu },
            .{ .digest = @splat(3), .fork = local.fork.fork },
        }) |entry| {
            const known = for (self.forks[0..count]) |known| {
                if (std.mem.eql(u8, &known.digest, &entry.digest)) break true;
            } else false;
            if (known) continue;
            self.forks[count] = entry;
            count += 1;
        }
        var resolved = opts;
        resolved.core.protocols.reqresp.forks = self.forks[0..count];
        resolved.core.protocols.control_reqresp.forks = self.forks[0..count];
        const io = self.pair.io();
        const client_key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
        try self.client.init(std.testing.allocator, io, &resolved, .{ .host = &client_key, .bind = .{ .ip4 = .loopback(0) }, .local = local, .clock = slot_clock, .discovery = self.client_discovery });
        self.initialized[0] = true;
        self.client_inbox.attach(self.client.protocols.gossipsub);
        const server_key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{2}));
        try self.server.init(std.testing.allocator, io, &resolved, .{ .host = &server_key, .bind = .{ .ip4 = .loopback(0) }, .local = local, .clock = slot_clock });
        self.initialized[1] = true;
        self.server_inbox.attach(self.server.protocols.gossipsub);
        self.pair.client = &self.client.transport.engine;
        self.pair.server = &self.server.transport.engine;
        self.pair.client_sockets = self.client.transport.sockets.handles();
        self.pair.server_sockets = self.server.transport.sockets.handles();
    }

    pub fn deinit(self: *Setup) void {
        const io = self.pair.io();
        if (self.initialized[0]) self.client.deinit(io);
        if (self.initialized[1]) self.server.deinit(io);
        self.initialized = .{ false, false };
        self.server_inbox.deinit();
        self.client_inbox.deinit();
        self.pair.deinit();
    }

    /// Gossip delivered in earlier steps is cleared first.
    pub fn step(self: *Setup, capacity: usize) !void {
        self.client_inbox.clear();
        self.server_inbox.clear();
        try self.pair.pump();
        _ = try self.turn(&self.server, .{ .peers = self.server_events[0..capacity] });
        _ = try self.turn(&self.client, .{ .peers = self.client_events[0..capacity] });
    }

    /// One owner turn of `node` at the link's clock, with no wait.
    pub fn turn(self: *Setup, node: *NetworkCore, outputs: NetworkCore.Outputs) !NetworkCore.Result {
        const result = node.advance(self.pair.io(), .{ .now = self.pair.now, .readiness = .{} }, outputs, .deadlineOnly(time.optionalMilliseconds(self.pair.now.millis())));
        if (result.failure) |err| return err;
        return result;
    }
};

pub const NetworkOptions = struct {
    resolved: configuration.Resolved,
    startup: NetworkCore.Startup,
};

/// The owner harness options resolved for a NetworkCore on loopback.
pub fn networkOptions(key: *const keys.KeyPair) NetworkOptions {
    var requested = options();
    requested.forks = &.{
        .{ .digest = @splat(0), .fork = .phase0 },
        .{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu },
    };
    requested.reqresp.outbound_per_connection_max = 4;
    requested.gossip.topic_policy = comptime &.{
        topic_fixture.bytes(@splat(0)),
        topic_fixture.bytes(.{ 1, 2, 3, 4 }),
    };
    return .{
        .resolved = configuration.resolve(requested) catch unreachable,
        .startup = .{
            .host = key,
            .bind = .{ .ip4 = .loopback(0) },
            .local = localState(.{}),
            .clock = slot_clock,
        },
    };
}

pub fn intent(node: *const NetworkCore, subscriptions: []const local_intent.Boundary) NetworkCore.LocalIntent {
    return .{
        .update = .{
            .local = node.localState(),
            .schedule = node.fork_schedule,
            .endpoints = node.advertisementEndpoints(),
            .capabilities = node.protocols.router.capabilities(),
        },
        .demand = node.peer_manager.demand,
        .subscriptions = subscriptions,
    };
}

/// Peer control rows with an outstanding request.
pub fn controlOperations(node: *const NetworkCore) usize {
    var count: usize = 0;
    for (node.peer_manager.control.connections) |*op| count += @intFromBool(op.request != null);
    return count;
}

pub fn subscribe(node: *NetworkCore, name: []const u8) !void {
    try setSubscription(node, name, true);
}

pub fn unsubscribe(node: *NetworkCore, name: []const u8) !void {
    try setSubscription(node, name, false);
}

fn setSubscription(node: *NetworkCore, name: []const u8, subscribed: bool) !void {
    var boundaries: [topic_policy.boundary_max]local_intent.Boundary = undefined;
    const desired = intent(node, try test_support.subscriptionUpdate(node.protocols.gossipsub, name, subscribed, &boundaries));
    _ = try node.applyIntent(&desired, node.last_now);
}

pub fn clientWakeup(setup: *Setup) ?u64 {
    return schedule_test_support.wakeupMilliseconds(setup.client.schedule(setup.pair.now, .{}), setup.pair.now.millis());
}

pub fn stepAfter(node: *NetworkCore, wait_ms: u32) !NetworkCore.Result {
    const now = try Now.read(std.testing.io);
    return driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| wait_ms)));
}

pub fn failStatus(setup: *Setup, failure: ReqResp.Failure) !void {
    for (setup.client.peer_manager.control.connections) |operation| if (operation.request) |handle| {
        if (operation.protocol != .status_v1) continue;
        const requests = &setup.client.protocols.control_reqresp;
        const slot = &requests.outbound[handle.index];
        slot.fail(requests, setup.pair.client, &setup.client.protocols.router, handle.index, failure, setup.pair.now);

        return;
    };
    return error.TestUnexpectedResult;
}

pub fn failStatusRound(setup: *Setup, failure: ReqResp.Failure) !void {
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    try setup.step(0);
    try failStatus(setup, failure);
    for (0..4) |_| try setup.step(0);
}
