const std = @import("std");
const n = @import("network");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const t = n.peers.types;
const network_js = @import("network_js.zig");
pub const Entry = t.Event;
pub const Lane = struct {
    entries: [64]Entry = undefined,
    head: u8 = 0,
    len: u8 = 0,
    pub fn publish(self: *Lane, events: []const t.Event) void {
        std.debug.assert(events.len <= 64 - @as(usize, self.len));
        for (events) |event| {
            self.entries[(@as(usize, self.head) + self.len) % 64] = event;
            self.len += 1;
        }
    }
    pub fn peek(self: *const Lane, out: []Entry) usize {
        const count = @min(out.len, self.len);
        for (0..count) |i| out[i] = self.entries[(@as(usize, self.head) + i) % 64];
        return count;
    }
    pub fn commit(self: *Lane, count: usize) void {
        std.debug.assert(count <= self.len);
        self.head = @intCast((@as(usize, self.head) + count) % 64);
        self.len -= @intCast(count);
    }
};
const bytes = @import("network_js.zig").bytes;
const endpoint = @import("network_js.zig").endpoint;
fn groups(env: napi.Env, set: ?n.peers.custody.Groups) !Value {
    const value = set orelse return env.getNull();
    const array = try env.createArrayWithLength(value.count());
    var count: usize = 0;
    for (0..128) |i| if (value.isSet(i)) {
        try array.setElement(@intCast(count), try env.createUint32(@intCast(i)));
        count += 1;
    };
    return array;
}
fn status(env: napi.Env, value: *const t.Status) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("forkDigest", try bytes(env, &value.fork_digest));
    try object.setNamedProperty("finalizedRoot", try bytes(env, &value.finalized_root));
    try object.setNamedProperty("headRoot", try bytes(env, &value.head_root));
    try object.setNamedProperty("finalizedEpoch", try env.createBigintUint64(value.finalized_epoch));
    try object.setNamedProperty("headSlot", try env.createBigintUint64(value.head_slot));
    try object.setNamedProperty("earliestAvailableSlot", if (value.earliest_available_slot) |slot| try env.createBigintUint64(slot) else try env.getNull());
    return object;
}
pub fn metadata(env: napi.Env, value: *const t.Metadata) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("sequenceNumber", try env.createBigintUint64(value.seq_number));
    try object.setNamedProperty("attnets", try bytes(env, &value.attnets));
    try object.setNamedProperty("syncnets", try env.createUint32(value.syncnets));
    try object.setNamedProperty("custodyGroupCount", if (value.custody_group_count) |count| try env.createBigintUint64(count) else try env.getNull());
    return object;
}
fn identify(env: napi.Env, value: *const n.identify.Metadata) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("agent", if (value.agent) |*agent| try env.createStringUtf8(agent.slice()) else try env.getNull());
    try object.setNamedProperty("protocolVersion", if (value.protocol_version) |*version| try env.createStringUtf8(version.slice()) else try env.getNull());
    const protocols = try env.createArrayWithLength(value.protocols.count());
    var index: usize = 0;
    var supported = value.protocols.iterator();
    while (supported.next()) |protocol| {
        try protocols.setElement(@intCast(index), try env.createStringUtf8(protocol.id()));
        index += 1;
    }
    try object.setNamedProperty("protocols", protocols);
    return object;
}
pub fn state(env: napi.Env, value: *const t.Snapshot) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("identity", try network_js.peerIdValue(env, &value.identity));
    try object.setNamedProperty("connection", if (value.connection) |handle| try network_js.connection(env, handle) else try env.getNull());
    try object.setNamedProperty("direction", try env.createStringUtf8(@tagName(value.direction)));
    try object.setNamedProperty("endpoint", try endpoint(env, value.endpoint));
    try object.setNamedProperty("relevant", try env.getBoolean(value.relevant));
    try object.setNamedProperty("disconnectReason", if (value.disconnect_reason) |reason| try env.createStringUtf8(@tagName(reason)) else try env.getNull());
    try object.setNamedProperty("status", if (value.status) |*v| try status(env, v) else try env.getNull());
    try object.setNamedProperty("metadata", if (value.metadata) |*v| try metadata(env, v) else try env.getNull());
    try object.setNamedProperty("identify", if (value.identify) |*v| try identify(env, v) else try env.getNull());
    try object.setNamedProperty("custodyGroups", try groups(env, value.custody_groups));
    try object.setNamedProperty("samplingGroups", try groups(env, value.sampling_groups));
    try object.setNamedProperty("direct", try env.getBoolean(value.direct));
    try object.setNamedProperty("score", try env.createDouble(value.score));
    try object.setNamedProperty("scoreAtMs", try env.createBigintUint64(value.score_at_ms));
    inline for (.{ .{ "statusAtMs", "status_at_ms" }, .{ "metadataAtMs", "metadata_at_ms" }, .{ "connectedAtMs", "connected_at_ms" }, .{ "banUntilMs", "ban_until_ms" }, .{ "goodbyeUntilMs", "goodbye_until_ms" }, .{ "redialUntilMs", "redial_until_ms" } }) |pair|
        try object.setNamedProperty(pair[0], try env.createBigintUint64(@field(value, pair[1])));
    return object;
}
pub fn observation(env: napi.Env, entry: *const Entry) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("type", try env.createStringUtf8(@tagName(entry.*)));
    switch (entry.*) {
        .ready, .updated => |*value| try object.setNamedProperty("state", try state(env, value)),
        .closed => |value| {
            try object.setNamedProperty("connection", try network_js.connection(env, value.connection));
            try object.setNamedProperty("identity", try network_js.peerIdValue(env, &value.identity));
            try object.setNamedProperty("reason", try env.createStringUtf8(@tagName(value.reason)));
        },
    }
    return object;
}

