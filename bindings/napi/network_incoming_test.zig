const std = @import("std");
const n = @import("network");
const rr = n.reqresp;
const runtime_mod = @import("network_runtime.zig");
const Runtime = runtime_mod.Runtime;
const Wake = @import("network_wake.zig").Wake;
const incoming = @import("network_incoming.zig");
const Budget = @import("network_budget.zig").Budget;
const Table = incoming.Table;
const Cell = incoming.Cell;
const network_requests = @import("network_requests.zig");
const test_support = @import("network_test_support.zig");

test "incoming reservation shares exact aggregate credits and rolls back allocation failure" {
    const amount: usize = 64;
    var budget: Budget = .{ .limit = amount };
    var table = try Table.init(std.testing.allocator, 1, &budget);
    defer table.deinit();
    budget.limit -= 1;
    try std.testing.expectError(error.NetworkBridgeFull, table.reserve(.blocks_by_root_v2, 32));
    try std.testing.expectEqual(@as(usize, 0), budget.used);
    budget.limit += 1;
    const first = try table.reserve(.blocks_by_root_v2, 32);
    try std.testing.expectEqual(amount, budget.used);
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    table.backing = failing.allocator();
    try std.testing.expectError(error.OutOfMemory, table.allocate(first, "01234567890123456789012345678901"));
    table.retire(first);
    table.backing = std.testing.allocator;
    try std.testing.expectEqual(@as(usize, 0), budget.used);
    const second = try table.reserve(.blocks_by_root_v2, 32);
    try std.testing.expect(table.get(first) == null);
    try std.testing.expectEqual(first.generation + 1, second.generation);
    table.retire(second);
    table.cells[0].generation = std.math.maxInt(u64);
    try std.testing.expectError(error.NetworkIncomingFull, table.reserve(.blocks_by_root_v2, 32));
}

test "incoming and outbound reservations cannot each spend the aggregate remainder" {
    const protocol = rr.Protocol.blocks_by_root_v2;
    const outbound_amount = 32 + 2 * protocol.info().response_max;
    const inbound_amount: usize = 64;
    var budget: Budget = .{ .limit = outbound_amount + inbound_amount - 1 };
    var outgoing = try network_requests.Table.init(std.testing.allocator, 1, &budget);
    defer outgoing.deinit();
    var inbound = try Table.init(std.testing.allocator, 1, &budget);
    defer inbound.deinit();
    const first = try outgoing.reserve(protocol, 32);
    try std.testing.expectError(error.NetworkBridgeFull, inbound.reserve(protocol, 32));
    try std.testing.expectEqual(outbound_amount, budget.used);
    outgoing.retire(first);
    const second = try inbound.reserve(protocol, 32);
    try std.testing.expectEqual(inbound_amount, budget.used);
    try std.testing.expectError(error.NetworkBridgeFull, outgoing.reserve(protocol, 32));
    inbound.retire(second);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
}

