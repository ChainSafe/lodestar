const std = @import("std");
const n = @import("network");
const exchange = @import("network_exchange.zig");
const r = @import("network_runtime.zig");
const g = @import("network_gossip.zig");
const incoming = @import("network_incoming.zig");
const projection = @import("network_peer_projection.zig");
const commands = @import("network_commands.zig");
const publications = @import("network_publications.zig");
const outgoing = @import("network_requests.zig");
const tsfn = @import("network_test_support.zig");
const Promise = @import("network_promise.zig");
const CloseOutcome = struct { reason: r.Reason, failure: ?anyerror };
const Runtime = r.Runtime;
const Kind = n.gossip_processor.limits.Kind;
const limits_mod = n.gossip_processor.limits;
const State = n.gossip_processor.GossipProcessor.State;
const network_wake = @import("network_wake.zig");
const diagnostics = @import("network_diagnostics.zig");

const Part = enum { peers, serving, checks, gossip, completions, publication, command, closed };

/// Builds a summary instead of JS values, fails at one part or while finishing when asked, and records a
/// contract failure's site instead of terminating. `during` simulates owner work racing payload construction.
const Host = struct {
    runtime: *Runtime,
    clock: u64 = 1,
    fail: ?Part = null,
    fail_finish: bool = false,
    failure: exchange.Failure = .stopped,
    builds: usize = 0,
    terminated: bool = false,
    started: bool = false,
    ran_during: bool = false,
    /// Terminate on a contract failure, as the N-API host does.
    aborts: bool = false,
    during: ?*const fn (*Runtime) void = null,
    settled: Result = .{},
    during_settlement: ?*const fn (*Runtime) anyerror!void = null,

    pub const Result = struct {
        identity: ?r.Identity = null,
        peers: usize = 0,
        serving: [exchange.serving_max]incoming.Token = undefined,
        serving_count: usize = 0,
        checks: g.Batch = .{},
        gossip: ?g.Batch = null,
        publications: [exchange.completion_max]publications.Token = undefined,
        publication_count: usize = 0,
        commands: [commands.capacity]commands.Token = undefined,
        command_count: usize = 0,
        requests: [outgoing.capacity_max]outgoing.Completion = undefined,
        request_count: usize = 0,
        incoming: [incoming.capacity_max]incoming.Completion = undefined,
        incoming_count: usize = 0,
        closed: ?CloseOutcome = null,
        outcome: exchange.Outcome = .{},
    };

    fn failing(self: *const Host, part: Part) bool {
        return if (self.fail) |value| value == part else false;
    }
    fn failure_error(self: *const Host) anyerror {
        return if (self.failure == .stopped) error.PendingException else error.InvalidArg;
    }
    pub fn build(self: *Host, selection: *exchange.Selection) !Result {
        self.builds += 1;
        self.race();
        if (self.failing(.peers) and selection.peer_count > 0) return self.failure_error();
        if (self.failing(.serving) and selection.serving_count > 0) return self.failure_error();
        if (self.failing(.checks) and selection.checks.len > 0) return self.failure_error();
        if (self.failing(.gossip) and selection.gossip != null) return self.failure_error();
        return .{ .identity = selection.identity, .peers = selection.peer_count, .serving = selection.serving, .serving_count = selection.serving_count, .checks = selection.checks, .gossip = selection.gossip, .publications = self.settled.publications, .publication_count = self.settled.publication_count, .commands = self.settled.commands, .command_count = self.settled.command_count, .requests = self.settled.requests, .request_count = self.settled.request_count, .incoming = self.settled.incoming, .incoming_count = self.settled.incoming_count, .closed = self.settled.closed };
    }
    pub fn settlePublication(self: *Host, token: publications.Token) !void {
        try std.testing.expectEqual(publications.State.copying, self.runtime.bridge.publications.?.get(token).?.state);
        if (self.during_settlement) |during| try during(self.runtime);
        if (self.failing(.publication)) return self.failure_error();
        self.settled.publications[self.settled.publication_count] = token;
        self.settled.publication_count += 1;
    }
    pub fn settleCommand(self: *Host, token: commands.Token) !void {
        try std.testing.expectEqual(commands.State.copying, self.runtime.bridge.commands.get(token).state);
        if (self.during_settlement) |during| try during(self.runtime);
        if (self.failing(.command)) return self.failure_error();
        self.settled.commands[self.settled.command_count] = token;
        self.settled.command_count += 1;
    }
    fn race(self: *Host) void {
        if (self.ran_during) return;
        self.ran_during = true;
        if (self.during) |during| during(self.runtime);
    }
    pub fn settleRequest(self: *Host, completion: outgoing.Completion) !void {
        self.race();
        if (self.failing(.completions)) return self.failure_error();
        self.settled.requests[self.settled.request_count] = completion;
        self.settled.request_count += 1;
    }
    pub fn settleIncoming(self: *Host, completion: incoming.Completion) !void {
        self.race();
        if (self.failing(.completions)) return self.failure_error();
        self.settled.incoming[self.settled.incoming_count] = completion;
        self.settled.incoming_count += 1;
    }
    pub fn settleClose(self: *Host, promise: *Promise) !void {
        promise.resolvers = null;
        if (self.failing(.closed)) return self.failure_error();
        self.settled.closed = .{ .reason = self.runtime.bridge.reason, .failure = self.runtime.bridge.terminal_error };
    }
    pub fn finish(self: *Host, output: Result, outcome: exchange.Outcome) !Result {
        if (self.fail_finish) return self.failure_error();
        var result = output;
        result.outcome = outcome;
        return result;
    }

    pub fn classify(self: *Host, _: anyerror) exchange.Failure {
        return self.failure;
    }
    pub fn terminate(self: *Host, err: anyerror) anyerror {
        if (self.aborts) std.debug.panic("native network bridge: {s}", .{@errorName(err)});
        self.terminated = true;
        return err;
    }

    fn turn(self: *Host, demand: ?r.Capacity) !Result {
        self.settled = .{};
        self.ran_during = false;
        if (!self.started) {
            self.started = true;
            self.runtime.closed.resolvers = .{ .env = null, .ref_ = @ptrFromInt(1) };
        }
        self.runtime.bridge.capacity = demand;
        return exchange.run(self.runtime, self.clock, self);
    }
};

const deployed: ?r.Capacity = .{ .gossip_validation = .ready };
const control: ?r.Capacity = null;

