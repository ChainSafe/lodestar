const std = @import("std");
const n = @import("network");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const r = @import("network_runtime.zig");
const g = @import("network_gossip.zig");

pub fn capacity(value: Value) !?r.Capacity {
    if (try value.typeof() == .null) return null;
    try decode.object(value, &.{"gossipValidation"});
    return .{
        .gossip_validation = try name(@FieldType(r.Capacity, "gossip_validation"), try decode.get(value, "gossipValidation"), error.InvalidNetworkConfig),
    };
}
pub fn peerReport(peer: Value, action: Value, context: Value) !n.peers.types.PeerReport {
    return .{
        .identity = try decode.peerIdFrom(peer),
        .action = try name(n.peers.types.PeerAction, action, error.InvalidNetworkAction),
        .origin = try reportOrigin(context),
        .reason = try reportReason(context),
    };
}

pub fn name(comptime T: type, value: Value, invalid: anyerror) !T {
    var text: [32]u8 = undefined;
    const len = decode.text(value, &text) catch return invalid;
    return std.meta.stringToEnum(T, text[0..len]) orelse invalid;
}

pub fn handle(value: Value) !g.Token {
    if (try value.typeof() != .object) return error.InvalidGossipHandle;
    const index = try decode.integer(try decode.get(value, "index"), n.gossip_processor.limits.capacity_max - 1);
    const generation = try decode.bigint(try decode.get(value, "generation"));
    if (generation == 0) return error.InvalidGossipHandle;
    return .{ .index = @intCast(index), .generation = generation };
}

fn reportOrigin(context: Value) !?n.types.PeerOrigin {
    if (try context.typeof() == .undefined) return null;
    try decode.object(context, &.{ "origin", "reason" });
    const origin = try decode.get(context, "origin");
    if (try origin.typeof() == .undefined or try origin.typeof() == .null) return null;
    try decode.object(origin, &.{ "connection", "endpoint" });
    const connection = try decode.get(origin, "connection");
    try decode.object(connection, &.{ "index", "generation" });
    const generation = try decode.integer(try decode.get(connection, "generation"), std.math.maxInt(u32));
    const endpoint = try decode.get(origin, "endpoint");
    return .{
        .connection = .{
            .index = @intCast(try decode.integer(try decode.get(connection, "index"), std.math.maxInt(u16))),
            .generation = @intCast(generation),
        },
        .endpoint = if (try endpoint.typeof() == .null) null else n.Address.fromNetwork(try decode.endpoint(endpoint)),
    };
}

fn reportReason(context: Value) !n.peers.types.PeerReport.Reason {
    if (try context.typeof() == .undefined) return .host;
    const value = try decode.get(context, "reason");
    if (try value.typeof() == .undefined) return .host;
    return name(n.peers.types.PeerReport.Reason, value, error.InvalidNetworkAction);
}