test "production peer lane preserves closed generations at capacity" {
    var lane: Lane = .{};
    var events: [64]t.Event = undefined;
    const peer: n.PeerId = .{ .bytes = @splat(0) };
    for (&events, 0..) |*event, i| event.* = .{ .closed = .{ .peer = .{ .index = @intCast(i), .generation = std.math.maxInt(u64) - i }, .connection = .{ .index = @intCast(i), .generation = std.math.maxInt(u32) }, .identity = peer, .reason = .host } };
    lane.publish(&events);
    try std.testing.expectEqual(@as(u8, 64), lane.len);
    var copied: [64]Entry = undefined;
    try std.testing.expectEqual(@as(usize, 64), lane.peek(&copied));
    for (copied, 0..) |entry, i| {
        try std.testing.expectEqual(std.math.maxInt(u64) - i, entry.closed.peer.generation);
        try std.testing.expectEqual(std.math.maxInt(u32), entry.closed.connection.generation);
    }
    lane.commit(32);
    lane.publish(events[0..32]);
    try std.testing.expectEqual(@as(usize, 64), lane.peek(&copied));
    try std.testing.expectEqual(@as(u16, 32), copied[0].closed.peer.index);
    try std.testing.expectEqual(@as(u16, 0), copied[32].closed.peer.index);
}

test "full production lane leaves catalog close pending until output resumes" {
    var catalog = try n.peers.Catalog.init(std.testing.allocator, .{ .capacity = 2, .outbound_reserve = 0, .target_peers = 1, .max_peers = 2, .min_outbound = 0 }, 1024, 0);
    defer catalog.deinit(std.testing.allocator);
    const local_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    const remote_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{2}));
    const local = n.PeerId.fromPublicKey(&local_key.publicKey());
    const remote = n.PeerId.fromPublicKey(&remote_key.publicKey());
    const handle: t.Handle = .{ .index = 0, .generation = 7 };
    const peer = catalog.admit(&remote, &local, handle, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 0 }).admitted.peer;
    var lane: Lane = .{};
    var output: [64]t.Event = undefined;
    for (0..64) |i| {
        try std.testing.expect(catalog.updateStatus(peer, handle, &.{ .head_slot = i }, i));
        const count = catalog.pollEvents(output[0 .. 64 - lane.len]);
        try std.testing.expectEqual(@as(usize, 1), count);
        lane.publish(output[0..count]);
    }
    try std.testing.expect(catalog.disconnect(peer, handle, .host, .{}, n.Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), catalog.pollEvents(output[0 .. 64 - lane.len]));
    try std.testing.expect(catalog.eventsPending());
    lane.commit(64);
    const count = catalog.pollEvents(&output);
    try std.testing.expectEqual(@as(usize, 1), count);
    lane.publish(output[0..count]);
    var copied: [1]Entry = undefined;
    _ = lane.peek(&copied);
    try std.testing.expectEqual(handle, copied[0].closed.connection);
    try std.testing.expectEqual(peer, copied[0].closed.peer);
}