fn admit(runtime: *Runtime, kind: Kind, root: ?[32]u8, payload: []const u8) !g.Token {
    const table = &runtime.bridge.gossip.?;
    const canonical: n.gossipsub.topic.Canonical = .{ .digest = @splat(0), .name = .{ .kind = kind } };
    var topic: [n.gossip_processor.GossipProcessor.topic_max]u8 = undefined;
    try table.capture(&.{
        .handle = .{ .index = 0, .generation = 1 },
        .id = @splat(1),
        .peer = .{ .index = 0, .generation = 1 },
        .topic = n.gossipsub.topic.buildCanonical(canonical, &topic),
        .bytes = payload,
        .identity = .{ .bytes = @splat(1) },
        .admitted_ms = 0,
        .deadline = 100,
    }, canonical, &.{ .slot = 1, .root = root }, false, 0);
    const index = table.expiry.tail;
    const token: g.Token = .{ .index = @intCast(index), .generation = table.cells[index].generation };
    runtime.lock();
    runtime.notifyIfReadyLocked();
    runtime.unlock();
    return token;
}

fn queueRequest(runtime: *Runtime) !incoming.Token {
    const table = &runtime.bridge.incoming.?;
    const token = try table.reserve(.blocks_by_root_v2, 32);
    try table.allocate(token, &(.{7} ** 32));
    const cell = table.get(token).?;
    cell.native = true;
    table.refresh(cell);
    runtime.lock();
    runtime.notifyIfReadyLocked();
    runtime.unlock();
    return token;
}

fn publishPeer(runtime: *Runtime) void {
    runtime.lock();
    defer runtime.unlock();
    runtime.bridge.peer_updates.?.publish(&.{.{ .closed = undefined }});
    runtime.notifyIfReadyLocked();
}

/// Ends a served stream the host was handed, as its close completion and release would.
fn retireServed(table: *incoming.Table, token: incoming.Token) void {
    const cell = table.get(token).?;
    cell.closed_awaited = false;
    cell.native = false;
    table.retire(token);
}

fn retireQueued(runtime: *Runtime) void {
    for (runtime.bridge.incoming.?.cells, 0..) |*cell, i| if (cell.state != .free) {
        cell.native = false;
        cell.copying = false;
        runtime.bridge.incoming.?.retire(.{ .index = @intCast(i), .generation = cell.generation });
    };
}

const Fixture = struct {
    runtime: Runtime,
    lane: projection.Lane = .{},

    /// A runtime with a lane, two serving cells and a small gossip table. `notified` makes its notifications
    /// reach the counting test notifier.
    fn init(self: *Fixture, notified: bool, serving: usize) !void {
        self.* = .{ .runtime = .{ .env = undefined, .bridge = .{ .env_alive = notified } } };
        self.runtime.bridge.payload_budget.limit = 64 << 20;
        self.runtime.bridge.peer_updates = &self.lane;
        self.runtime.bridge.incoming = try incoming.Table.init(std.testing.allocator, serving, &self.runtime.bridge.payload_budget);
        const limits: limits_mod.Limits = @splat(.{ .items = 4, .bytes = 4096 });
        self.runtime.bridge.gossip = try g.Table.init(std.testing.allocator, .{ .limits = limits });
    }
    fn deinit(self: *Fixture) void {
        retireQueued(&self.runtime);
        self.runtime.bridge.incoming.?.deinit();
        self.runtime.bridge.gossip.?.close();
        self.runtime.bridge.gossip.?.deinit();
    }
};

fn stopAt(part: Part) !void {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    for (0..2) |_| publishPeer(runtime);
    const requests = [_]incoming.Token{ try queueRequest(runtime), try queueRequest(runtime) };
    const checked = try admit(runtime, .beacon_attestation, @splat(3), "data");
    const column = try admit(runtime, .data_column_sidecar, null, "data");
    const exit = try admit(runtime, .voluntary_exit, null, "data");
    const completed = [_]commands.Token{ try completeCommand(runtime, .getMetrics), try completeCommand(runtime, .getMetrics) };

    var host: Host = .{ .runtime = runtime, .fail = part };
    try std.testing.expectError(error.PendingException, host.turn(deployed));
    try std.testing.expect(!host.terminated);
    // One-shot settlement precedes payload construction and is never rolled back.
    try std.testing.expectEqualSlices(commands.Token, &completed, host.settled.commands[0..host.settled.command_count]);
    for (completed) |token| try std.testing.expectEqual(commands.State.free, runtime.bridge.commands.cells[token.index].state);
    // Failed construction is terminal. Its borrows stay protected until teardown, never requeued.
    for (requests) |token| {
        const cell = runtime.bridge.incoming.?.get(token).?;
        try std.testing.expect(cell.copying and cell.native and cell.input.len == 32);
    }
    const table = &runtime.bridge.gossip.?;
    try std.testing.expectEqual(State.checking, table.get(checked).?.state);
    for ([_]g.Token{ column, exit }) |token| try std.testing.expectEqual(State.copying, table.get(token).?.state);
    table.close();
    try std.testing.expectEqual(@as(usize, 2), table.diag.copying);
    try std.testing.expectEqual(@as(usize, 1), host.builds);
}

test "a stopped environment during the build at any payload part leaves borrows for terminal cleanup and never replays settlement" {
    inline for (.{ Part.peers, Part.serving, Part.checks, Part.gossip }) |part| try stopAt(part);
}

test "a stopped environment while finishing a built result shuts down locally, and a contract failure there is fatal" {
    inline for ([_]exchange.Failure{ .stopped, .contract }) |failure| {
        var fixture: Fixture = undefined;
        try fixture.init(false, 2);
        defer fixture.deinit();
        const runtime = &fixture.runtime;
        publishPeer(runtime);
        const exit = try admit(runtime, .voluntary_exit, null, "data");
        var host: Host = .{ .runtime = runtime, .fail_finish = true, .failure = failure };
        try std.testing.expectError(if (failure == .stopped) error.PendingException else error.InvalidArg, host.turn(deployed));
        try std.testing.expectEqual(failure == .contract, host.terminated);
        // The delivery committed before finishing: its items belong to the host, and teardown reclaims them.
        try std.testing.expectEqual(@as(u8, 0), fixture.lane.len);
        try std.testing.expectEqual(State.delivered, runtime.bridge.gossip.?.get(exit).?.state);
        try std.testing.expect(runtime.bridge.notification_armed);
    }
}

