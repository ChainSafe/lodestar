//! Bounded payload delivery and native Promise settlement on the JavaScript thread. Copying cells stay pinned
//! until commit or terminal teardown. Checking readiness and arming notifications under the mutex prevents lost wakes.
const std = @import("std");
const n = @import("network");
const r = @import("network_runtime.zig");
const g = @import("network_gossip.zig");
const incoming = @import("network_incoming.zig");
const projection = @import("network_peer_projection.zig");
const publications = @import("network_publications.zig");
const commands = @import("network_commands.zig");
const requests = @import("network_requests.zig");
const Runtime = r.Runtime;

pub const peers_max = 32;
pub const serving_max = 8;
pub const completion_max = 32;
pub const bytes_max = 8 * 1024 * 1024;

const CheckView = struct { kind: n.gossip_processor.limits.Kind, payload_present: bool, parent_hash: ?[32]u8, root: [32]u8, slot: u64, identity: n.PeerId, topic: [g.topic_max]u8, topic_len: u16 };

/// What one exchange pinned. Pinned cells stay in place: the owner never retires a copying cell.
pub const Selection = struct {
    admission_capacity_changed: bool = false,
    identity: ?r.Identity = null,
    peers: [peers_max]projection.Entry = undefined,
    peer_count: usize = 0,
    serving: [serving_max]incoming.Token = undefined,
    serving_count: usize = 0,
    checks: g.Batch = .{},
    views: [g.batch_max]CheckView = undefined,
    gossip: ?g.Batch = null,
    /// The owner has work from this exchange.
    wake: bool = false,
};

/// Scheduling after settlement and delivery.
pub const Outcome = struct { needs_another_exchange: bool = false };

/// How a failed build or finish ends: JavaScript that cannot run shuts the runtime down locally, and anything else
/// breaks the bridge contract and terminates the process. No allocation of ours can fail there.
pub const Failure = enum { stopped, contract };

fn selectLocked(runtime: *Runtime, now: u64, selection: *Selection) void {
    selection.admission_capacity_changed = runtime.bridge.admission_capacity.pending;
    runtime.bridge.admission_capacity.pending = false;
    if (runtime.deliverableLocked(.identity)) {
        selection.identity = runtime.bridge.identity;
        runtime.bridge.identity = null;
    }
    if (runtime.deliverableLocked(.peers)) selection.peer_count = runtime.bridge.peer_updates.?.peek(&selection.peers);
    const capacity = runtime.bridge.capacity orelse return;
    if (runtime.deliverableLocked(.serving)) selectServing(runtime, serving_max, selection);
    if (runtime.deliverableLocked(.checks)) {
        const table = &runtime.bridge.gossip.?;
        selection.checks = table.claimChecks(now, g.batch_max);
        for (selection.checks.tokens[0..selection.checks.len], selection.views[0..selection.checks.len]) |token, *view| {
            const cell = table.get(token).?;
            view.* = .{ .kind = cell.kind, .payload_present = cell.metadata.payload_present, .parent_hash = cell.metadata.parent_hash, .root = cell.metadata.root.?, .slot = cell.metadata.slot.?, .identity = cell.identity, .topic = cell.topic, .topic_len = cell.topic_len };
        }
    }
    if (runtime.deliverableLocked(.gossip)) {
        const claim = runtime.bridge.gossip.?.claimDemand(now, .{
            .items = g.batch_max,
            .bytes = bytes_max,
            .ordinary = capacity.gossip_validation == .ready,
        });
        if (claim.len > 0) selection.gossip = claim;
    }
}

/// Each cell is retired after its own settlement, including on a stopped environment. A later delivery failure
/// cannot replay an earlier settlement. The copying state keeps shutdown from freeing borrowed result storage.
fn settleOperations(runtime: *Runtime, host: anytype) !void {
    if (runtime.bridge.publications) |*table| for (0..completion_max) |_| {
        runtime.lock();
        const index = table.nextTerminal(table.completion_cursor) orelse table.nextTerminal(0) orelse {
            runtime.unlock();
            break;
        };
        table.completion_cursor = index + 1;
        const cell = &table.cells[index];
        const token: publications.Token = .{ .index = @intCast(index), .generation = cell.generation };
        table.transition(cell, .copying);
        runtime.unlock();
        defer runtime.retirePublication(token);
        try host.settlePublication(token);
    };
    const table = &runtime.bridge.commands;
    for (0..@min(completion_max, commands.capacity)) |_| {
        runtime.lock();
        const index = table.nextTerminal(table.completion_cursor) orelse table.nextTerminal(0) orelse {
            runtime.unlock();
            break;
        };
        table.completion_cursor = index + 1;
        const cell = &table.cells[index];
        const token: commands.Token = .{ .index = @intCast(index), .generation = cell.generation };
        table.transition(cell, .copying);
        runtime.unlock();
        defer runtime.retireCommand(token);
        try host.settleCommand(token);
    }
}

fn selectServing(runtime: *Runtime, serving_starts: u8, selection: *Selection) void {
    const table = &runtime.bridge.incoming.?;
    for (0..incoming.capacity_max) |_| {
        if (selection.serving_count == serving_starts) break;
        const token = table.pinStart() orelse break;
        selection.serving[selection.serving_count] = token;
        selection.serving_count += 1;
    }
}

