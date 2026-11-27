const n = @import("network");
const napi = @import("zapi:zapi").napi;
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const r = @import("network_runtime.zig");
const p = @import("network_publications.zig");
const g = @import("network_gossip_js.zig");
const clock = @import("network_gossip.zig");
const js = @import("network_js.zig");
const capacity = @import("network_capacity.zig");
const capacity_js = @import("network_capacity_js.zig");

fn rejectInput(env: napi.Env, err: anyerror) anyerror {
    const value = g.publishError(env, err) catch |failure| return failure;
    env.throw(value) catch |failure| return failure;
    return error.PendingException;
}
fn payloadLength(data: Value) !usize {
    const len = (try decode.byteView(data)).len;
    if (len > clock.payload_max) return error.PayloadTooLarge;
    return len;
}
/// Admits one publication and returns its Promise. A refusal leaves no cell.
pub fn publish(runtime: *r.Runtime, topic: Value, data: Value, options: Value) !Value {
    runtime.retain();
    defer runtime.release();
    var name: [n.gossipsub.topic.topic_max_len]u8 = undefined;
    const topic_len = try decode.text(topic, &name);
    const canonical = n.gossipsub.topic.parseCanonical(name[0..topic_len]) orelse return rejectInput(runtime.env, error.UnknownTopic);
    const publish_options = try g.optionsFor(options);
    const max_wait_ms = try queueTimeout(options);
    const len = payloadLength(data) catch |err| return rejectInput(runtime.env, err);
    const queued_ms = try clock.monotonic();
    var blocked: capacity.Token = undefined;
    const token = runtime.reservePublication(canonical.name.kind, len, &blocked) catch |err| {
        if (err != error.PublicationQueueFull and err != error.NetworkBridgeFull) return rejectInput(runtime.env, err);
        const value = try g.publishError(runtime.env, err);
        try capacity_js.attach(runtime.env, value, blocked);
        try runtime.env.throw(value);
        return error.PendingException;
    };
    errdefer runtime.retirePublication(token);
    const cell = runtime.bridge.publications.?.get(token).?;
    cell.topic_len = @intCast(topic_len);
    @memcpy(cell.topic[0..topic_len], name[0..topic_len]);
    cell.options = publish_options;
    const copy = try r.allocator.alloc(u8, len);
    errdefer r.allocator.free(copy);
    try decode.bytes(data, copy);
    const promise = try cell.promise.init(runtime.env);
    runtime.lock();
    defer runtime.unlock();
    if (runtime.bridge.stop or runtime.bridge.quiescent) return error.NetworkClosed;
    cell.order = try runtime.bridge.commands.nextOrder();
    cell.queued_ms = queued_ms;
    cell.max_wait_ms = max_wait_ms;
    cell.payload = copy;
    runtime.bridge.publications.?.transition(cell, .queued);
    runtime.bridge.publications.?.diag.copies +|= 1;
    runtime.bridge.publications.?.diag.bytesCopied +|= len;
    runtime.wakeOwnerLocked();
    return promise;
}

fn queueTimeout(options: Value) !?u64 {
    if (try options.typeof() == .undefined) return null;
    const value = try decode.get(options, "maxQueueMs");
    if (try value.typeof() == .undefined) return null;
    const ms = try decode.integer(value, 86_400_000);
    if (ms == 0) return error.InvalidPublicationQueueTimeout;
    return @intCast(ms);
}

pub fn watchCapacity(runtime: *r.Runtime, token: Value) !bool {
    return capacity_js.watch(runtime, token) catch |err| switch (err) {
        error.InvalidNetworkCapacityToken => error.InvalidPublicationCapacityToken,
        else => err,
    };
}

pub fn settle(env: napi.Env, cell: *p.Cell) !void {
    if (cell.failure) |err| {
        try cell.promise.settle(env, .reject, try js.settled(env, g.publishError(env, err)));
    } else try cell.promise.settle(env, .resolve, try g.publishResult(env, cell.outcome));
}