test "a contract failure is not retried: the exchange terminates after one build" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    _ = try admit(runtime, .voluntary_exit, null, "data");
    var host: Host = .{ .runtime = runtime, .fail = .gossip, .failure = .contract };
    try std.testing.expectError(error.InvalidArg, host.turn(deployed));
    try std.testing.expectEqual(@as(usize, 1), host.builds);
    try std.testing.expect(host.terminated);
    try std.testing.expectEqual(@as(usize, 1), runtime.bridge.gossip.?.diag.copying);
}

test "a contract failure terminates the process at the build site without a retry (child process)" {
    try tsfn.expectFatal(struct {
        fn run() void {
            var fixture: Fixture = undefined;
            fixture.init(false, 2) catch std.c._exit(2);
            _ = admit(&fixture.runtime, .voluntary_exit, null, "data") catch std.c._exit(2);
            var host: Host = .{ .runtime = &fixture.runtime, .fail = .gossip, .failure = .contract, .aborts = true };
            _ = host.turn(deployed) catch {};
        }
    }.run, "native network bridge: InvalidArg");
}

test "paused payload delivery still drains observations and arms for new completions" {
    var fixture: Fixture = undefined;
    try fixture.init(true, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    publishPeer(runtime);
    const exit = try admit(runtime, .voluntary_exit, null, "data");
    for (0..commands.capacity - 1) |_| _ = try completeCommand(runtime, .getMetrics);
    var host: Host = .{ .runtime = runtime };
    var batches: usize = 0;
    const demand = control;
    for (0..8) |_| {
        const result = try host.turn(demand);
        batches += 1;
        try std.testing.expect(result.peers == 1 and result.gossip == null);
        try std.testing.expectEqual(runtime.bridge.commands.occupied > 0, result.outcome.needs_another_exchange);
        if (!result.outcome.needs_another_exchange) break;
    }
    try std.testing.expectEqual(@as(usize, 1), batches);
    try std.testing.expectEqual(@as(u8, 0), fixture.lane.len);
    try std.testing.expect(runtime.bridge.notification_armed);
    const before = tsfn.notifications.load(.acquire);
    _ = try completeCommand(runtime, .getMetrics);
    try std.testing.expectEqual(before + 1, tsfn.notifications.load(.acquire));
    const result = try host.turn(deployed);
    try std.testing.expect(result.peers == 0 and result.gossip != null and runtime.bridge.notification_armed);
    runtime.bridge.gossip.?.retire(exit);
}

test "gossip pressure does not withhold native serving starts" {
    var fixture: Fixture = undefined;
    try fixture.init(true, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    var host: Host = .{ .runtime = runtime };
    const pressure: ?r.Capacity = .{};
    _ = try host.turn(pressure);
    const before = tsfn.notifications.load(.acquire);
    const request = try queueRequest(runtime);
    const second_request = try queueRequest(runtime);
    const exit = try admit(runtime, .voluntary_exit, null, "data");
    try std.testing.expectEqual(before + 1, tsfn.notifications.load(.acquire));
    const serving = try host.turn(pressure);
    try std.testing.expectEqualSlices(incoming.Token, &.{ request, second_request }, serving.serving[0..serving.serving_count]);
    try std.testing.expect(serving.gossip == null and !serving.outcome.needs_another_exchange);
    retireServed(&runtime.bridge.incoming.?, request);
    retireServed(&runtime.bridge.incoming.?, second_request);
    const column = try admit(runtime, .data_column_sidecar, null, "data");
    try std.testing.expectEqual(before + 2, tsfn.notifications.load(.acquire));
    const urgent = try host.turn(pressure);
    try std.testing.expectEqualSlices(g.Token, &.{column}, urgent.gossip.?.tokens[0..urgent.gossip.?.len]);
    try std.testing.expect(!urgent.outcome.needs_another_exchange);
    const delivered = try host.turn(deployed);
    try std.testing.expectEqualSlices(g.Token, &.{exit}, delivered.gossip.?.tokens[0..delivered.gossip.?.len]);
    try std.testing.expect(!delivered.outcome.needs_another_exchange);
    for ([_]g.Token{ exit, column }) |token| runtime.bridge.gossip.?.retire(token);
}

test "native serving starts drain in four bounded exchanges without host replenishment" {
    var fixture: Fixture = undefined;
    try fixture.init(false, incoming.capacity_max);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    for (0..incoming.capacity_max) |_| _ = try queueRequest(runtime);
    var host: Host = .{ .runtime = runtime };
    const demand = deployed;
    for (0..4) |i| {
        const result = try host.turn(demand);
        try std.testing.expectEqual(@as(usize, exchange.serving_max), result.serving_count);
        try std.testing.expectEqual(i < 3, result.outcome.needs_another_exchange);
        for (result.serving[0..result.serving_count]) |token| retireServed(&runtime.bridge.incoming.?, token);
    }
}

test "arrivals before selection, during copying and after rearming each reach an exchange" {
    var fixture: Fixture = undefined;
    try fixture.init(true, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    var host: Host = .{ .runtime = runtime };
    const before = tsfn.notifications.load(.acquire);
    _ = try host.turn(deployed);
    // Armed, so the arrival notifies.
    publishPeer(runtime);
    try std.testing.expectEqual(before + 1, tsfn.notifications.load(.acquire));
    // Arrivals during copying remain queued and require another exchange.
    host.during = publishPeer;
    const racing = try host.turn(deployed);
    try std.testing.expect(racing.peers == 1 and racing.outcome.needs_another_exchange and !runtime.bridge.notification_armed);
    try std.testing.expectEqual(@as(u8, 1), fixture.lane.len);
    host.during = null;
    try std.testing.expect(!(try host.turn(deployed)).outcome.needs_another_exchange and runtime.bridge.notification_armed);
    // Rearmed, so the next arrival notifies; a full queue still leaves its undequeued notification.
    tsfn.status = napi_queue_full;
    publishPeer(runtime);
    tsfn.status = 0;
    try std.testing.expect(!runtime.bridge.notification_armed and runtime.bridge.notify_live and !runtime.bridge.stop);
    publishPeer(runtime);
    try std.testing.expectEqual(before + 2, tsfn.notifications.load(.acquire));
    try std.testing.expectEqual(@as(usize, 2), (try host.turn(deployed)).peers);
}
const napi_queue_full = @import("zapi:zapi").napi.c.napi_queue_full;

test "a stop ends new host work while quiescence preserves terminal delivery" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const request = try queueRequest(runtime);
    const checked = try admit(runtime, .beacon_attestation, @splat(3), "data");
    const exit = try admit(runtime, .voluntary_exit, null, "data");
    const command = try runtime.reserveCommand(.getMetrics, null);
    try runtime.queueCommand(command);
    runtime.bridge.stop = true;
    var host: Host = .{ .runtime = runtime };
    const stopped = try host.turn(deployed);
    try std.testing.expect(stopped.serving_count == 0 and stopped.checks.len == 0);
    try std.testing.expect(stopped.gossip == null);
    try std.testing.expectEqual(State.queued, runtime.bridge.gossip.?.get(exit).?.state);
    try std.testing.expect(!runtime.deliverableLocked(.serving));
    try std.testing.expect(!runtime.deliverableLocked(.checks));
    try std.testing.expect(!runtime.deliverableLocked(.gossip));
    try std.testing.expectEqual(State.needs_check, runtime.bridge.gossip.?.get(checked).?.state);
    // Quiescence cancels the command. Close waits for the next exchange, after its Promise reactions can run.
    runtime.lock();
    runtime.bridge.quiescent = true;
    runtime.cancelCommandsLocked();
    runtime.notifyIfReadyLocked();
    runtime.unlock();
    publishPeer(runtime);
    const quiescent = try host.turn(deployed);
    try std.testing.expect(quiescent.peers == 1 and quiescent.gossip == null and quiescent.command_count == 1 and quiescent.closed == null);
    try std.testing.expect((try host.turn(deployed)).closed != null);
    _ = request;
}

test "a 128-column burst reaches the host within two exchanges under saturated ordinary gossip and serving" {
    var runtime: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false, .env_alive = false } };
    runtime.bridge.payload_budget.limit = 64 << 20;
    runtime.bridge.incoming = try incoming.Table.init(std.testing.allocator, incoming.capacity_max, &runtime.bridge.payload_budget);
    defer runtime.bridge.incoming.?.deinit();
    var limits: limits_mod.Limits = @splat(.{ .items = 2, .bytes = 4096 });
    limits[@intFromEnum(Kind.data_column_sidecar)] = .{ .items = 256, .bytes = 4 << 20 };
    limits[@intFromEnum(Kind.voluntary_exit)] = .{ .items = 1024, .bytes = 1 << 20 };
    runtime.bridge.gossip = try g.Table.init(std.testing.allocator, .{ .limits = limits, .execution = limits });
    defer runtime.bridge.gossip.?.deinit();
    const table = &runtime.bridge.gossip.?;
    for (0..incoming.capacity_max) |_| _ = try queueRequest(&runtime);
    for (0..512) |_| _ = try admit(&runtime, .voluntary_exit, null, "exit");
    const column: [16 * 1024]u8 = @splat(5);
    for (0..128) |_| _ = try admit(&runtime, .data_column_sidecar, null, &column);

    var host: Host = .{ .runtime = &runtime };
    var columns: usize = 0;
    var turns: usize = 0;
    var demand = deployed;
    for (0..16) |_| {
        if (columns == 128) break;
        const delivered = try host.turn(demand);
        turns += 1;
        try std.testing.expect(delivered.outcome.needs_another_exchange);
        try std.testing.expectEqual(@as(usize, exchange.serving_max), delivered.serving_count);
        // The host takes each delivery, and both kinds of traffic refill to saturation.
        for (delivered.serving[0..delivered.serving_count]) |token| {
            retireServed(&runtime.bridge.incoming.?, token);
            _ = try queueRequest(&runtime);
        }
        demand.? = .{ .gossip_validation = .ready };
        const batch = delivered.gossip.?;
        try std.testing.expectEqual(@as(usize, g.batch_max), batch.len);
        for (batch.tokens[0..batch.len]) |token| {
            const kind = table.get(token).?.kind;
            columns += @intFromBool(kind == .data_column_sidecar);
            try std.testing.expect(table.report(token, .accept, host.clock));
            table.retire(token);
            if (kind == .voluntary_exit) _ = try admit(&runtime, .voluntary_exit, null, "exit");
        }
    }
    std.debug.print("exchange column_burst columns={d} turns={d}\n", .{ columns, turns });
    try std.testing.expectEqual(@as(usize, 128), columns);
    try std.testing.expectEqual(@as(usize, 2), turns);
    retireQueued(&runtime);
    table.close();
}

