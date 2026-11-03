const std = @import("std");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const n = @import("network");
const r = @import("network_runtime.zig");
const requests = @import("network_requests.zig");
const Promise = @import("network_promise.zig");
const Runtime = r.Runtime;
const network_js = @import("network_js.zig");
const capacity = @import("network_capacity.zig");
const capacity_js = @import("network_capacity_js.zig");

const bytes = network_js.bytes;
const errorValue = network_js.errorValue;
fn optionsFor(value: Value) !n.reqresp.ReqResp.RequestOptions {
    var result_options: n.reqresp.ReqResp.RequestOptions = .{};
    if (try value.typeof() == .undefined) return result_options;
    try decode.object(value, &.{ "expectedChunks", "negotiationTimeoutMs", "requestTimeoutMs", "responseTimeoutMs" });
    const expected = try decode.get(value, "expectedChunks");
    if (try expected.typeof() != .undefined) result_options.expected_chunks = @intCast(try decode.integer(expected, std.math.maxInt(u32)));
    inline for (.{ .{ "negotiationTimeoutMs", "negotiation" }, .{ "requestTimeoutMs", "request" }, .{ "responseTimeoutMs", "response" } }) |names| {
        const duration = try decode.get(value, names[0]);
        if (try duration.typeof() != .undefined) {
            const ms = try decode.integer(duration, 60000);
            if (ms == 0) return error.InvalidNetworkInteger;
            @field(result_options.timeouts, names[1]) = .fromMilliseconds(@intCast(ms));
        }
    }
    return result_options;
}
pub fn start(runtime: *Runtime, peer: Value, protocol: Value, data: Value, options: Value) !Value {
    runtime.retain();
    defer runtime.release();
    var protocol_buffer: [128]u8 = undefined;
    const protocol_len = try decode.text(protocol, &protocol_buffer);
    const which = n.reqresp.Protocol.fromId(protocol_buffer[0..protocol_len]) orelse return error.UnknownProtocol;
    if (!n.reqresp.Protocol.Set.application.contains(which)) return error.ProtocolDisabled;
    const request_options = try optionsFor(options);
    const identity = try decode.peerIdFrom(peer);
    const len = (try decode.byteView(data)).len;
    if (len < which.info().request_min) return error.RequestTooSmall;
    if (len > which.info().request_max) return error.RequestTooLarge;
    runtime.lock();
    if (runtime.bridge.stop or runtime.bridge.quiescent) {
        runtime.unlock();
        return error.NetworkClosed;
    }
    const token = runtime.bridge.requests.?.reserve(which, len) catch |err| {
        runtime.refreshBridgeCapacityLocked();
        const blocked = runtime.bridge.admission_capacity.token(if (err == error.NetworkRequestFull) .bridge_slots else .bridge_bytes);
        runtime.unlock();
        if (err == error.NetworkRequestFull or err == error.NetworkBridgeFull) return rejectAdmission(runtime.env, blocked);
        return err;
    };
    runtime.retain();
    runtime.unlock();
    errdefer {
        runtime.retireRequest(token);
        runtime.lock();
        runtime.retireRequestStorageLocked();
        runtime.unlock();
    }
    try runtime.bridge.requests.?.allocate(token, len);
    const cell = runtime.bridge.requests.?.get(token).?;
    cell.peer = identity;
    cell.options = request_options;
    const value = try runtime.env.createObject();
    try value.setNamedProperty("handle", try network_js.handle(runtime.env, token.index, token.generation));
    try value.setNamedProperty("closed", try cell.closed_promise.init(runtime.env));
    try decode.bytes(data, cell.input);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop or runtime.bridge.quiescent) return error.NetworkClosed;
    cell.order = try runtime.bridge.commands.nextOrder();
    cell.state = .queued;
    runtime.bridge.requests.?.refresh(cell);
    runtime.wakeOwnerLocked();
    return value;
}
fn capacityError(env: napi.Env, token: capacity.Token) !Value {
    const value = try errorValue(env, "NetworkRequestRejected");
    try value.setNamedProperty("reason", try env.createStringUtf8("local_capacity"));
    try capacity_js.attach(env, value, token);
    return value;
}
fn rejectAdmission(env: napi.Env, token: capacity.Token) anyerror {
    const value = capacityError(env, token) catch |err| return err;
    env.throw(value) catch |err| return err;
    return error.PendingException;
}
pub fn watchCapacity(runtime: *Runtime, value: Value) !bool {
    return capacity_js.watch(runtime, value) catch |err| switch (err) {
        error.InvalidNetworkCapacityToken => error.InvalidRequestCapacityToken,
        else => err,
    };
}
/// Arms a pull, whose chunk or terminal outcome an exchange delivers. The iterator allows one pull at a time, so a
/// second one breaks its contract.
pub fn pull(runtime: *Runtime, handle: Value) !Value {
    const token = try decode.handle(requests.Token, handle, requests.capacity_max);
    var promise: Promise = .{};
    const value = try promise.init(runtime.env);
    errdefer promise.deinit();
    runtime.lock();
    const cell = runtime.bridge.requests.?.get(token) orelse {
        runtime.unlock();
        return error.InvalidRequestHandle;
    };
    if (cell.pulling) {
        runtime.unlock();
        return error.NetworkRequestBusy;
    }
    cell.pull_promise = promise;
    requests.armPull(runtime, cell);
    runtime.unlock();
    return value;
}
/// Cancels and retires the request. Its terminal completion ends a retirement the iterator awaits, one not
/// `abandoned`; a stale handle's request already retired.
pub fn retire(runtime: *Runtime, handle: Value, abandoned: bool) !void {
    const token = try decode.handle(requests.Token, handle, requests.capacity_max);
    runtime.lock();
    const cell = runtime.bridge.requests.?.get(token) orelse {
        runtime.unlock();
        return;
    };
    requests.armRetirement(runtime, cell, !abandoned);
    runtime.unlock();
}
fn terminalError(env: napi.Env, terminal: requests.Terminal, cell: *const requests.Cell) !Value {
    switch (terminal) {
        .closed => return errorValue(env, "NetworkClosed"),
        .local_capacity => |token| return capacityError(env, token),
        .rejected => |reason| {
            const object = try errorValue(env, "NetworkRequestRejected");
            try object.setNamedProperty("reason", try env.createStringUtf8(@tagName(reason)));
            return object;
        },
        .failed => |failure| {
            const object = try errorValue(env, "NetworkRequestFailed");
            try object.setNamedProperty("reason", try env.createStringUtf8(@tagName(failure.reason)));
            try object.setNamedProperty("phase", if (failure.phase) |phase| try env.createStringUtf8(@tagName(phase)) else try env.getNull());
            try object.setNamedProperty("origin", try network_js.peerOrigin(env, failure.origin));
            try object.setNamedProperty("peerFault", if (failure.peer_fault) |fault| try env.createStringUtf8(@tagName(fault)) else try env.getNull());
            const detail: ?[]const u8 = switch (failure.reason) {
                .invalid_response => |err| @errorName(err),
                .negotiation_failed => |err| @tagName(err),
                else => null,
            };
            try object.setNamedProperty("detail", if (detail) |text| try env.createStringUtf8(text) else try env.getNull());
            try object.setNamedProperty("context", if (failure.reason == .unknown_context) try bytes(env, &failure.reason.unknown_context) else try env.getNull());
            try object.setNamedProperty("peerStatus", if (failure.reason == .peer_error) try env.createUint32(failure.reason.peer_error.code) else try env.getNull());
            try object.setNamedProperty("peerMessage", if (failure.reason == .peer_error) try bytes(env, cell.peer_message[0..cell.peer_message_len]) else try env.getNull());
            return object;
        },
        .done => unreachable,
    }
}
pub fn settle(env: napi.Env, runtime: *Runtime, delivered: requests.Completion) !void {
    const cell = &runtime.bridge.requests.?.cells[delivered.token.index];
    switch (delivered.value) {
        .chunk => |chunk| {
            const value = try env.createObject();
            var destination: [*]u8 = undefined;
            const buffer = try env.createArrayBuffer(chunk.len, &destination);
            @memcpy(destination[0..chunk.len], cell.sink[0..chunk.len]);
            try value.setNamedProperty("data", try env.createTypedarray(.uint8, chunk.len, buffer, 0));
            try value.setNamedProperty("fork", if (requests.forkLabel(chunk.fork)) |fork| try env.createStringUtf8(fork) else try env.getNull());
            try value.setNamedProperty("protocol", try env.createStringUtf8(cell.protocol.id()));
            try value.setNamedProperty("origin", try network_js.peerOrigin(env, chunk.origin));
            const result = try env.createObject();
            try result.setNamedProperty("done", try env.getBoolean(false));
            try result.setNamedProperty("value", value);
            try cell.pull_promise.settle(env, .resolve, result);
        },
        .terminal => |terminal| {
            const err = if (terminal == .done) null else try network_js.settled(env, terminalError(env, terminal, cell));
            if (cell.pull_promise.resolvers != null) {
                if (err) |failure| {
                    try cell.pull_promise.settle(env, .reject, failure);
                } else {
                    const result = try env.createObject();
                    try result.setNamedProperty("done", try env.getBoolean(true));
                    try result.setNamedProperty("value", try env.getUndefined());
                    try cell.pull_promise.settle(env, .resolve, result);
                }
            }
            try cell.closed_promise.settle(env, .resolve, err orelse try env.getNull());
        },
    }
}
