//! Native-owned command promises. Diagnostic result construction borrows the shared buffer until settlement finishes.
const network_metrics = @import("network_metrics.zig");
const decode = @import("network_js_input.zig");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const r = @import("network_runtime.zig");
const commands = @import("network_commands.zig");
const projection = @import("network_peer_projection.zig");
const js = @import("network_js.zig");
const Runtime = r.Runtime;
const capacity = @import("network_capacity.zig");
const capacity_js = @import("network_capacity_js.zig");
const cfg = @import("network_config.zig");
const application_cfg = @import("network_application_config.zig");
const network_gossip_diagnostics = @import("network_gossip_diagnostics.zig");

pub fn settle(env: napi.Env, runtime: *Runtime, token: commands.Token) !void {
    const cell = runtime.bridge.commands.get(token);
    if (cell.failure) |err| {
        try cell.promise.settle(env, .reject, try js.settled(env, js.errorValue(env, @errorName(err))));
    } else {
        const value = try result(env, runtime, token.index);
        try cell.promise.settle(env, .resolve, value);
    }
}

fn result(env: napi.Env, runtime: *Runtime, index: usize) !Value {
    const operation = &runtime.bridge.commands.cells[index];
    switch (operation.input) {
        .getMetrics => return network_metrics.value(runtime),
        .getGossipDiagnostics => return network_gossip_diagnostics.copy(env, &runtime.bridge.diagnostics.?.gossip),
        .getPeerScores => return peerScores(env, runtime),
        .removeDirectPeer => return env.getBoolean(operation.boolean),
        else => return env.getUndefined(),
    }
}

fn peerScores(env: napi.Env, runtime: *Runtime) !Value {
    const buffer = runtime.bridge.diagnostics.?;
    const object = try env.createObject();
    try object.setNamedProperty("observedMonoMs", try env.createBigintUint64(buffer.observed.millis()));
    try object.setNamedProperty("observedUnixMs", try env.createBigintInt64(buffer.observed.unixSeconds() *| 1000));
    const peers = try env.createArrayWithLength(buffer.count);
    for (buffer.scores[0..buffer.count], 0..) |*score, i| {
        const value = try env.createObject();
        try value.setNamedProperty("identity", try js.peerIdValue(env, &score.identity));
        try value.setNamedProperty("score", try env.createDouble(score.score));
        try value.setNamedProperty("gossipScore", try env.createDouble(score.gossip_score));
        try value.setNamedProperty("scoreAtMs", try env.createBigintUint64(score.score_at_ms));
        try peers.setElement(@intCast(i), value);
    }
    try object.setNamedProperty("peers", peers);
    return object;
}

/// The initial identity or the latest coalesced identity observation.
pub fn identity(env: napi.Env, value: *const r.Identity) !Value {
    const object = try env.createObject();
    try object.setNamedProperty("peerId", try js.peerIdValue(env, &value.peer));
    try object.setNamedProperty("metadata", try projection.metadata(env, &value.metadata));
    const endpoints = try env.createArrayWithLength(@intFromBool(value.endpoints[0] != null) + @as(u32, @intFromBool(value.endpoints[1] != null)));
    var endpoint_index: u32 = 0;
    for (value.endpoints) |address| if (address) |bound| {
        try endpoints.setElement(endpoint_index, try js.endpoint(env, bound));
        endpoint_index += 1;
    };
    try object.setNamedProperty("localEndpoints", endpoints);
    try object.setNamedProperty("localEndpoint", try js.endpoint(env, value.endpoints[0] orelse value.endpoints[1].?));
    try object.setNamedProperty("localMultiaddr", try js.bytes(env, value.multiaddr[0..value.multiaddr_len]));
    try object.setNamedProperty("localEnr", if (value.enr_len == 0) try env.getNull() else try js.bytes(env, value.enr[0..value.enr_len]));
    return object;
}

fn parseAddresses(value: Value, input: *commands.Dial) !void {
    input.address_count = @intCast(try decode.array(value, 2));
    if (input.address_count == 0) return error.InvalidNetworkConfig;
    for (input.addresses[0..input.address_count], 0..) |*address, i| {
        const parsed = try decode.endpoint(try value.getElement(@intCast(i)));
        address.* = switch (parsed) {
            .ip4 => |ip| .{ .ip4 = .{ .octets = ip.bytes, .port = ip.port } },
            .ip6 => |ip| .{ .ip6 = .{ .octets = ip.bytes, .port = ip.port } },
        };
        if (address.port() == 0) return error.InvalidNetworkConfig;
    }
}
pub fn submit(env: napi.Env, runtime: *Runtime, comptime command: commands.Command, args: []const Value) !Value {
    var blocked: capacity.Token = undefined;
    const token = runtime.reserveCommand(command, &blocked) catch |err| {
        if (err != error.NetworkCommandFull) return err;
        const value = try js.errorValue(env, @errorName(err));
        try capacity_js.attach(env, value, blocked);
        try env.throw(value);
        return error.PendingException;
    };
    errdefer runtime.retireCommand(token);
    const operation = &runtime.bridge.commands.cells[token.index];
    switch (command) {
        .applyIntent => try application_cfg.parseIntent(args[0], &operation.input.applyIntent),
        .updateStatus => try cfg.parseStatus(args[0], &operation.input.updateStatus),
        .getPeerScores, .getMetrics => {},
        .getGossipDiagnostics => operation.input.getGossipDiagnostics = @intCast(try decode.integer(args[0], 512)),
        .reStatusPeers => {
            const targets = &operation.input.reStatusPeers;
            targets.count = @intCast(try decode.array(args[0], targets.peers.len));
            for (targets.peers[0..targets.count], 0..) |*peer, i| {
                peer.* = try decode.peerIdFrom(try args[0].getElement(@intCast(i)));
                for (targets.peers[0..i]) |*prior| if (peer.eql(prior)) return error.InvalidNetworkConfig;
            }
        },
        .connect, .addDirectPeer => {
            const dial = &@field(operation.input, @tagName(command));
            dial.peer = try decode.peerIdFrom(args[0]);
            try parseAddresses(args[1], dial);
            if (command == .connect) {
                dial.timeout_ms = try decode.bigint(args[2]);
                if (dial.timeout_ms == 0 or dial.timeout_ms > 60_000) return error.InvalidNetworkInteger;
            }
        },
        .disconnect, .removeDirectPeer => @field(operation.input, @tagName(command)) = try decode.peerIdFrom(args[0]),
    }
    const promise = try operation.promise.init(env);
    try runtime.queueCommand(token);
    return promise;
}
