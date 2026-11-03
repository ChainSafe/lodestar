const std = @import("std");
const Now = @import("network").Now;
const network = @import("network");
const control = @import("peer_control.zig");
const snapshot = @import("peer_snapshot.zig");
const Gossip = network.gossipsub;
const Engine = network.quic.Engine;
const ReqResp = network.reqresp.ReqResp;
const max_payload = 10 * 1024 * 1024;
const topic = "/eth2/01000000/beacon_block/ssz_snappy";
const ping = [_]u8{ 1, 0, 0, 0, 0, 0, 0, 0 };
const identify_status = [_]u8{1} ++ [_]u8{0} ** 91;
const range = [_]u8{0} ** 8 ++ ping ++ ping;
const config = @import("config");

/// A gossip message admitted through the sink, reported after the protocol turn.
const Delivery = struct {
    handle: Gossip.Gossipsub.ValidationHandle,
    id: Gossip.Gossipsub.MessageId,
    topic: [Gossip.topic.topic_max_len]u8,
    topic_len: usize,
    length: usize,
    sha256: [64]u8,
};

pub const Peer = struct {
    transport: network.Transport = .{},
    protocols: network.Protocols,
    io: std.Io,
    allocator: std.mem.Allocator,
    conn: ?Engine.Handle = null,
    now: network.Now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }),
    clock_offset: u64 = 0,
    emitted: usize = 0,
    steps: usize = 0,
    sink: []u8,
    response: []u8,
    response_seed: u32 = 0x6d2b79f5,
    response_size: usize = max_payload,
    outbound: bool = false,
    paused: bool = false,
    hold_fin: bool = false,
    held_finish: ?struct { owner: *ReqResp, request: ReqResp.RequestHandle } = null,
    held_since: ?u64 = null,
    finish_calls: usize = 0,
    quit: bool = false,
    status_accepted: bool = false,
    application: bool = false,
    /// One response per inbound request slot, since chunks borrow their bytes until sent.
    control_responses: [][92]u8 = &.{},
    gossip_sink: Gossip.Gossipsub.MessageSink = undefined,
    deliveries: [16]Delivery = undefined,
    delivery_count: usize = 0,

    /// The peer must not move while the protocol stack holds the sink.
    fn attachSink(self: *Peer) void {
        self.gossip_sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        self.protocols.gossipsub.message_sink = &self.gossip_sink;
    }

    fn hasCapacity(context: *anyopaque, _: Gossip.topic.Kind, _: usize) bool {
        const self: *Peer = @ptrCast(@alignCast(context));
        return self.delivery_count < self.deliveries.len;
    }

    fn admit(context: *anyopaque, candidate: *Gossip.Gossipsub.MessageAdmission) bool {
        const self: *Peer = @ptrCast(@alignCast(context));
        if (self.delivery_count == self.deliveries.len) return false;
        if (!candidate.sourceRoom() or !candidate.fits(&candidate.room())) return false;
        candidate.commit();
        const event = &candidate.event;
        const delivery = &self.deliveries[self.delivery_count];
        delivery.* = .{ .handle = event.handle, .id = event.id, .topic = undefined, .topic_len = event.topic.len, .length = event.bytes.len, .sha256 = hash(event.bytes) };
        @memcpy(delivery.topic[0..event.topic.len], event.topic);
        self.delivery_count += 1;
        return true;
    }

    fn deliver(self: *Peer, name: []const u8, length: usize, sha256: [64]u8, id: Gossip.Gossipsub.MessageId, handle: Gossip.Gossipsub.ValidationHandle) !void {
        self.emitted += 1;
        try control.emit(self.allocator, .{ .event = "message", .topic = name, .length = length, .sha256 = sha256, .messageId = std.fmt.bytesToHex(id, .lower) });
        const report = self.protocols.gossipsub.report(handle, .accept, self.now);
        std.debug.assert(report == .applied);
    }

    pub fn pump(self: *Peer) !void {
        if (self.steps >= 10_000_000) return error.StepBound;
        self.steps += 1;
        var events: [32]Engine.Event = undefined;
        var requests: [16]network.reqresp.ReqResp.Event = undefined;
        const stepped = network.transport_driver.step(&self.transport, self.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        const result = stepped.progress;
        self.now = result.now;
        self.now.monotonic = network.time.milliseconds(self.now.millis() + self.clock_offset);
        if (self.held_since) |since| if (self.now.millis() -| since >= 10_000) return error.FinHoldTimeout;
        for (events[0..result.events]) |event| switch (event) {
            .connected => |c| {
                self.conn = c.conn;
                _ = self.protocols.gossipsub.peerConnected(&self.transport.engine, c.conn, false, self.now);
                var text: [network.wire.peer_id.text_length_max]u8 = undefined;
                try control.emit(self.allocator, .{ .event = "connected", .peer = c.peer_id.toText(&text), .generation = c.conn.generation });
            },
            .closed => |c| {
                if (self.conn) |conn| if (std.meta.eql(conn, c.conn)) {
                    self.conn = null;
                };
                const slot = &self.transport.engine.registry.slots[c.conn.index];
                try control.emit(self.allocator, .{ .event = "closed", .reason = @tagName(c.reason), .tls = if (slot.handshake.failure) |failure| @errorName(failure) else null });
            },
            else => {},
        };
        var controls: [16]network.reqresp.ReqResp.Event = undefined;
        var identified: [4]network.identify.Handler.Result = undefined;
        const counts = self.protocols.process(&self.transport.engine, events[0..result.events], self.now, .{ .application = &requests, .control = &controls, .identify = &identified });
        for (requests[0..counts.application]) |event| try self.requestEvent(&self.protocols.reqresp, event);
        for (controls[0..counts.control]) |event| try self.requestEvent(&self.protocols.control_reqresp, event);
        for (identified[0..counts.identify]) |*completion| switch (completion.outcome) {
            .success => |*metadata| try control.emit(self.allocator, .{ .event = "identified", .agent = if (metadata.agent) |*agent| agent.slice() else null, .identify = metadata.protocols.contains(.identify), .meshsub = metadata.protocols.contains(.{ .meshsub = .v1_2 }), .status2 = metadata.protocols.contains(.{ .reqresp = .status_v2 }) }),
            .failed => |failure| try control.emit(self.allocator, .{ .event = "identifyFailed", .reason = @tagName(failure) }),
        };
        const delivered = self.delivery_count;
        self.delivery_count = 0;
        for (self.deliveries[0..delivered]) |*delivery| try self.deliver(delivery.topic[0..delivery.topic_len], delivery.length, delivery.sha256, delivery.id, delivery.handle);
        if (stepped.failure) |err| return err;
    }

    fn requestEvent(self: *Peer, owner: *ReqResp, event: network.reqresp.ReqResp.Event) !void {
        switch (event) {
            .request => |r| {
                if (self.application and owner == &self.protocols.control_reqresp) {
                    if (r.protocol == .goodbye_v1) {
                        std.debug.assert(owner.finish(r.request, self.now));
                        return;
                    }
                    const out = &self.control_responses[r.request.index];
                    @memset(out, 0);
                    const len: usize = switch (r.protocol) {
                        .status_v1, .status_v2, .ping_v1 => blk: {
                            @memcpy(out[0..r.bytes.len], r.bytes);
                            break :blk r.bytes.len;
                        },
                        .metadata_v1 => 16,
                        .metadata_v2 => 17,
                        .metadata_v3 => blk: {
                            out[17] = 1;
                            break :blk 25;
                        },
                        else => unreachable,
                    };
                    try owner.respond(r.request, out[0..len], null, self.now);
                    return;
                }
                if (r.protocol == .status_v2) {
                    const remote = try network.control_wire.decodeStatus(.status_v2, r.bytes);
                    const local = try network.control_wire.decodeStatus(.status_v2, &identify_status);
                    if (!std.meta.eql(remote, local)) return error.InvalidStatus;
                    try owner.respond(r.request, &identify_status, null, self.now);
                    self.status_accepted = true;
                    try control.emit(self.allocator, .{ .event = "statusAccepted", .protocol = r.protocol.id() });
                    return;
                }
                if (r.protocol != .ping_v1 and r.protocol != .blocks_by_range_v2) return error.UnexpectedProtocol;
                if (!std.mem.eql(u8, r.bytes, if (r.protocol == .ping_v1) &ping else &range)) return error.InvalidRequestBytes;
                try control.emit(self.allocator, .{ .event = "request", .protocol = r.protocol.id(), .length = r.bytes.len, .sha256 = hash(r.bytes) });
                if (r.protocol == .ping_v1) {
                    try owner.respond(r.request, &ping, null, self.now);
                } else {
                    generate(self.response[0..self.response_size], self.response_seed);
                    try owner.respond(r.request, self.response[0..self.response_size], .{ .digest = if (self.application) applicationDigest() else .{ 1, 0, 0, 0 }, .fork = .deneb }, self.now);
                }
            },
            .chunk => |c| {
                const decoded_context = owner.outbound[c.request.index].request.io.decoder.context();
                const context_hex = if (decoded_context) |digest| std.fmt.bytesToHex(digest, .lower) else null;
                try control.emit(self.allocator, .{ .event = "chunk", .length = c.bytes.len, .sha256 = hash(c.bytes), .context = if (context_hex) |*value| @as(?[]const u8, value) else null, .result = 0 });
                std.debug.assert(owner.consume(&self.transport.engine, &self.protocols.router, c.request, self.now));
            },
            .done => {
                self.outbound = false;
                try control.emit(self.allocator, .{ .event = "done" });
            },
            .failed => |f| {
                self.outbound = false;
                try control.emit(self.allocator, .{ .event = "failed", .reason = @tagName(f.reason) });
            },
            .chunk_sent => |c| {
                if (self.hold_fin) {
                    self.held_finish = .{ .owner = owner, .request = c.request };
                    self.held_since = self.now.millis();
                } else {
                    self.finish_calls += 1;
                    std.debug.assert(owner.finish(c.request, self.now));
                }
            },
            else => {},
        }
    }

    pub fn command(self: *Peer, c: control.Command) !void {
        if (std.mem.eql(u8, c.op, "listen")) {
            var text: [network.wire.multiaddr.text_length_max]u8 = undefined;
            const addr = self.transport.localMultiaddr();
            return control.emit(self.allocator, .{ .id = c.id, .ok = true, .address = try addr.toText(&text), .peer = &std.fmt.bytesToHex(addr.peer.?.bytes, .lower) });
        }
        if (std.mem.eql(u8, c.op, "snapshot")) return snapshot.emit(self, c.id);
        if (std.mem.eql(u8, c.op, "dial")) {
            const target = try network.wire.multiaddr.Multiaddr.parse(c.address orelse return error.MissingAddress);
            switch (target.address) {
                .ip4 => |a| if (!std.mem.eql(u8, &a.octets, &.{ 127, 0, 0, 1 })) return error.NotLoopback,
                else => return error.NotLoopback,
            }
            self.conn = try self.transport.dial(self.io, &target, try network.Now.read(self.io));
        } else if (std.mem.eql(u8, c.op, "identifyMode") or std.mem.eql(u8, c.op, "enableGossipRequest")) {
            var active = network.capabilities.withIdentify(try network.capabilities.forFork(.fulu, true, &.{ .v1_2, .v1_1 }));
            if (std.mem.eql(u8, c.op, "identifyMode")) {
                active.request = .initEmpty();
                for (std.enums.values(network.reqresp.Protocol)) |protocol| if (active.receive.contains(.{ .reqresp = protocol })) {
                    active.request.insert(.{ .reqresp = protocol });
                };
                active.request.insert(.identify);
            }
            try self.protocols.router.validateCapabilities(active);
            self.protocols.router.setCapabilities(active);
            if (std.mem.eql(u8, c.op, "enableGossipRequest")) {
                const sessions = self.protocols.gossipsub.sessions;
                // Restoring capabilities does not retry a previously refused outbound stream.
                for (sessions.rows, 0..) |*session, index| {
                    if (session.active and session.outbound == .none) sessions.setOutbound(@intCast(index), .pending);
                }
            }
        } else if (std.mem.eql(u8, c.op, "identify")) {
            if (!self.status_accepted) return error.StatusRequired;
            const conn = self.conn orelse return error.NoConnection;
            try self.protocols.identify.start(&self.protocols.router, &self.transport.engine, .{ .index = 0, .generation = conn.generation }, conn, self.now);
        } else if (std.mem.eql(u8, c.op, "subscribe")) {
            const parsed = Gossip.topic.parseCanonical(c.topic orelse topic) orelse return error.InvalidTopic;
            if (parsed.name.kind != .beacon_block) return error.InvalidTopic;
            var subscription: Gossip.local_intent.Boundary = .{ .digest = parsed.digest };
            subscription.mask(.beacon_block)[0] = 1;
            subscription.lengths[@intFromEnum(Gossip.topic.Kind.beacon_block)] = 1;
            var workspace: Gossip.local_intent.Workspace = .{};
            _ = try self.protocols.gossipsub.prepareSubscriptions(&.{subscription}, &workspace, self.now, 0);
            self.protocols.gossipsub.commitSubscriptions(&workspace);
        } else if (std.mem.eql(u8, c.op, "publish")) {
            const size = c.size orelse 65537;
            if (size > max_payload) return error.MessageTooLarge;
            const bytes = try self.allocator.alloc(u8, size);
            defer self.allocator.free(bytes);
            generate(bytes, c.seed orelse 0x6d2b79f5);
            const outcome = try self.protocols.gossipsub.publish(c.topic orelse topic, bytes, self.now);
            return control.emit(self.allocator, .{ .id = c.id, .ok = true, .queued = outcome.queued, .pressured = outcome.pressured });
        } else if (std.mem.eql(u8, c.op, "request")) {
            if (self.outbound) return error.Busy;
            const large = c.large orelse false;
            const owner = if (large) &self.protocols.reqresp else &self.protocols.control_reqresp;
            _ = try owner.request(&self.transport.engine, &self.protocols.router, self.conn orelse return error.NoConnection, if (large) .blocks_by_range_v2 else .ping_v1, if (large) &range else &ping, self.sink, .{ .expected_chunks = 1 }, self.now);
            self.outbound = true;
        } else return self.schedule(c);
        try control.emit(self.allocator, .{ .id = c.id, .ok = true });
    }

    fn schedule(self: *Peer, c: control.Command) !void {
        if (std.mem.eql(u8, c.op, "holdFin")) {
            self.hold_fin = true;
        } else if (std.mem.eql(u8, c.op, "releaseFin")) {
            const request = self.held_finish orelse return error.NoHeldFin;
            self.finish_calls += 1;
            _ = request.owner.finish(request.request, self.now);
            self.held_finish = null;
            self.held_since = null;
            self.hold_fin = false;
        } else if (std.mem.eql(u8, c.op, "pause")) {
            self.paused = c.paused orelse return error.MissingPause;
        } else if (std.mem.eql(u8, c.op, "advance")) {
            const ms = c.ms orelse return error.MissingTime;
            if (ms > 120_000 or self.clock_offset + ms > 2_000_000) return error.ClockBound;
            self.clock_offset += ms;
        } else if (std.mem.eql(u8, c.op, "pump")) {
            const turns = c.turns orelse 8;
            if (turns > 1024) return error.TurnBound;
            for (0..turns) |_| try self.pump();
        } else if (std.mem.eql(u8, c.op, "respond")) {
            const size = c.size orelse max_payload;
            if (size > max_payload) return error.MessageTooLarge;
            self.response_size = size;
            self.response_seed = c.seed orelse 0x6d2b79f5;
        } else if (std.mem.eql(u8, c.op, "disconnect")) {
            if (self.conn) |conn| {
                _ = self.transport.engine.close(conn, 0);
            }
        } else if (std.mem.eql(u8, c.op, "ids")) {
            return snapshot.ids(self.allocator, c.id);
        } else if (std.mem.eql(u8, c.op, "shutdown")) {
            self.quit = true;
        } else return error.UnknownOperation;
        try control.emit(self.allocator, .{ .id = c.id, .ok = true });
    }
};

