const std = @import("std");
const invariant = @import("route_invariant.zig");
const support = @import("../quic/test_support.zig");
const Client = @import("Client.zig");
const Server = @import("Server.zig");
const StreamOwner = @import("../types.zig").StreamOwner;
const Options = @import("options.zig").Options;
const harness = @import("test_pair.zig");
const ct = @import("consensus_types");

test "reverse route invariant detects orphans without a forward request to visit" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    var outbound = [_]Client{.{}};
    var inbound = [_]Server{.{}};
    try invariant.check(&pair.client, .application, &outbound, &inbound);
    for ([_]Options.Routes{ .application, .control }) |routes| {
        for ([_]StreamOwner{ routes.outbound, routes.inbound }) |owner| {
            try pair.client.bindStream(stream, .{ .owner = owner, .row = 0 });
            try std.testing.expectError(error.OrphanedRoute, invariant.check(&pair.client, routes, &outbound, &inbound));
            try pair.client.bindStream(stream, .{ .owner = owner, .row = 1 });
            try std.testing.expectError(error.OrphanedRoute, invariant.check(&pair.client, routes, &outbound, &inbound));
        }
    }
    pair.client.closeStream(stream, 0);
    try std.testing.expect(pair.client.route(stream) == null);
    try std.testing.expect(!pair.client.eventsPending());
    try invariant.check(&pair.client, .application, &outbound, &inbound);
}

test "reverse route invariant requires the full handle and protocol ownership" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    var outbound = [_]Client{.{}};
    outbound[0].request = .{ .completion = .running, .stream = stream };
    try pair.client.bindStream(stream, .{ .owner = .reqresp_outbound, .row = 0 });
    try invariant.check(&pair.client, .application, &outbound, &.{});
    for (0..4) |changed| {
        var wrong = stream;
        switch (changed) {
            0 => wrong.conn.generation += 1,
            1 => wrong.conn.index += 1,
            2 => wrong.id += 4,
            3 => wrong.slot += 1,
            else => unreachable,
        }
        outbound[0].request.stream = wrong;
        try std.testing.expectError(error.MismatchedRoute, invariant.check(&pair.client, .application, &outbound, &.{}));
    }
    outbound[0].request.stream = stream;
    outbound[0].request.stream_owner = .router;
    try std.testing.expectError(error.OrphanedRoute, invariant.check(&pair.client, .application, &outbound, &.{}));
    // Closing retains readable streams, but no longer requires a live protocol request.
    try std.testing.expect(pair.client.close(handles.client, 0));
    try invariant.check(&pair.client, .application, &outbound, &.{});
}

test "reqresp routes negotiated streams through the configured instance" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const client = &setup.shared.client.control_reqresp;
    const server = &setup.shared.server.control_reqresp;
    var request: [ct.phase0.Status.fixed_size]u8 = undefined;
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    const handle = try harness.requestStatus(&setup, &request, &sink);
    try harness.waitForRequest(&setup);
    const stream = client.outbound[handle.index].request.stream;
    try std.testing.expectEqual(.reqresp_control_outbound, setup.shared.pair.client.route(stream).?.owner);
    for (setup.serverEvents()) |event| if (event == .request) {
        const incoming = server.inbound[event.request.request.index].request.stream;
        try std.testing.expectEqual(.reqresp_control_inbound, setup.shared.pair.server.route(incoming).?.owner);
        try invariant.check(&setup.shared.pair.server, .control, server.outbound, server.inbound);
        try invariant.check(&setup.shared.pair.server, .application, &.{}, &.{});
        return;
    };
    return error.TestUnexpectedResult;
}