fn commitLocked(runtime: *Runtime, selection: *Selection) void {
    if (selection.peer_count > 0) {
        runtime.bridge.peer_updates.?.commit(selection.peer_count);
        // Committed events free lane room the owner publishes into.
        selection.wake = true;
    }
    if (selection.serving_count > 0) {
        const table = &runtime.bridge.incoming.?;
        for (selection.serving[0..selection.serving_count]) |token| table.commitStart(token);
        selection.wake = true;
    }
    if (selection.gossip) |*batch| {
        if (runtime.owner) |owner| if (owner.application.trace_gossip) {
            const previous = n.logging.bind(&runtime.logs);
            defer _ = n.logging.bind(previous);
            const table = &runtime.bridge.gossip.?;
            for (batch.tokens[0..batch.len]) |token| if (table.get(token)) |cell| {
                if (n.gossipsub.trace.selected(cell.kind, cell.id)) std.log.scoped(.network_gossip_trace).info("handed_to_js message_id={x} kind={s} slot={?d} admitted_ms={d}", .{ cell.id, @tagName(cell.kind), cell.metadata.slot, cell.admitted_ms });
            };
        };
        runtime.bridge.gossip.?.finish(batch);
    }
    if (runtime.bridge.quiescent) if (runtime.bridge.gossip) |*table| table.trim();
}

/// Check and arm under the mutex so publication cannot race rearming.
fn endLocked(runtime: *Runtime, selection: *const Selection) Outcome {
    if (selection.wake) runtime.wakeOwnerLocked();
    const pending = runtime.hasDeliveryLocked();
    runtime.bridge.notification_armed = !pending;
    return .{ .needs_another_exchange = pending };
}

fn gossipMarks(runtime: *Runtime) struct { bool, ?u64 } {
    const table = if (runtime.bridge.gossip) |*table| table else return .{ false, null };
    return .{ table.pending(), table.deadline() };
}

/// Builds payloads outside the mutex. Failed construction is terminal; teardown releases the abandoned pins.
pub fn run(runtime: *Runtime, now: u64, host: anytype) !@TypeOf(host.*).Result {
    const closed = try settle(runtime, host);
    var selection: Selection = .{};
    if (!closed) {
        runtime.lock();
        runtime.bridge.notification_armed = false;
        const marks = gossipMarks(runtime);
        selectLocked(runtime, now, &selection);
        // Ignored claims leave verdicts to apply and can move the owner's deadline.
        if (!std.meta.eql(marks, gossipMarks(runtime))) selection.wake = true;
        runtime.unlock();
    }
    const output = host.build(&selection) catch |err| {
        const failure = host.classify(err);
        return fail(host, failure, err);
    };
    const outcome: Outcome = if (closed) .{} else blk: {
        runtime.lock();
        defer runtime.unlock();
        commitLocked(runtime, &selection);
        break :blk endLocked(runtime, &selection);
    };
    return host.finish(output, outcome) catch |err| return fail(host, host.classify(err), err);
}

/// Settles bounded native-owned Promises independently of payload capacity. Close follows a macrotask boundary
/// after the last operation settlement, allowing public async wrappers to settle before it.
fn settle(runtime: *Runtime, host: anytype) !bool {
    runtime.lock();
    runtime.bridge.notification_armed = false;
    const closing = runtime.bridge.quiescent and runtime.closed.resolvers != null and !runtime.completionsReadyLocked();
    runtime.unlock();
    settleOperations(runtime, host) catch |err| return fail(host, host.classify(err), err);
    settleStreams(runtime, host) catch |err| return fail(host, host.classify(err), err);
    if (closing) {
        runtime.join();
        runtime.lock();
        var promise = runtime.closed;
        runtime.closed = .{};
        runtime.unlock();
        defer promise.deinit();
        host.settleClose(&promise) catch |err| return fail(host, host.classify(err), err);
        runtime.removeHook();
    }
    return closing;
}

fn settleStreams(runtime: *Runtime, host: anytype) !void {
    if (runtime.bridge.requests) |*table| for (0..completion_max) |_| {
        runtime.lock();
        const index = table.nextDue(table.completion_cursor, runtime.bridge.stop, runtime.bridge.quiescent) orelse table.nextDue(0, runtime.bridge.stop, runtime.bridge.quiescent) orelse {
            runtime.unlock();
            break;
        };
        table.completion_cursor = index + 1;
        const completion = table.pin(index, runtime.bridge.stop);
        runtime.unlock();
        defer {
            runtime.lock();
            const retired = table.commit(completion);
            runtime.retireRequestStorageLocked();
            runtime.unlock();
            if (retired) runtime.release();
        }
        try host.settleRequest(completion);
    };
    if (runtime.bridge.incoming) |*table| for (0..completion_max) |_| {
        runtime.lock();
        const index = table.nextDue(table.completion_cursor) orelse table.nextDue(0) orelse {
            runtime.unlock();
            break;
        };
        table.completion_cursor = index + 1;
        const completion = table.pin(index);
        runtime.unlock();
        defer {
            runtime.lock();
            if (table.commit(completion)) runtime.wakeOwnerLocked();
            runtime.retireRequestStorageLocked();
            runtime.unlock();
        }
        try host.settleIncoming(completion);
    };
}

/// A stopped environment returns the error for local shutdown; other failures break the bridge contract.
fn fail(host: anytype, failure: Failure, err: anyerror) anyerror {
    return switch (failure) {
        .stopped => err,
        .contract => host.terminate(err),
    };
}

test {
    _ = @import("network_exchange_test.zig");
}