test "incoming submission recognizes a genuine native terminal awaiting output capacity" {
    var pair: rr.testing.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
    defer {
        pair.shared.client.reqresp.cancelAll(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now);
        std.testing.allocator.free(sink);
    }
    const query = [_]u8{0} ** 32;
    _ = try pair.shared.client.reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, .blocks_by_root_v2, &query, sink, .{}, pair.shared.pair.now);
    var handle: ?rr.ReqResp.RequestHandle = null;
    for (0..20) |_| {
        try pair.pumpOnce();
        for (pair.serverEvents()) |event| if (event == .request) {
            handle = event.request.request;
        };
        if (handle != null) break;
    }
    const request = handle.?;
    try std.testing.expectEqual(.ready, pair.shared.server.reqresp.responseReadiness(request));
    try std.testing.expect(pair.shared.server.reqresp.cancel(&pair.shared.pair.server, &pair.shared.server.router, request, pair.shared.pair.now));
    pair.server_event_capacity = 0;
    try pair.pumpOnce();
    try std.testing.expectEqual(@as(usize, 0), pair.serverEvents().len);
    const response = [_]u8{0} ** 4000;
    try std.testing.expectError(error.Terminal, pair.shared.server.reqresp.respond(request, &response, .{ .digest = rr.testing.deneb_digest, .fork = .deneb }, pair.shared.pair.now));
    try std.testing.expectEqual(.terminal, pair.shared.server.reqresp.responseReadiness(request));
    var stale = request;
    stale.generation += 1;
    try std.testing.expectEqual(.stale, pair.shared.server.reqresp.responseReadiness(stale));
    stale = request;
    stale.direction = .outbound;
    try std.testing.expectEqual(.stale, pair.shared.server.reqresp.responseReadiness(stale));
    pair.server_event_capacity = 16;
    try pair.pumpOnce();
    var terminal = false;
    for (pair.serverEvents()) |event| if (event == .failed and std.meta.eql(event.failed.request, request)) {
        try std.testing.expect(event.failed.reason == .cancelled);
        terminal = true;
    };
    try std.testing.expect(terminal);
}

test "queued requests reserve only input and response credits follow a chunk lifetime" {
    const response_max = rr.Protocol.blocks_by_root_v2.info().response_max;
    var budget: Budget = .{ .limit = 32 * 64 + response_max };
    var table = try Table.init(std.testing.allocator, 32, &budget);
    defer table.deinit();
    var tokens: [32]incoming.Token = undefined;
    for (&tokens) |*token| token.* = try table.reserve(.blocks_by_root_v2, 32);
    try std.testing.expectEqual(@as(usize, 32 * 64), budget.used);
    const first = table.get(tokens[0]).?;
    const second = table.get(tokens[1]).?;
    try table.reserveResponse(first, response_max);
    try std.testing.expectError(error.NetworkBridgeFull, table.reserveResponse(second, 1));
    try std.testing.expectEqual(@as(usize, 0), second.response_reservation);
    try table.reserveResponse(first, 4000);
    try std.testing.expectEqual(@as(usize, 32 * 64 + 4000), budget.used);
    table.releaseResponse(first);
    try table.reserveResponse(second, response_max);
    table.releaseResponse(second);
    for (tokens) |token| table.retire(token);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
}

