const Now = @import("types.zig").Now;
const driver = @import("driver.zig");
const std = @import("std");
const d = @import("discv5");
const core_test = @import("network_core_test_support.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const keys = @import("wire/keys.zig");
const Sockets = @import("udp").Sockets;
const transport = @import("transport.zig");
const time = @import("time.zig");
const Multiaddr = @import("wire/multiaddr.zig").Multiaddr;

const Peers = struct {
    nodes: []d.Transport,
    fn init() !Peers {
        const nodes = try std.testing.allocator.alloc(d.Transport, 10);
        errdefer std.testing.allocator.free(nodes);
        var initialized: usize = 0;
        errdefer for (nodes[0..initialized]) |*node| node.deinit(std.testing.allocator, std.testing.io);
        for (nodes, 0..) |*node, i| {
            const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{@as(u8, @intCast(100 + i))}));
            var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .{ .bytes = .{ 127, 1, @intCast(i), 1 }, .port = 0 } });
            errdefer sockets.close(std.testing.io);
            const record = try d.identity.enr.Record.create(&key, 1, d.types.Address.fromNetwork(sockets.primary().address));
            try node.init(std.testing.allocator, sockets, key, record, .{});
            initialized += 1;
        }
        return .{ .nodes = nodes };
    }
    fn deinit(self: *Peers) void {
        for (self.nodes) |*node| node.deinit(std.testing.allocator, std.testing.io);
        std.testing.allocator.free(self.nodes);
    }
    fn observe(self: *Peers, node: *NetworkCore, peers: usize, id: u8) !void {
        const owner = node.discovery.?;
        for (self.nodes[0..peers]) |*remote| {
            const record = remote.engine.localRecord();
            const peer: d.types.Endpoint = .{ .node_id = record.node_id, .address = remote.localAddress() };
            const now_ms = try d.Transport.monotonicMilliseconds(std.testing.io);
            const handle = try owner.transport.startCall(std.testing.io, peer, record, &.{ .ping = .{
                .request_id = try .init(&.{id}),
                .enr_sequence = node.localRecord().?.sequence,
            } }, now_ms);
            if (owner.storage.observations.canProbe(&peer, now_ms)) owner.storage.observations.attempted(&peer, handle, now_ms);
            var expired: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
            var completed = false;
            for (0..100) |_| {
                const now = try Now.read(std.testing.io);
                const response = try d.driver.step(remote, std.testing.io, &expired, .{ .deadline = now.monotonic, .wait_max = .fromMilliseconds(10) });
                if (response.failure) |failure| return failure.cause;
                const result = driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
                if (result.failure) |err| return err;
                if (owner.transport.engine.calls.count() == 0) {
                    completed = true;
                    break;
                }
            }
            try std.testing.expect(completed);
        }
    }
};

test "address-less discovery learns from ten authenticated prefixes and updates ENR and Identify together" {
    var peers = try Peers.init();
    defer peers.deinit();
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{92}));
    var opts = core_test.networkOptions(&key);
    opts.resolved.core.protocols.identify = .{};
    opts.resolved.core.peers.target_peers = 0;
    opts.resolved.core.peers.min_outbound = 0;
    opts.startup.bind = .{ .ip4 = .{ .bytes = @splat(0), .port = 0 } };
    opts.startup.discovery = .{ .bind = opts.startup.bind };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    try std.testing.expect(node.localRecord().?.ip4 == null);
    const initial = node.localRecord().?.sequence;
    try peers.observe(&node, 9, 1);
    try std.testing.expect(node.localRecord().?.ip4 == null);
    try peers.observe(&node, 10, 2);
    const learned = node.advertisementEndpoints().?;
    try std.testing.expect(learned.ip4 != null);
    try std.testing.expectEqual([4]u8{ 127, 0, 0, 1 }, learned.ip4.?);
    try std.testing.expectEqual(node.discovery.?.transport.localAddress().port(), learned.udp.?);
    try std.testing.expectEqual(node.transport.localAddress().port(), learned.quic.?);
    try std.testing.expectEqual(initial + 1, node.localRecord().?.sequence);
    const identify = node.protocols.identify.local;
    try std.testing.expect(identify.address_count > 0);
    try peers.observe(&node, 10, 3);
    try std.testing.expectEqual(initial + 1, node.localRecord().?.sequence);
    var intent = core_test.intent(&node, &.{});
    intent.update.local.metadata.attnets[0] = 1;
    _ = try node.applyIntent(&intent, node.last_now);
    try std.testing.expectEqualDeep(learned, node.advertisementEndpoints().?);
    try std.testing.expectEqualDeep(identify, node.protocols.identify.local);
}

