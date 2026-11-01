const std = @import("std");
const network = @import("network");
const control = @import("peer_control.zig");
const t = network.peers.types;
const config = @import("config");

const Peer = struct {
    node: network.NetworkCore,
    allocator: std.mem.Allocator,
    io: std.Io,
    paused: bool = false,
    quit: bool = false,
    now: network.Now,
    peer: ?t.PeerRef = null,
    capacity: usize = 1,
    emitted: u16 = 0,

    pub fn pump(self: *Peer) !void {
        self.now = try network.Now.read(self.io);
        var events: [1]t.Event = undefined;
        const result = network.driver.step(&self.node, self.io, self.now, .{ .peers = events[0..self.capacity] }, .deadlineOnly(network.time.optionalMilliseconds(self.now.millis() +| 1)));
        if (result.failure) |err| return err;
        for (events[0..result.counts.peers]) |event| {
            if (self.emitted == 512) return error.EventBound;
            self.emitted += 1;
            switch (event) {
                .ready, .updated => |snapshot| {
                    self.peer = snapshot.peer;
                    var identity: [network.wire.peer_id.text_length_max]u8 = undefined;
                    try control.emit(self.allocator, .{ .event = @tagName(event), .peer = snapshot.identity.toText(&identity), .relevant = snapshot.relevant });
                },
                .closed => |closed| {
                    self.peer = null;
                    try control.emit(self.allocator, .{ .event = "closed", .reason = @tagName(closed.reason) });
                },
            }
        }
    }
    pub fn command(self: *Peer, command_value: control.Command) !void {
        const instruction = command_value;
        if (std.mem.eql(u8, instruction.op, "listen")) {
            var text: [network.wire.multiaddr.text_length_max]u8 = undefined;
            return control.emit(self.allocator, .{ .id = instruction.id, .ok = true, .address = try self.node.localMultiaddr().toText(&text) });
        }
        if (std.mem.eql(u8, instruction.op, "dial")) {
            const target = try network.Multiaddr.parse(instruction.address orelse return error.MissingAddress);
            if (target.address != .ip4 or !std.mem.eql(u8, &target.address.ip4.octets, &.{ 127, 0, 0, 1 })) return error.NotLoopback;
            try self.node.connectUntil(&(target.peer orelse return error.MissingPeer), &.{target.address}, self.now, network.time.milliseconds(self.now.millis() +| network.peers.Dialing.connect_timeout_ms));
        } else if (std.mem.eql(u8, instruction.op, "capacity")) {
            const capacity = instruction.capacity orelse return error.MissingCapacity;
            if (capacity > 1) return error.InvalidCapacity;
            self.capacity = capacity;
        } else if (std.mem.eql(u8, instruction.op, "snapshot")) {
            var rows: [4]t.Snapshot = undefined;
            const count = self.node.peer_manager.snapshots(&rows);
            var seq: [24]u8 = undefined;
            var native_generation: ?u32 = null;
            var metadata_sequence: ?[]const u8 = null;
            var custody: ?usize = null;
            var sampling: ?usize = null;
            var reason: ?[]const u8 = null;
            var deadline: ?u64 = null;
            for (rows[0..count]) |row| if (row.connection) |conn| {
                self.peer = row.peer;
                native_generation = conn.generation;
                if (row.metadata) |metadata| metadata_sequence = try std.fmt.bufPrint(&seq, "{d}", .{metadata.seq_number});
                if (row.custody_groups) |groups| custody = groups.count();
                if (row.sampling_groups) |groups| sampling = groups.count();
                if (row.disconnect_reason) |value| reason = @tagName(value);
                if (self.node.peer_manager.control.connections[row.peer.index].closing) |closing| deadline = closing.deadline_ms;
            };
            return control.emit(self.allocator, .{ .id = instruction.id, .ok = true, .connected = self.node.peerCounts().connected, .relevant = self.node.peerCounts().relevant, .generation = native_generation, .sequence = metadata_sequence, .custody = custody, .sampling = sampling, .reason = reason, .deadline = deadline, .now = self.now.millis() });
        } else if (std.mem.eql(u8, instruction.op, "disconnect")) {
            if (!self.node.peer_manager.disconnect(self.peer orelse return error.NoPeer, .host, self.now)) return error.NoPeer;
        } else if (std.mem.eql(u8, instruction.op, "shutdown")) {
            self.node.shutdown(self.now);
            self.node.deinit(self.io);
            self.quit = true;
        } else return error.UnknownOperation;
        try control.emit(self.allocator, .{ .id = instruction.id, .ok = true });
    }
};

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.ExpectedFork;
    const fork: t.ForkSeq = if (std.mem.eql(u8, args[1], "phase0")) .phase0 else if (std.mem.eql(u8, args[1], "altair")) .altair else if (std.mem.eql(u8, args[1], "fulu")) .fulu else return error.InvalidFork;
    var allocator: std.heap.DebugAllocator(.{}) = .{};
    defer std.debug.assert(allocator.deinit() == .ok);
    const a = allocator.allocator();
    const peer = try a.create(Peer);
    defer a.destroy(peer);
    peer.allocator = a;
    peer.io = init.io;
    peer.now = try network.Now.read(init.io);
    peer.paused = false;
    peer.quit = false;
    peer.peer = null;
    peer.capacity = 1;
    peer.emitted = 0;
    const key = try network.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{32}));
    var local: t.LocalState = .{
        .fork = .{ .minimum_sampling_groups = if (fork.gte(.fulu)) 8 else 0, .fork = fork, .digest = .{ 1, 2, 3, 4 } },
        .status = .{ .fork_digest = .{ 1, 2, 3, 4 }, .finalized_epoch = 0x01020304, .head_slot = 0x08070605, .earliest_available_slot = 0x090a0b0c },
        .metadata = .{ .seq_number = 0x0807060504030201, .attnets = .{ 0x81, 1, 0, 0x80, 0, 0, 0, 0x80 }, .syncnets = 13, .custody_group_count = 4 },
    };
    for (0..32) |i| {
        local.status.finalized_root[i] = @intCast(i);
        local.status.head_root[i] = @intCast(255 - i);
    }
    var gossip_topics: [1]network.gossipsub.topic_policy.Boundary = .{.{ .digest = local.fork.digest }};
    gossip_topics[0].rules[@intFromEnum(network.gossipsub.topic.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 100 };
    var blob_schedule: [network.reqresp.request_policy.schedule_max]network.reqresp.request_policy.BlobLimit = undefined;
    const resolved = try network.configuration.resolve(.{
        .seed = 17,
        .forks = &.{.{ .digest = local.fork.digest, .fork = fork }},
        .limits = .{ .connections_max = 4, .handshaking_max = 4, .dialing_max = 2 },
        .peers = .{ .capacity = 4, .outbound_reserve = 1, .target_peers = 1, .max_peers = 3, .min_outbound = 0 },
        .control = .{ .inbound_status_grace_ms = 20, .ping_inbound_ms = 1_000, .ping_outbound_ms = 1_000 },
        .gossip = .{ .topic_policy = &gossip_topics, .receive_arena_bytes = 16 * 1024 * 1024 },
        .admission_policy = try network.reqresp.request_policy.Config.fromBeaconConfig(&config.mainnet.config, &blob_schedule),
    });
    const unix_s: u64 = @intCast((try network.Now.read(init.io)).unixSeconds());
    const clock = try network.SlotClock.init(&config.mainnet.chain_config, unix_s - local.status.head_slot * config.mainnet.chain_config.SECONDS_PER_SLOT);
    try peer.node.init(a, init.io, &resolved, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = local,
        .schedule = .{ .fulu_scheduled = fork.gte(.fulu) },
        .clock = clock,
    });
    defer peer.node.deinit(init.io);
    try control.run(peer);
}
