const std = @import("std");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const r = @import("network_runtime.zig");
const incoming = @import("network_incoming.zig");
const Promise = @import("network_promise.zig");
const Runtime = r.Runtime;
const network_js = @import("network_js.zig");
const network = @import("network");

const bytes = network_js.bytes;
const errorValue = network_js.errorValue;
fn cellFor(runtime: *Runtime, token: incoming.Token) !*incoming.Cell {
    const table = if (runtime.bridge.incoming) |*table| table else return error.InvalidIncomingHandle;
    return table.get(token) orelse error.NetworkIncomingClosed;
}
fn wakeOwner(runtime: *Runtime) void {
    runtime.lock();
    runtime.wakeOwnerLocked();
    runtime.unlock();
}
/// A serving start's descriptor, whose stream the binding's record owns from here.
pub fn descriptorValue(runtime: *Runtime, token: incoming.Token, cell: *incoming.Cell) !Value {
    const env = runtime.env;
    const object = try env.createObject();
    try object.setNamedProperty("handle", try network_js.handle(env, token.index, token.generation));
    try object.setNamedProperty("peerId", try network_js.peerIdValue(env, &cell.identity));
    try object.setNamedProperty("connection", try network_js.connection(env, cell.connection));
    try object.setNamedProperty("protocol", try env.createStringUtf8(cell.protocol.id()));
    var destination: [*]u8 = undefined;
    const buffer = try env.createArrayBuffer(cell.input.len, &destination);
    const data = try env.createTypedarray(.uint8, cell.input.len, buffer, 0);
    @memcpy(destination[0..cell.input.len], cell.input);
    try object.setNamedProperty("data", data);
    try object.setNamedProperty("closed", try cell.closed_promise.init(env));
    return object;
}
fn contextFor(value: Value) !?network.types.ForkEntry {
    if (try value.typeof() == .null) return null;
    try decode.completeObject(value, &.{ "digest", "fork" });
    const digest = try decode.get(value, "digest");
    const fork = try decode.fork(try decode.get(value, "fork"));
    return .{ .digest = try decode.fixed(4, digest), .fork = fork };
}
fn viewLength(value: Value, max: usize) !usize {
    const len = (try decode.byteView(value)).len;
    if (len > max) return error.ChunkTooLarge;
    return len;
}
/// Copies a response chunk. Completion ends its borrow and reserves capacity for the next chunk.
pub fn respond(runtime: *Runtime, value: Value, data: Value, context_value: Value) !Value {
    const handle = try decode.handle(incoming.Token, value, incoming.capacity_max);
    const context = try contextFor(context_value);
    var promise: Promise = .{};
    const result = try promise.init(runtime.env);
    errdefer promise.deinit();
    runtime.retain();
    defer runtime.release();
    runtime.lock();
    const cell = cellFor(runtime, handle) catch |err| {
        runtime.unlock();
        return err;
    };
    if (runtime.bridge.stop or !cell.native or cell.action != .none) {
        const err = if (runtime.bridge.stop) error.NetworkClosed else error.NetworkIncomingClosed;
        runtime.unlock();
        return err;
    }
    if (cell.response_awaited or cell.permission_awaited or cell.state != .serving) {
        runtime.unlock();
        return error.NetworkIncomingBusy;
    }
    const len = viewLength(data, cell.protocol.info().response_max) catch |err| {
        runtime.unlock();
        if (err == error.ChunkTooLarge) return rejectInput(runtime.env, .chunk_too_large);
        return err;
    };
    runtime.bridge.incoming.?.reserveResponse(cell, len) catch |err| {
        runtime.bridge.incoming.?.diag.byteRefusals +|= 1;
        runtime.unlock();
        return err;
    };
    cell.state = .response_preparing;
    runtime.bridge.incoming.?.refresh(cell);
    runtime.unlock();
    errdefer {
        runtime.lock();
        cell.state = if (cell.native) .serving else .terminal;
        runtime.bridge.incoming.?.releasePayload(cell);
        runtime.bridge.incoming.?.refresh(cell);
        runtime.notifyIfReadyLocked();
        runtime.unlock();
    }
    const copy = try r.allocator.alloc(u8, len);
    errdefer r.allocator.free(copy);
    try decode.bytes(data, copy);
    runtime.lock();
    if (runtime.bridge.stop or !cell.native or cell.action != .none) {
        const err = if (runtime.bridge.stop) error.NetworkClosed else error.NetworkIncomingClosed;
        runtime.unlock();
        return err;
    }
    cell.response = copy;
    cell.context = context;
    cell.response_promise = promise;
    cell.response_awaited = true;
    cell.ack = null;
    cell.state = .response_queued;
    runtime.bridge.incoming.?.refresh(cell);
    runtime.bridge.incoming.?.diag.responseBytesCopied +|= len;
    runtime.unlock();
    wakeOwner(runtime);
    return result;
}
pub fn terminal(runtime: *Runtime, value: Value, action_value: Value, status_value: Value, message_value: Value) !void {
    const handle = try decode.handle(incoming.Token, value, incoming.capacity_max);
    const action: incoming.Action = switch (try decode.integer(action_value, 2)) {
        0 => .finish,
        1 => .fail,
        2 => .cancel,
        else => unreachable,
    };
    var status: u8 = 0;
    var message: [256]u8 = undefined;
    var len: usize = 0;
    if (action == .fail) {
        status = @intCast(decode.integer(status_value, 255) catch return rejectInput(runtime.env, .invalid_error));
        if (!network.reqresp.constants.isErrorResult(status)) return rejectInput(runtime.env, .invalid_error);
        len = viewLength(message_value, message.len) catch return rejectInput(runtime.env, .invalid_error);
        try decode.bytes(message_value, message[0..len]);
    }
    runtime.lock();
    const cell = cellFor(runtime, handle) catch |err| {
        runtime.unlock();
        return err;
    };
    if (cell.native) {
        if (action != .cancel and (cell.response_awaited or cell.permission_awaited or cell.state == .response_preparing)) {
            runtime.unlock();
            return error.NetworkIncomingBusy;
        }
        if (cell.action == .none or action == .cancel) {
            cell.action = action;
            cell.error_status = status;
            cell.error_len = @intCast(len);
            @memcpy(cell.error_message[0..len], message[0..len]);
            if (cell.state == .serving) runtime.bridge.incoming.?.releaseResponse(cell);
        }
    }
    runtime.unlock();
    wakeOwner(runtime);
}

