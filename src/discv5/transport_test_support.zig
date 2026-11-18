const std = @import("std");
const net = std.Io.net;
const Engine = @import("Engine.zig");
const Transport = @import("Transport.zig");
const RoutingTable = @import("RoutingTable.zig");
const SessionStore = @import("SessionStore.zig");
const Sockets = @import("udp").Sockets;
const enr = @import("identity/enr.zig");
const types = @import("types.zig");
const support = @import("test_support.zig");
const keyPair = support.keyPair;
const endpoint = support.endpoint;
const address4 = support.address4;
const fakeRecord = support.fakeRecord;

pub const Pair = struct {
    io: std.Io,
    record_a: enr.Record,
    record_b: enr.Record,
    transport_a: Transport,
    transport_b: Transport,
    candidate_id: types.NodeId,

    pub fn init(self: *Pair, io: std.Io, request_timeout_ms: u64, install_session: bool) !void {
        self.io = io;
        const loopback = net.IpAddress{ .ip4 = .loopback(0) };
        self.transport_a.sockets = try Sockets.bind(io, .single(loopback));
        errdefer self.transport_a.sockets.close(io);
        self.transport_b.sockets = try Sockets.bind(io, .single(loopback));
        errdefer self.transport_b.sockets.close(io);

        const key_a = try keyPair(0x11);
        const key_b = try keyPair(0x22);
        self.record_a = try enr.Record.create(&key_a, 1, self.transport_a.localAddress());
        self.record_b = try enr.Record.create(&key_b, 1, self.transport_b.localAddress());
        const config = Engine.Config{
            .session_capacity = 4,
            .challenge_capacity = 4,
            .call_capacity = 4,
            .request_timeout_ms = request_timeout_ms,
            .challenge_timeout_ms = 1_000,
            .session_idle_timeout_ms = std.math.maxInt(u64),
        };
        try self.transport_a.init(std.testing.allocator, self.transport_a.sockets, key_a, self.record_a, config);
        errdefer self.transport_a.engine.deinit(std.testing.allocator);
        try self.transport_b.init(std.testing.allocator, self.transport_b.sockets, key_b, self.record_b, config);
        errdefer self.transport_b.engine.deinit(std.testing.allocator);

        if (install_session) {
            const peer_a = endpoint(&self.record_a);
            const peer_b = endpoint(&self.record_b);
            const session_key = [_]u8{0x55} ** 16;
            const active = SessionStore.Session{
                .read_key = session_key,
                .write_key = session_key,
            };
            self.transport_a.engine.channel.sessions.install(peer_b, &active, 0);
            self.transport_b.engine.channel.sessions.install(peer_a, &active, 0);
        }
    }

    pub fn deinit(self: *Pair) void {
        self.transport_b.deinit(std.testing.allocator, self.io);
        self.transport_a.deinit(std.testing.allocator, self.io);
    }

    pub fn fillBucket(self: *Pair) !void {
        const incumbent_peer = endpoint(&self.record_b);
        try std.testing.expect(types.logDistance(
            &self.record_a.node_id,
            &self.record_b.node_id,
        ) > 8);
        try std.testing.expectEqual(
            RoutingTable.PutResult.inserted,
            try self.transport_a.engine.confirmPeer(&incumbent_peer, &self.record_b, 0),
        );
        for (1..RoutingTable.bucket_size) |index| {
            const node_id = variantNodeId(self.record_b.node_id, @intCast(index));
            const address = address4(10, @intCast(index), 0, 1, @intCast(10_000 + index));
            var record = fakeRecord(node_id, address, 0);
            const peer = types.Endpoint{ .node_id = node_id, .address = address };
            try std.testing.expectEqual(
                RoutingTable.PutResult.inserted,
                try self.transport_a.engine.confirmPeer(&peer, &record, @intCast(index)),
            );
        }
        self.candidate_id = variantNodeId(self.record_b.node_id, RoutingTable.bucket_size);
        const candidate_address = address4(10, 200, 0, 1, 10_200);
        var candidate_record = fakeRecord(self.candidate_id, candidate_address, 0);
        const candidate_peer = types.Endpoint{
            .node_id = self.candidate_id,
            .address = candidate_address,
        };
        const pending = try self.transport_a.engine.confirmPeer(&candidate_peer, &candidate_record, 20);
        switch (pending) {
            .pending => |node_id| try std.testing.expectEqualSlices(
                u8,
                &self.record_b.node_id,
                &node_id,
            ),
            else => return error.TestUnexpectedResult,
        }
    }
};

fn variantNodeId(base: types.NodeId, salt: u8) types.NodeId {
    var result = base;
    result[31] ^= salt;
    return result;
}
