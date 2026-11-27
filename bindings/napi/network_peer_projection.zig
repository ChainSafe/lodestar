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

test {
    _ = @import("network_peer_projection_test.zig");
}