/// Releases host retention; the owner returns the serving slot after stream retirement.
pub fn release(runtime: *Runtime, value: Value) !void {
    const handle = try decode.handle(incoming.Token, value, incoming.capacity_max);
    runtime.lock();
    defer runtime.unlock();
    const cell = try cellFor(runtime, handle);
    cell.release_requested = true;
    runtime.wakeOwnerLocked();
}

/// Reserves bridge capacity for the first maximum-sized chunk before the host produces it.
pub fn ready(runtime: *Runtime, value: Value) !Value {
    const handle = try decode.handle(incoming.Token, value, incoming.capacity_max);
    var promise: Promise = .{};
    const result = try promise.init(runtime.env);
    errdefer promise.deinit();
    runtime.lock();
    const cell = cellFor(runtime, handle) catch |err| {
        runtime.unlock();
        return err;
    };
    if (!cell.native or cell.action != .none or runtime.bridge.stop) {
        runtime.unlock();
        return error.NetworkIncomingClosed;
    }
    if (cell.permission_awaited or cell.response_awaited or cell.state != .serving) {
        runtime.unlock();
        return error.NetworkIncomingBusy;
    }
    cell.permission_promise = promise;
    cell.permission_awaited = true;
    cell.permission_ready = false;
    runtime.bridge.incoming.?.refresh(cell);
    runtime.unlock();
    wakeOwner(runtime);
    return result;
}
fn ackError(env: napi.Env, ack: incoming.Ack) !Value {
    switch (ack) {
        .sent => unreachable,
        .closed => return errorValue(env, "NetworkClosed"),
        .failed => |reason| {
            const object = try errorValue(env, "NetworkIncomingFailed");
            try object.setNamedProperty("failure", try env.createStringUtf8(@tagName(reason)));
            return object;
        },
        .rejected => |reason| {
            const object = try errorValue(env, "NetworkIncomingRejected");
            try object.setNamedProperty("reason", try env.createStringUtf8(@tagName(reason)));
            return object;
        },
    }
}
pub fn settle(env: napi.Env, runtime: *Runtime, delivered: incoming.Completion) !void {
    const cell = runtime.bridge.incoming.?.get(delivered.token).?;
    // Commit may let the owner retire this cell after a stopped settlement. Delete these references on the JS thread.
    defer {
        if (delivered.ack != null) cell.response_promise.deinit();
        if (delivered.closed) cell.closed_promise.deinit();
        if (delivered.permission != null) cell.permission_promise.deinit();
    }
    if (delivered.ack) |ack| {
        if (ack == .sent)
            try cell.response_promise.settle(env, .resolve, try env.getUndefined())
        else
            try cell.response_promise.settle(env, .reject, try network_js.settled(env, ackError(env, ack)));
    }
    if (delivered.closed) try cell.closed_promise.settle(env, .resolve, try env.getUndefined());
    if (delivered.permission) |permitted| {
        if (permitted)
            try cell.permission_promise.settle(env, .resolve, try env.getUndefined())
        else
            try cell.permission_promise.settle(env, .reject, try network_js.settled(env, errorValue(env, "NetworkIncomingClosed")));
    }
}

fn rejectInput(env: napi.Env, reason: incoming.Rejection) anyerror {
    const value = ackError(env, .{ .rejected = reason }) catch |err| return err;
    env.throw(value) catch |err| return err;
    return error.PendingException;
}