test "publication completions batch terminal cells while unfinished work stays admitted" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.publications = try publications.Table.init(std.testing.allocator, 4, &runtime.bridge.payload_budget, 12_000);
    defer runtime.bridge.publications.?.deinit();
    const table = &runtime.bridge.publications.?;
    const low = try completePublication(runtime);
    // Two cells stay admitted but unfinished, so only the lowest and the highest complete.
    const unfinished = [_]publications.Token{ try runtime.reservePublication(.beacon_block, 0, null), try runtime.reservePublication(.beacon_block, 0, null) };
    const high = try completePublication(runtime);
    try std.testing.expectEqual(@as(u8, 3), high.index);
    var host: Host = .{ .runtime = runtime };
    const demand = control;
    var delivered: [4]publications.Token = undefined;
    for (0..3) |pass| {
        // The lowest cell completes again whenever it was delivered, with the next generation.
        if (pass > 0 and table.get(.{ .index = 0, .generation = table.cells[0].generation }) == null) _ = try completePublication(runtime);
        const result = try host.turn(demand);
        try std.testing.expectEqual(@as(usize, if (pass == 0) 2 else 1), result.publication_count);
        try std.testing.expect(result.outcome.needs_another_exchange == (table.anyTerminal()));
        for (0..result.publication_count) |i| {
            const token = result.publications[i];
            delivered[if (pass == 0) i else pass + 1] = token;
            try std.testing.expect(table.get(token) == null);
        }
    }
    // Both terminal cells arrive together; refilling uses fresh generations.
    try std.testing.expectEqualSlices(publications.Token, &.{ low, high, .{ .index = 0, .generation = 2 }, .{ .index = 0, .generation = 3 } }, &delivered);
    for (unfinished) |token| runtime.retirePublication(token);
}

test "a stopped environment during Promise settlement retires the borrowed publication without retry" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.publications = try publications.Table.init(std.testing.allocator, 4, &runtime.bridge.payload_budget, 12_000);
    defer runtime.bridge.publications.?.deinit();
    const tokens = [_]publications.Token{ try completePublication(runtime), try completePublication(runtime) };
    var host: Host = .{ .runtime = runtime, .fail = .publication };
    try std.testing.expectError(error.PendingException, host.turn(control));
    try std.testing.expect(runtime.bridge.publications.?.get(tokens[0]) == null);
    try std.testing.expectEqual(publications.State.terminal, runtime.bridge.publications.?.get(tokens[1]).?.state);
    host.fail = null;
    const result = try host.turn(control);
    try std.testing.expectEqualSlices(publications.Token, tokens[1..], result.publications[0..result.publication_count]);
    try std.testing.expect(!result.outcome.needs_another_exchange and runtime.bridge.publications.?.diag.occupied == 0);
    // The remaining terminal cell still settles; the failed settlement is never retried.
}