pub fn hash(bytes: []const u8) [64]u8 {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    return std.fmt.bytesToHex(digest, .lower);
}
pub fn generate(bytes: []u8, seed: u32) void {
    std.debug.assert(bytes.len <= max_payload);
    var x = seed;
    for (bytes) |*byte| {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        byte.* = @truncate(x);
    }
}
pub fn main(init: std.process.Init) !void {
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer std.debug.assert(gpa.deinit() == .ok);
    const a = gpa.allocator();
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const application = args.len == 2 and std.mem.eql(u8, args[1], "--application");
    var blob_schedule: [network.reqresp.request_policy.schedule_max]network.reqresp.request_policy.BlobLimit = undefined;
    const policy = try network.reqresp.request_policy.Config.fromBeaconConfig(&config.mainnet.config, &blob_schedule);
    const admission = try ReqResp.Options.Admission.defaults(&policy, 1);
    var control_admission = try ReqResp.Options.Admission.defaults(&policy, 4);
    control_admission.scope = .peer;
    control_admission.limits.source.protocols[@intFromEnum(network.reqresp.Protocol.ping_v1)] = .{ .tokens = 16, .period_ms = 30_000 };
    control_admission.limits.global.protocols[@intFromEnum(network.reqresp.Protocol.ping_v1)] = .{ .tokens = 4 * 16, .period_ms = 30_000 };
    var gossip_topics: [1]Gossip.topic_policy.Boundary = .{.{ .digest = if (application) applicationDigest() else .{ 1, 0, 0, 0 } }};
    gossip_topics[0].rules[@intFromEnum(Gossip.topic.Kind.beacon_block)] = .{ .count = 1, .ssz_min = 0, .ssz_max = max_payload };
    const peer = try a.create(Peer);
    defer a.destroy(peer);
    peer.* = .{ .application = application, .allocator = a, .io = init.io, .protocols = undefined, .sink = undefined, .response = undefined };
    const key = try network.wire.keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ .{31}));
    try peer.transport.init(a, init.io, .{ .host = &key, .bind = .{ .ip4 = .{ .bytes = .{ 127, 0, 0, 1 }, .port = 0 } }, .limits = .{ .connections_max = 4, .handshaking_max = 4, .dialing_max = 2, .outbound_max = 3 } });
    defer peer.transport.deinit(init.io);
    const forks: []const network.types.ForkEntry = &.{.{ .digest = if (application) applicationDigest() else .{ 1, 0, 0, 0 }, .fork = .deneb }};
    const protocols_options: network.Protocols.Options = .{
        .identify = .{ .agent = "lodestar-z-identify" },
        .reqresp = .{
            .protocols = .application,
            .admission = admission,
            .connections = 4,
            .outbound_max = 1,
            .serving_max = if (application) 6 else 1,
            .inbound_per_connection_max = if (application) 8 else 1,
            .forks = forks,
            .progress_timeout_ms = 5000,
        },
        .control_reqresp = .{
            .protocols = .control,
            .routes = .control,
            .report_non_completion = false,
            .admission = control_admission,
            .connections = 4,
            .outbound_max = 1,
            .serving_max = 0,
            .serving_per_source_max = 0,
            .inbound_per_connection_max = 8,
            .forks = forks,
            .progress_timeout_ms = 5000,
        },
        .router = .{ .negotiations_max = 16 },
        .gossipsub = .{ .topic_policy = &gossip_topics, .message_id_policy = .{ .phase0_digest = .{ 1, 0, 0, 0 } }, .random_seed = 0x6d2b79f5 },
    };
    const local = try protocols_options.identify.makeLocal(&peer.transport.peerId(), &peer.transport.sockets.localAddresses());
    peer.protocols = try network.Protocols.init(a, protocols_options, &local);
    defer peer.protocols.deinit();
    peer.control_responses = try a.alloc([92]u8, peer.protocols.control_reqresp.inbound.len);
    defer a.free(peer.control_responses);
    peer.attachSink();
    peer.sink = try a.alloc(u8, max_payload);
    defer a.free(peer.sink);
    peer.response = try a.alloc(u8, max_payload);
    defer a.free(peer.response);

    defer peer.protocols.shutdown(&peer.transport.engine, peer.now);
    try control.run(peer);
}

fn applicationDigest() [4]u8 {
    var root: [32]u8 = undefined;
    config.BeaconConfig.computeForkDataRoot(.{ 4, 0, 0, 0 }, @splat(0), &root);
    return root[0..4].*;
}