test "incoming serving start delivery preserve a close while pinned" {
    for ([_]bool{ false, true }) |retained| {
        var runtime: Runtime = .{ .env = undefined };
        runtime.bridge.payload_budget.limit = 64;
        runtime.bridge.incoming = try Table.init(std.testing.allocator, 1, &runtime.bridge.payload_budget);
        const table = &runtime.bridge.incoming.?;
        defer table.deinit();
        const token = try table.reserve(.blocks_by_root_v2, 32);
        try table.allocate(token, &(@as([32]u8, @splat(7))));
        const cell = table.get(token).?;
        cell.native = true;
        cell.handle = .{ .direction = .inbound, .index = 0, .generation = 1 };
        cell.serving = if (retained) .{ .index = 0, .generation = 1 } else null;
        try std.testing.expectEqual(token, table.pinStart().?);
        try std.testing.expect(table.pinStart() == null);
        {
            runtime.lock();
            defer runtime.unlock();
            try incoming.captureLocked(&runtime, .{ .served = .{ .request = cell.handle, .chunks = 0 } }, n.Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
        }
        try std.testing.expectEqual(@as(usize, 32), cell.input.len);
        try std.testing.expect(!table.anyDue());
        table.commitStart(token);
        try std.testing.expectEqual(@as(u64, 1), table.diag.requestsTaken);
        try std.testing.expect(cell.exposed and cell.closed_awaited and table.anyDue());
        const completion = table.pin(token.index);
        try std.testing.expect(completion.closed);
        _ = table.commit(completion);
        try std.testing.expectEqual(@as(usize, 0), runtime.bridge.payload_budget.used);
        if (retained) {
            try std.testing.expect(table.get(token) != null);
            cell.serving = null;
            table.retire(token);
        }
        try std.testing.expect(table.get(token) == null);
    }
}

test "sent responses wait for next-chunk credit and can close while waiting" {
    const Ending = enum { after_next_credit, cancelled, shutdown };
    for ([_]Ending{ .after_next_credit, .cancelled, .shutdown }) |ending| {
        var pair: rr.testing.Pair = .{};
        var runtime: Runtime = .{ .env = undefined, .bridge = .{ .notify_live = false, .env_alive = false } };
        const owner = try std.testing.allocator.create(runtime_mod.Owner);
        defer std.testing.allocator.destroy(owner);
        owner.* = .{};
        runtime.owner = owner;
        const resolved = try n.configuration.resolve(.{
            .seed = 1,
            .gossip = .{ .topic_policy = &test_support.topic_policy },
            .forks = &pair.forks,
            .admission_policy = .{ .deneb_start_slot = 0, .blocks_pre_deneb = 1024, .blocks_deneb = 128, .blob_identifiers_deneb = 768, .blob_identifiers_electra = 1152, .number_of_columns = 128, .column_chunks = 16384, .blob_schedule = &.{.{ .start_slot = 0, .max_blobs = 6 }} },
        });
        try pair.shared.pair.init(resolved.limits, resolved.limits);
        defer pair.shared.pair.deinit();
        const options = resolved.core.protocols;
        pair.shared.client = try rr.testing.Endpoint.init(std.testing.allocator, options.reqresp, options.control_reqresp, options.router);
        defer pair.shared.client.deinit();
        defer pair.shared.client.reqresp.cancelAll(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now);
        const local = try options.identify.makeLocal(&pair.shared.pair.server.tls.local_peer_id, &pair.shared.pair.server.local);
        owner.core.protocols = try n.Protocols.init(std.testing.allocator, options, &local);
        defer owner.core.protocols.deinit();
        defer owner.core.protocols.shutdown(&pair.shared.pair.server, pair.shared.pair.now);
        _ = try pair.shared.pair.dial();
        try pair.shared.pair.pump();
        var connected: [8]n.Event = undefined;
        pair.shared.handles.client = pair.shared.pair.events(&pair.shared.pair.client, &connected)[0].connected.conn;
        pair.shared.handles.server = pair.shared.pair.events(&pair.shared.pair.server, &connected)[0].connected.conn;
        runtime.bridge.wake = try Wake.init();
        defer runtime.bridge.wake.?.deinit();
        const response_max = rr.Protocol.blocks_by_root_v2.info().response_max;
        const sink = try std.testing.allocator.alloc(u8, response_max);
        defer std.testing.allocator.free(sink);
        defer pair.shared.client.reqresp.cancelAll(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now);
        const query = [_]u8{0} ** 64;
        _ = try pair.shared.client.reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, .blocks_by_root_v2, &query, sink, .{}, pair.shared.pair.now);
        var handle: ?rr.ReqResp.RequestHandle = null;
        var events: [16]rr.ReqResp.Event = undefined;
        for (0..20) |_| {
            for (try pumpIncoming(&pair, &owner.core.protocols, &events)) |event| {
                if (event == .request) handle = event.request.request;
            }
            if (handle != null) break;
        }
        try std.testing.expect(handle != null);
        runtime.bridge.payload_budget.limit = response_max;
        runtime.bridge.incoming = try Table.init(std.testing.allocator, 1, &runtime.bridge.payload_budget);
        const table = &runtime.bridge.incoming.?;
        defer table.deinit();
        defer owner.core.protocols.shutdown(&pair.shared.pair.server, pair.shared.pair.now);
        const token = try table.reserve(.blocks_by_root_v2, query.len);
        try table.allocate(token, &query);
        const cell = table.get(token).?;
        cell.native = true;
        cell.handle = handle.?;
        _ = table.pinStart().?;
        table.commitStart(token);
        try table.reserveResponse(cell, 4000);
        cell.response = try std.testing.allocator.alloc(u8, 4000);
        @memset(cell.response, 0);
        cell.context = pair.forks[0];
        cell.state = .response_queued;
        cell.response_awaited = true;
        try runtime.bridge.payload_budget.reserve(.publication, response_max - 4000);
        _ = try applyIncoming(&pair, &runtime);
        for (0..20) |_| {
            const delivered = try pumpIncoming(&pair, &owner.core.protocols, &events);
            runtime.lock();
            defer runtime.unlock();
            for (delivered) |event| try incoming.captureLocked(&runtime, event, pair.shared.pair.now);
            if (cell.state == .serving) break;
        }
        try std.testing.expectEqual(@as(u32, 1), cell.chunks);
        try std.testing.expect(cell.response.len == 0 and cell.response_reservation == 0);
        try std.testing.expect(!table.anyDue() and cell.response_awaited and runtime.host_due);
        _ = try applyIncoming(&pair, &runtime);
        try std.testing.expect(runtime.bridge.payload_budget.waiting and !table.anyDue());
        try runtime.bridge.wake.?.drain();
        if (ending == .after_next_credit) {
            runtime.lock();
            runtime.bridge.payload_budget.release(.publication, response_max - 4000);
            runtime.unlock();
            try std.testing.expect(runtime.bridge.wake.?.pending);
            _ = try applyIncoming(&pair, &runtime);
            try std.testing.expect(table.anyDue());
            const completion = table.pin(token.index);
            try std.testing.expect(completion.ack.? == .sent and !completion.closed);
            _ = table.commit(completion);
            try std.testing.expect(!table.anyDue());
            try std.testing.expectEqual(response_max, cell.response_reservation);
        }
        if (ending == .shutdown) runtime.bridge.stop = true else cell.action = .cancel;
        _ = try applyIncoming(&pair, &runtime);
        for (0..20) |_| {
            const delivered = try pumpIncoming(&pair, &owner.core.protocols, &events);
            runtime.lock();
            defer runtime.unlock();
            for (delivered) |event| try incoming.captureLocked(&runtime, event, pair.shared.pair.now);
            if (!cell.native) break;
        }
        try std.testing.expect(!cell.native);
        const completion = table.pin(token.index);
        try std.testing.expect(completion.closed);
        if (ending == .cancelled) try std.testing.expectEqual(incoming.Ack{ .failed = .cancelled }, completion.ack.?);
        if (ending == .shutdown) try std.testing.expect(completion.ack.? == .closed);
        _ = table.commit(completion);
        if (ending != .after_next_credit) runtime.bridge.payload_budget.release(.publication, response_max - 4000);
        try std.testing.expectEqual(@as(usize, 0), runtime.bridge.payload_budget.used);
        try std.testing.expect(table.get(token) == null);
    }
}

fn pumpIncoming(pair: *rr.testing.Pair, server: *n.Protocols, events: []rr.ReqResp.Event) ![]const rr.ReqResp.Event {
    try pair.shared.pair.pump();
    var transport_events: [n.quic.limits.events_per_turn_max]n.Event = undefined;
    const count = server.process(&pair.shared.pair.server, pair.shared.pair.events(&pair.shared.pair.server, &transport_events), pair.shared.pair.now, .{ .application = events });
    _ = pair.shared.processClient(.{});
    try pair.shared.pair.pump();
    return events[0..count.application];
}

fn applyIncoming(pair: *rr.testing.Pair, runtime: *Runtime) !bool {
    const core = &runtime.owner.?.core;
    core.transport.engine = pair.shared.pair.server;
    pair.shared.pair.server = undefined;
    defer {
        pair.shared.pair.server = core.transport.engine;
        core.transport.engine = undefined;
    }
    return incoming.applyPending(runtime, pair.shared.pair.now);
}