/// A command the owner completed at the lowest free cell, as execution leaves it.
fn completeCommand(runtime: *Runtime, command: commands.Command) !commands.Token {
    const token = try runtime.reserveCommand(command, null);
    runtime.lock();
    defer runtime.unlock();
    runtime.bridge.commands.transition(runtime.bridge.commands.get(token), .executing);
    runtime.bridge.commands.transition(runtime.bridge.commands.get(token), .terminal);
    runtime.notifyIfReadyLocked();
    return token;
}

test "command completions batch terminal cells while unfinished work stays admitted, and release diagnostic admission" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const low = try completeCommand(runtime, .getPeerScores);
    const unfinished = [_]commands.Token{ try runtime.reserveCommand(.getMetrics, null), try runtime.reserveCommand(.getMetrics, null) };
    const high = try completeCommand(runtime, .getMetrics);
    try std.testing.expectEqual(low.index + 3, high.index);
    var host: Host = .{ .runtime = runtime };
    const demand = control;
    var delivered: [4]commands.Token = undefined;
    for (0..3) |pass| {
        // The lowest cell completes again whenever it was delivered, taking the freed diagnostic buffer.
        if (pass > 0 and runtime.bridge.commands.cells[low.index].state == .free) _ = try completeCommand(runtime, .getPeerScores);
        const result = try host.turn(demand);
        try std.testing.expectEqual(@as(usize, if (pass == 0) 2 else 1), result.command_count);
        for (0..result.command_count) |i| {
            const token = result.commands[i];
            delivered[if (pass == 0) i else pass + 1] = token;
            try std.testing.expectEqual(commands.State.free, runtime.bridge.commands.cells[token.index].state);
        }
    }
    try std.testing.expectEqualSlices(commands.Token, &.{ low, high, .{ .index = low.index, .generation = low.generation + 1 }, .{ .index = low.index, .generation = low.generation + 2 } }, &delivered);
    try std.testing.expect(runtime.bridge.commands.diagnostic == null);
    for (unfinished) |token| runtime.retireCommand(token);
}

test "shutdown during command settlement keeps its snapshot alive and ends payload delivery" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.diagnostics = try diagnostics.Buffer.create(std.testing.allocator, 4, 1);
    const token = try completeCommand(runtime, .getPeerScores);
    _ = try queueRequest(runtime);
    _ = try admit(runtime, .beacon_attestation, @splat(3), "check");
    _ = try admit(runtime, .voluntary_exit, null, "payload");
    const Shutdown = struct {
        fn during(target: *Runtime) !void {
            target.lock();
            defer target.unlock();
            target.bridge.stop = true;
            target.cancelCommandsLocked();
            target.bridge.quiescent = true;
            target.retireDiagnosticsLocked();
            std.debug.assert(target.bridge.diagnostics != null);
            std.debug.assert(target.bridge.commands.occupied == 1);
        }
    };
    var host: Host = .{ .runtime = runtime, .during_settlement = Shutdown.during };
    const result = try host.turn(deployed);
    try std.testing.expectEqualSlices(commands.Token, &.{token}, result.commands[0..result.command_count]);
    try std.testing.expectEqual(commands.State.free, runtime.bridge.commands.cells[token.index].state);
    try std.testing.expect(runtime.bridge.diagnostics == null);
    try std.testing.expectEqual(@as(u32, 1), runtime.refs.load(.monotonic));
    try std.testing.expectEqual(@as(usize, 0), result.serving_count);
    try std.testing.expectEqual(@as(usize, 0), result.checks.len);
    try std.testing.expect(result.gossip == null);
    try std.testing.expect(result.closed == null);
    try std.testing.expect((try host.turn(control)).closed != null);
}

fn expectUnselected(runtime: *Runtime) !void {
    const table = &runtime.bridge.gossip.?;
    try std.testing.expectEqual(@as(usize, 0), table.diag.copying);
    for (table.cells) |cell| if (cell.state != .free)
        try std.testing.expect(cell.state == .queued or cell.state == .needs_check);
    for (runtime.bridge.incoming.?.cells) |cell| if (cell.state != .free)
        try std.testing.expect(cell.state == .queued and !cell.copying and !cell.exposed);
}

test "one-shot settlement leaves payloads unclaimed until their delivery is built" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    _ = try queueRequest(runtime);
    _ = try admit(runtime, .beacon_attestation, @splat(3), "check");
    _ = try admit(runtime, .voluntary_exit, null, "payload");
    _ = try completeCommand(runtime, .getMetrics);
    var host: Host = .{ .runtime = runtime, .during_settlement = expectUnselected };
    const result = try host.turn(deployed);
    try std.testing.expectEqual(@as(usize, 1), result.command_count);
    try std.testing.expectEqual(@as(usize, 1), result.serving_count);
    try std.testing.expectEqual(@as(usize, 1), result.checks.len);
    try std.testing.expectEqual(@as(usize, 1), result.gossip.?.len);
}

test "a failed command settlement releases diagnostic admission without replaying an earlier publication" {
    inline for ([_]exchange.Failure{ .stopped, .contract }) |failure| {
        var fixture: Fixture = undefined;
        try fixture.init(false, 2);
        defer fixture.deinit();
        const runtime = &fixture.runtime;
        runtime.bridge.publications = try publications.Table.init(std.testing.allocator, 1, &runtime.bridge.payload_budget, 12_000);
        defer runtime.bridge.publications.?.deinit();
        const published = try completePublication(runtime);
        const command = try completeCommand(runtime, .getPeerScores);
        const payload = try admit(runtime, .voluntary_exit, null, "payload");
        var host: Host = .{ .runtime = runtime, .fail = .command, .failure = failure, .during_settlement = expectUnselected };
        try std.testing.expectError(host.failure_error(), host.turn(deployed));
        try std.testing.expectEqualSlices(publications.Token, &.{published}, host.settled.publications[0..host.settled.publication_count]);
        try std.testing.expectEqual(@as(usize, 0), host.builds);
        try std.testing.expectEqual(failure == .contract, host.terminated);
        try std.testing.expect(runtime.bridge.publications.?.get(published) == null);
        try std.testing.expectEqual(commands.State.free, runtime.bridge.commands.cells[command.index].state);
        try std.testing.expect(runtime.bridge.commands.diagnostic == null);
        try std.testing.expectEqual(State.queued, runtime.bridge.gossip.?.get(payload).?.state);
        try std.testing.expectEqual(@as(u32, 1), runtime.refs.load(.monotonic));
        host.fail = null;
        const result = try host.turn(control);
        try std.testing.expectEqual(@as(usize, 0), result.publication_count + result.command_count);
    }
}