test "failed learned endpoint publication preserves the previous ENR and Identify" {
    var peers = try Peers.init();
    defer peers.deinit();
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{93}));
    var opts = core_test.networkOptions(&key);
    opts.resolved.core.protocols.identify = .{};
    opts.resolved.core.peers.target_peers = 0;
    opts.resolved.core.peers.min_outbound = 0;
    opts.startup.bind = .{ .ip4 = .{ .bytes = @splat(0), .port = 0 } };
    opts.startup.discovery = .{ .bind = opts.startup.bind, .sequence = std.math.maxInt(u64) };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const before = node.localRecord().?.*;
    const identify = node.protocols.identify.local;
    try peers.observe(&node, 10, 1);
    try std.testing.expectEqualSlices(u8, before.slice(), node.localRecord().?.slice());
    try std.testing.expectEqualDeep(identify, node.protocols.identify.local);
    try std.testing.expect(node.advertisementEndpoints().?.ip4 == null);
}

test "core constructs complete dual-family Identify with existing address precedence" {
    const Address = @import("types.zig").Address;
    const explicit = [_]Address{
        .{ .ip4 = .{ .octets = .{ 127, 2, 3, 4 }, .port = 19001 } },
        .{ .ip6 = .{ .octets = std.Io.net.Ip6Address.loopback(19002).bytes, .port = 19002 } },
    };
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{94}));
    for (0..4) |case| {
        var opts = core_test.networkOptions(&key);
        opts.resolved.core.protocols.identify = .{ .agent = "complete", .addresses = if (case == 0) &.{} else &explicit };
        opts.startup.bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
        if (case == 2) opts.startup.discovery = .{ .bind = opts.startup.bind, .fixed = .{
            .ip4 = .{ 127, 9, 8, 7 },
            .ip6 = explicit[1].ip6.octets,
            .quic = 19101,
            .quic6 = 19102,
        } };
        if (case == 3) {
            opts.startup.bind = .{ .dual = .{ .ip4 = .{ .bytes = @splat(0), .port = 0 }, .ip6 = .{ .bytes = @splat(0), .port = 0 } } };
            opts.startup.discovery = .{ .bind = opts.startup.bind };
        }
        var node: NetworkCore = undefined;
        try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
        defer node.deinit(std.testing.io);
        const local = node.protocols.identify.local;
        try std.testing.expectEqualStrings("complete", local.agent.slice());
        try std.testing.expectEqual(@as(u8, if (case == 3) 0 else 2), local.address_count);
        for (local.addresses[0..local.address_count], 0..) |encoded, family| {
            const addr = (try Multiaddr.decode(encoded.bytes[0..encoded.len])).address;
            const expected = switch (case) {
                0 => node.transport.sockets.localAddresses()[family].?,
                1 => explicit[family],
                2 => if (family == 0) Address{ .ip4 = .{ .octets = .{ 127, 9, 8, 7 }, .port = 19101 } } else Address{ .ip6 = .{ .octets = explicit[1].ip6.octets, .port = 19102 } },
                else => unreachable,
            };
            try std.testing.expectEqual(expected, addr);
        }
        const intent = core_test.intent(&node, &.{});
        try std.testing.expect(!try node.applyIntent(&intent, node.last_now));
        try std.testing.expectEqualDeep(local, node.protocols.identify.local);
    }
}
