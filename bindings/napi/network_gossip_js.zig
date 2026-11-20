const std = @import("std");
const n = @import("network");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const r = @import("network_runtime.zig");
const g = @import("network_gossip.zig");
const Runtime = r.Runtime;
const network_js = @import("network_js.zig");

const bytes = @import("network_js.zig").bytes;
pub fn descriptor(runtime: *Runtime, token: g.Token, cell: *const g.Cell) !Value {
    const env = runtime.env;
    const object = try env.createObject();
    try object.setNamedProperty("handle", try network_js.handle(env, token.index, token.generation));
    try object.setNamedProperty("connection", try network_js.connection(env, cell.connection));
    try object.setNamedProperty("endpoint", if (cell.endpoint) |endpoint| try network_js.endpoint(env, endpoint) else try env.getNull());
    try object.setNamedProperty("peerId", try network_js.peerIdValue(env, &cell.identity));
    try object.setNamedProperty("topic", try env.createStringUtf8(cell.topic[0..cell.topic_len]));
    try object.setNamedProperty("id", try bytes(env, &cell.id));
    var destination: [*]u8 = undefined;
    const buffer = try env.createArrayBuffer(cell.input.len, &destination);
    const data = try env.createTypedarray(.uint8, cell.input.len, buffer, 0);
    runtime.bridge.gossip.?.copyPayload(cell, destination[0..cell.input.len]);
    try object.setNamedProperty("data", data);
    var encoded: [172]u8 = undefined;
    try object.setNamedProperty("attestationData", if (cell.metadata.group) |group| try env.createStringUtf8(std.base64.standard.Encoder.encode(&encoded, &group)) else try env.getNull());
    try object.setNamedProperty("slot", if (cell.metadata.slot) |slot| try env.createBigintUint64(slot) else try env.getNull());
    try object.setNamedProperty("receivedAtUnixMs", try env.createDouble(@floatFromInt(cell.received_at)));
    return object;
}
pub fn optionsFor(value: Value) !n.gossipsub.Gossipsub.PublishOptions {
    var result: n.gossipsub.Gossipsub.PublishOptions = .{};
    if (try value.typeof() == .undefined) return result;
    try decode.object(value, &.{ "allowZeroPeers", "ignoreDuplicate", "flood", "maxQueueMs" });
    inline for (.{ .{ "allowZeroPeers", "allow_zero_peers" }, .{ "ignoreDuplicate", "ignore_duplicate" }, .{ "flood", "flood" } }) |field| {
        const option = try decode.get(value, field[0]);
        if (try option.typeof() != .undefined) @field(result, field[1]) = try decode.boolean(option);
    }
    return result;
}
pub fn publishResult(env: napi.Env, result: n.gossipsub.Gossipsub.PublishOutcome) !Value {
    const object = try env.createObject();
    inline for (.{ "queued", "pressured", "selected", "unavailable" }) |name| try object.setNamedProperty(name, try env.createUint32(@field(result, name)));
    try object.setNamedProperty("duplicate", try env.getBoolean(result.duplicate));
    return object;
}
pub fn publishError(env: napi.Env, err: anyerror) !Value {
    const reason: ?[]const u8 = switch (err) {
        error.UnknownTopic => "unknown_topic",
        error.PayloadTooSmall => "payload_too_small",
        error.PayloadTooLarge => "payload_too_large",
        error.CompressFailed => "compress_failed",
        error.PublicationQueueFull, error.NetworkBridgeFull => "admission_full",
        error.ResourceExhausted => "resource_exhausted",
        error.PublicationExpired => "expired",
        error.Duplicate => "duplicate",
        error.NoPeersSubscribedToTopic => "no_peers_subscribed_to_topic",
        else => null,
    };
    const object = try network_js.errorValue(env, if (reason != null) "NetworkGossipPublishFailed" else @errorName(err));
    if (reason) |text| try object.setNamedProperty("reason", try env.createStringUtf8(text));
    return object;
}