/// A request admitted at the lowest free cell, holding the runtime as `requestStart` does.
fn admitRequest(runtime: *Runtime) !outgoing.Token {
    const table = &runtime.bridge.requests.?;
    const token = try table.reserve(.blocks_by_root_v2, 0);
    runtime.retain();
    try table.allocate(token, 0);
    table.get(token).?.state = .queued;
    return token;
}

/// Moves an admitted request to where the owner leaves it, and readiness with it.
fn ownerMoves(runtime: *Runtime, token: outgoing.Token, comptime move: fn (*outgoing.Cell) void) void {
    runtime.lock();
    defer runtime.unlock();
    const cell = runtime.bridge.requests.?.get(token).?;
    move(cell);
    runtime.bridge.requests.?.releasePayload(cell);
    runtime.bridge.requests.?.refresh(cell);
    runtime.notifyIfReadyLocked();
}

fn pulledDone(cell: *outgoing.Cell) void {
    cell.state = .terminal;
    cell.terminal = .done;
    cell.pulling = true;
}

fn pulledChunk(cell: *outgoing.Cell) void {
    cell.state = .native;
    cell.native = .{ .index = 0, .generation = 1, .direction = .outbound };
    cell.chunk = .{ .len = 4, .fork = null, .origin = .{ .connection = .{ .index = 0, .generation = 1 }, .endpoint = null } };
    cell.pulling = true;
}

/// Ends a request the owner still streams, and retires it.
fn retireStreaming(runtime: *Runtime, token: outgoing.Token) void {
    const cell = runtime.bridge.requests.?.get(token).?;
    cell.native = null;
    cell.chunk = null;
    cell.delivered = false;
    runtime.bridge.requests.?.retire(token);
    runtime.release();
}

/// A request whose terminal outcome awaits its pending pull, at the lowest free cell.
fn completeRequest(runtime: *Runtime) !outgoing.Token {
    const token = try admitRequest(runtime);
    ownerMoves(runtime, token, pulledDone);
    return token;
}

test "request completions batch terminal cells while unfinished work stays admitted" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.payload_budget.limit = 1 << 30;
    runtime.bridge.requests = try outgoing.Table.init(std.testing.allocator, 4, &runtime.bridge.payload_budget);
    defer runtime.bridge.requests.?.deinit();
    const table = &runtime.bridge.requests.?;
    const low = try completeRequest(runtime);
    // Two requests stay admitted with no pull, so only the lowest and the highest complete.
    const unpulled = [_]outgoing.Token{ try admitRequest(runtime), try admitRequest(runtime) };
    const high = try completeRequest(runtime);
    try std.testing.expectEqual(@as(u8, 3), high.index);
    var host: Host = .{ .runtime = runtime };
    const demand = control;
    var delivered: [4]outgoing.Token = undefined;
    for (0..3) |pass| {
        // The lowest cell completes again whenever it was delivered, with the next generation.
        if (pass > 0 and table.cells[0].state == .free) _ = try completeRequest(runtime);
        const result = try host.turn(demand);
        try std.testing.expectEqual(@as(usize, if (pass == 0) 2 else 1), result.request_count);
        try std.testing.expectEqual(outgoing.Terminal.done, result.requests[0].value.terminal);
        for (0..result.request_count) |i| {
            const token = result.requests[i].token;
            delivered[if (pass == 0) i else pass + 1] = token;
            try std.testing.expect(table.get(token) == null);
        }
    }
    // Both terminal cells arrive together; refilling uses fresh generations.
    try std.testing.expectEqualSlices(outgoing.Token, &.{ low, high, .{ .index = 0, .generation = 2 }, .{ .index = 0, .generation = 3 } }, &delivered);
    for (unpulled) |token| {
        table.retire(token);
        runtime.release();
    }
}

test "a stopped environment reclaims abandoned request chunks and outcomes" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.payload_budget.limit = 1 << 30;
    runtime.bridge.requests = try outgoing.Table.init(std.testing.allocator, 2, &runtime.bridge.payload_budget);
    defer runtime.bridge.requests.?.deinit();
    const table = &runtime.bridge.requests.?;
    const streaming = try admitRequest(runtime);
    ownerMoves(runtime, streaming, pulledChunk);
    const ended = try completeRequest(runtime);
    var host: Host = .{ .runtime = runtime, .fail = .completions };
    try std.testing.expectError(error.PendingException, host.turn(control));
    for ([_]outgoing.Token{ streaming, ended }) |token| try std.testing.expect(!table.get(token).?.copying);
    outgoing.closeLocked(runtime);
    runtime.bridge.quiescent = true;
    runtime.retain();
    runtime.cleanup();
    try std.testing.expectEqual(@as(usize, 0), table.diag.occupied);
    try std.testing.expectEqual(@as(usize, 0), runtime.bridge.payload_budget.used);
}

test "an outcome the owner records while its chunk is copied survives the commit and waits for the next pull" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.payload_budget.limit = 1 << 30;
    runtime.bridge.requests = try outgoing.Table.init(std.testing.allocator, 1, &runtime.bridge.payload_budget);
    defer runtime.bridge.requests.?.deinit();
    const table = &runtime.bridge.requests.?;
    const token = try admitRequest(runtime);
    ownerMoves(runtime, token, pulledChunk);
    const Owner = struct {
        /// The stream's end, captured as the owner does while the chunk is pinned.
        fn ends(target: *Runtime) void {
            target.lock();
            defer target.unlock();
            const cell = &target.bridge.requests.?.cells[0];
            cell.native = null;
            cell.terminal = .done;
            cell.state = .terminal;
            target.bridge.requests.?.releasePayload(cell);
            target.bridge.requests.?.refresh(cell);
        }
    };
    var host: Host = .{ .runtime = runtime, .during = Owner.ends };
    const chunk = try host.turn(control);
    try std.testing.expectEqual(@as(usize, 4), chunk.requests[0].value.chunk.len);
    const cell = table.get(token).?;
    try std.testing.expect(cell.terminal.? == .done and cell.chunk == null and !cell.delivered and !cell.pulling);
    // No pull awaits the outcome, so it stays with the cell.
    host.during = null;
    try std.testing.expectEqual(@as(usize, 0), (try host.turn(control)).request_count);
    runtime.lock();
    outgoing.armPull(runtime, cell);
    runtime.unlock();
    const ended = try host.turn(control);
    try std.testing.expectEqual(@as(usize, 1), ended.request_count);
    try std.testing.expectEqual(outgoing.Terminal.done, ended.requests[0].value.terminal);
    try std.testing.expect(table.get(token) == null);
}

