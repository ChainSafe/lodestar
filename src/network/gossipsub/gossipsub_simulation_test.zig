const gossip_test = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const SessionRef = @import("sessions.zig").SessionRef;
const Now = @import("../types.zig").Now;
const name = "/eth2/01020304/beacon_block/ssz_snappy";
const turn_mod = @import("turn.zig");

const Node = struct {
    core: Gossipsub,
    session: SessionRef,

    fn init(identity: u8, seed: u64) !Node {
        var core = try gossip_test.init(std.testing.allocator, .{
            .random_seed = seed,
            .connected_capacity = 2,
            .retained_capacity = 9,
            .retained_outbound_reserve = 1,
            .mcache_capacity = 16,
            .seen_capacity = 64,
            .validation_capacity = 8,
            .heartbeat_interval_ms = 100,
        });
        errdefer core.deinit();
        try gossip_test.subscribe(&core, name);
        const session = core.addPeer(.{ .index = 0, .generation = 1 }, &.{
            .identity = .{ .bytes = @splat(identity) },
            .address = .unspecified,
            .direction = .outbound,
        }, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 })).admitted;
        core.sessions.setOutbound(session.index, .{ .live = .{ .stream = .{ .conn = .{ .index = 0, .generation = 1 }, .id = 0, .slot = 0 }, .version = .v1_2 } });
        core.sessions.rows[session.index].in_stream = .{ .conn = .{ .index = 0, .generation = 1 }, .id = 1, .slot = 1 };
        core.sessions.rows[session.index].io.rx_ready = true;
        core.sendSubscriptions(session.index);
        return .{ .core = core, .session = session };
    }

    fn begin(self: *Node, now: Now) !void {
        _ = Gossipsub.beginPump(&self.core, now);
        _ = self.core.tick(now);
    }
};

test "gossip simulation ignores decoded items and write receipts from a retired session" {
    var node = try Node.init(2, 1);
    defer node.core.deinit();
    const old = node.session;
    node.core.connectionClosed(node.core.sessions.rows[old.index].conn);
    node.session = node.core.addPeer(.{ .index = 0, .generation = 2 }, &.{ .identity = .{ .bytes = @splat(2) }, .address = .unspecified, .direction = .outbound }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })).admitted;
    try std.testing.expect(old.generation != node.session.generation);
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 });
    try node.begin(now);
    var turn = Gossipsub.beginPump(&node.core, now);
    var peer = turn_mod.Credits.peer(&node.core.options);
    try std.testing.expectEqual(.done, node.core.receiveItem(old, .{ .subscription = .{ .topic = name, .subscribe = true } }, &turn, &peer));
    node.core.writeCompleted(old, .{ .control = .{ .token = 1 } }, now.millis());
    try std.testing.expectEqual(@as(usize, 0), node.core.resourceSnapshot().remote_subscriptions);
}