/// A stream the host was handed, as a serving start's commit leaves it.
fn exposeStream(runtime: *Runtime) !incoming.Token {
    const token = try queueRequest(runtime);
    runtime.lock();
    defer runtime.unlock();
    const table = &runtime.bridge.incoming.?;
    const cell = table.get(token).?;
    table.releaseInput(cell);
    cell.exposed = true;
    cell.closed_awaited = true;
    cell.state = .serving;
    table.refresh(cell);
    runtime.notifyIfReadyLocked();
    return token;
}

/// Moves a handed stream to where the owner leaves it, and readiness with it.
fn streamMoves(runtime: *Runtime, token: incoming.Token, comptime move: fn (*incoming.Cell) void) void {
    runtime.lock();
    defer runtime.unlock();
    const table = &runtime.bridge.incoming.?;
    const cell = table.get(token).?;
    move(cell);
    table.releasePayload(cell);
    table.refresh(cell);
    runtime.notifyIfReadyLocked();
}

fn streamEnds(cell: *incoming.Cell) void {
    cell.native = false;
    cell.state = .terminal;
}

fn chunkSent(cell: *incoming.Cell) void {
    cell.response_awaited = true;
    cell.ack = .sent;
}

/// A handed stream that ended, whose close awaits delivery, at the lowest free cell.
fn endedStream(runtime: *Runtime) !incoming.Token {
    const token = try exposeStream(runtime);
    streamMoves(runtime, token, streamEnds);
    return token;
}

test "incoming completions batch terminal cells while unfinished work stays admitted" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 4);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const table = &runtime.bridge.incoming.?;
    const low = try endedStream(runtime);
    // Two streams still run, so only the lowest and the highest complete.
    const running = [_]incoming.Token{ try exposeStream(runtime), try exposeStream(runtime) };
    const high = try endedStream(runtime);
    try std.testing.expectEqual(@as(u8, 3), high.index);
    var host: Host = .{ .runtime = runtime };
    const demand = control;
    var delivered: [4]incoming.Token = undefined;
    for (0..3) |pass| {
        // The lowest cell ends again whenever it was delivered, with the next generation.
        if (pass > 0 and table.cells[0].state == .free) _ = try endedStream(runtime);
        const result = try host.turn(demand);
        try std.testing.expectEqual(@as(usize, if (pass == 0) 2 else 1), result.incoming_count);
        try std.testing.expect(result.incoming[0].closed and result.incoming[0].ack == null and result.incoming[0].permission == null);
        for (0..result.incoming_count) |i| {
            const token = result.incoming[i].token;
            delivered[if (pass == 0) i else pass + 1] = token;
            try std.testing.expect(table.get(token) == null);
        }
    }
    try std.testing.expectEqualSlices(incoming.Token, &.{ low, high, .{ .index = 0, .generation = 2 }, .{ .index = 0, .generation = 3 } }, &delivered);
    for (running) |token| retireServed(table, token);
}

test "a stopped environment reclaims abandoned incoming completions" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const table = &runtime.bridge.incoming.?;
    const acknowledged = try exposeStream(runtime);
    streamMoves(runtime, acknowledged, chunkSent);
    const ended = try endedStream(runtime);
    var host: Host = .{ .runtime = runtime, .fail = .completions };
    try std.testing.expectError(error.PendingException, host.turn(control));
    for ([_]incoming.Token{ acknowledged, ended }) |token| try std.testing.expect(!table.get(token).?.copying);
    incoming.closeLocked(runtime);
    runtime.bridge.quiescent = true;
    runtime.retain();
    runtime.cleanup();
    try std.testing.expectEqual(@as(usize, 0), table.diag.occupied);
    try std.testing.expectEqual(@as(usize, 0), runtime.bridge.payload_budget.used);
}

test "incoming settlement preserves a close that arrives while its acknowledgement is copied" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const table = &runtime.bridge.incoming.?;
    // The stream ended before the exchange, so its acknowledgement and close are due in one cell.
    const together = try exposeStream(runtime);
    streamMoves(runtime, together, chunkSent);
    streamMoves(runtime, together, streamEnds);
    var host: Host = .{ .runtime = runtime };
    const both = try host.turn(control);
    try std.testing.expectEqual(@as(usize, 1), both.incoming_count);
    try std.testing.expect(both.incoming[0].ack.? == .sent and both.incoming[0].closed);
    try std.testing.expect(table.get(together) == null);
    // The stream ends while its acknowledgement is copied: the same bounded drain takes the close next.
    const racing = try exposeStream(runtime);
    streamMoves(runtime, racing, chunkSent);
    const Owner = struct {
        fn ends(target: *Runtime) void {
            target.lock();
            defer target.unlock();
            const cell = &target.bridge.incoming.?.cells[0];
            streamEnds(cell);
            target.bridge.incoming.?.releasePayload(cell);
            target.bridge.incoming.?.refresh(cell);
        }
    };
    host.during = Owner.ends;
    const acknowledged = try host.turn(control);
    try std.testing.expect(acknowledged.incoming[0].ack.? == .sent and !acknowledged.incoming[0].closed);
    host.during = null;
    try std.testing.expectEqual(@as(usize, 2), acknowledged.incoming_count);
    try std.testing.expect(acknowledged.incoming[1].ack == null and acknowledged.incoming[1].closed);
    try std.testing.expectEqual(@as(usize, 0), (try host.turn(control)).incoming_count);
    try std.testing.expect(table.get(racing) == null);
}

test "close follows the last settlement and a stopped close is not retried" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    _ = try completeCommand(runtime, .getMetrics);
    runtime.lock();
    runtime.bridge.stop = true;
    runtime.failLocked(error.NetworkWakeFailed);
    runtime.bridge.quiescent = true;
    runtime.notifyIfReadyLocked();
    runtime.unlock();
    var host: Host = .{ .runtime = runtime };
    const completion = try host.turn(control);
    try std.testing.expect(completion.command_count == 1 and completion.closed == null and completion.outcome.needs_another_exchange);
    host.fail = .closed;
    try std.testing.expectError(error.PendingException, host.turn(control));
    try std.testing.expect(runtime.closed.resolvers == null);
    try std.testing.expect(!runtime.deliverableLocked(.completions));
    try std.testing.expect(!host.terminated);
}

test "the close result arrives alone although peer events wait under a peer demand, and takes none with it" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    for (0..5) |_| publishPeer(runtime);
    runtime.lock();
    runtime.bridge.stop = true;
    runtime.bridge.quiescent = true;
    runtime.notifyIfReadyLocked();
    runtime.unlock();
    try std.testing.expect(!runtime.deliverableLocked(.peers));
    var host: Host = .{ .runtime = runtime };
    const closed = try host.turn(deployed);
    try std.testing.expectEqual(CloseOutcome{ .reason = .requested, .failure = null }, closed.closed.?);
    try std.testing.expectEqual(@as(usize, 0), closed.peers);
    try std.testing.expect(!closed.outcome.needs_another_exchange);
    // Delivered, the close ends the peer events too: no exchange takes them.
    try std.testing.expect(!runtime.deliverableLocked(.peers));
    try std.testing.expectEqual(@as(usize, 0), (try host.turn(deployed)).peers);
    try std.testing.expectEqual(@as(u8, 5), fixture.lane.len);
}

test "publication delivery bounds each exchange and reaches higher cells before refilled lower cells" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    runtime.bridge.publications = try publications.Table.init(std.testing.allocator, 64, &runtime.bridge.payload_budget, 12_000);
    defer runtime.bridge.publications.?.deinit();
    for (0..64) |_| _ = try completePublication(runtime);
    var host: Host = .{ .runtime = runtime };
    const first = try host.turn(control);
    try std.testing.expectEqual(exchange.completion_max, first.publication_count);
    try std.testing.expect(first.outcome.needs_another_exchange);
    const refilled = try completePublication(runtime);
    try std.testing.expectEqual(@as(u8, 0), refilled.index);
    const second = try host.turn(control);
    try std.testing.expectEqual(exchange.completion_max, second.publication_count);
    for (second.publications[0..second.publication_count], 32..) |token, index| try std.testing.expectEqual(index, token.index);
    try std.testing.expect(second.outcome.needs_another_exchange);
    const last = try host.turn(control);
    try std.testing.expectEqual(@as(usize, 1), last.publication_count);
    try std.testing.expectEqual(refilled, last.publications[0]);
    try std.testing.expect(!last.outcome.needs_another_exchange);
}

test "peer delivery uses bounded batches and rearms only after the remainder is delivered" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    for (0..40) |_| publishPeer(runtime);
    var host: Host = .{ .runtime = runtime };
    const first = try host.turn(deployed);
    try std.testing.expectEqual(exchange.peers_max, first.peers);
    try std.testing.expect(first.outcome.needs_another_exchange and !runtime.bridge.notification_armed);
    const last = try host.turn(deployed);
    try std.testing.expectEqual(@as(usize, 8), last.peers);
    try std.testing.expect(!last.outcome.needs_another_exchange and runtime.bridge.notification_armed);
}

test "nonurgent gossip waits without polling until host capacity recovers" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const token = try admit(runtime, .voluntary_exit, null, "data");
    defer runtime.bridge.gossip.?.retire(token);
    var host: Host = .{ .runtime = runtime };
    var demand = deployed;
    demand.?.gossip_validation = .backpressured;
    const deferred = try host.turn(demand);
    try std.testing.expect(deferred.gossip == null and !deferred.outcome.needs_another_exchange);
    const delivered = try host.turn(deployed);
    try std.testing.expect(delivered.gossip.?.len == 1 and !delivered.outcome.needs_another_exchange);
}

fn completePublication(runtime: *Runtime) !publications.Token {
    const token = try runtime.reservePublication(.beacon_block, 0, null);
    runtime.lock();
    defer runtime.unlock();
    runtime.bridge.publications.?.transition(runtime.bridge.publications.?.get(token).?, .terminal);
    runtime.notifyIfReadyLocked();
    return token;
}

test "identity coalesces independently of a full peer lane and survives publication during copying" {
    var fixture: Fixture = undefined;
    try fixture.init(true, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    for (0..64) |_| publishPeer(runtime);
    var identity = std.mem.zeroes(r.Identity);
    identity.metadata.seq_number = 1;
    runtime.bridge.identity = identity;
    identity.metadata.seq_number = 2;
    runtime.bridge.identity = identity;
    const Publish = struct {
        fn during(target: *Runtime) void {
            var next = std.mem.zeroes(r.Identity);
            next.metadata.seq_number = 3;
            target.lock();
            defer target.unlock();
            target.bridge.identity = next;
        }
    };
    var host: Host = .{ .runtime = runtime, .during = Publish.during };
    const first = try host.turn(control);
    try std.testing.expectEqual(@as(u64, 2), first.identity.?.metadata.seq_number);
    try std.testing.expectEqual(exchange.peers_max, first.peers);
    try std.testing.expect(first.outcome.needs_another_exchange);
    host.during = null;
    const second = try host.turn(control);
    try std.testing.expectEqual(@as(u64, 3), second.identity.?.metadata.seq_number);
    try std.testing.expect(!second.outcome.needs_another_exchange);
    try std.testing.expect((try host.turn(control)).identity == null);
}

test "delivered expired gossip remains charged until the host reports completion" {
    var fixture: Fixture = undefined;
    try fixture.init(false, 2);
    defer fixture.deinit();
    const runtime = &fixture.runtime;
    const token = try admit(runtime, .voluntary_exit, null, "data");
    var host: Host = .{ .runtime = runtime };
    const delivered = try host.turn(deployed);
    try std.testing.expectEqual(token, delivered.gossip.?.tokens[0]);
    const table = &runtime.bridge.gossip.?;
    table.expire(100);
    try std.testing.expectEqual(@as(usize, 1), table.snapshot(101).expiredExecuting);
    try std.testing.expectEqual(@as(u64, 1), table.snapshot(101).oldestExpiredExecutionAgeMs);
    try std.testing.expect(!table.report(token, .accept, 101));
    try std.testing.expectEqual(@as(usize, 0), table.snapshot(101).occupied);
    try std.testing.expect(!table.report(token, .reject, 102));
    try std.testing.expectEqual(@as(usize, 0), table.snapshot(102).expiredExecuting);
}
