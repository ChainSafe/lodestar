const std = @import("std");
const rr = @import("ReqResp.zig");
const protocol = @import("protocol.zig");
const Router = @import("../router.zig").Router;
const support = @import("../quic/test_support.zig");
const control_fixture = @import("control_fixture.zig");
const applicationOptions = control_fixture.applicationOptions;

test "reqresp drain retains blocked terminals across control and application instances" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var requests = try rr.init(std.testing.allocator, try applicationOptions());
    defer requests.deinit();
    var controls = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer controls.deinit();
    defer controls.cancelAll(&pair.client, &router, pair.now);
    const size = protocol.Protocol.blocks_by_root_v2.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, 2 * size);
    defer {
        requests.cancelAll(&pair.client, &router, pair.now);
        std.testing.allocator.free(sink);
    }
    const application = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sink[0..size],
        .{},
        pair.now,
    );
    var pong: [8]u8 = undefined;
    const control = try controls.request(
        &pair.client,
        &router,
        handles.client,
        .ping_v1,
        &([_]u8{0} ** 8),
        &pong,
        .{},
        pair.now,
    );
    const application_second = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sink[size..],
        .{},
        pair.now,
    );
    var pong_second: [8]u8 = undefined;
    const control_second = try controls.request(
        &pair.client,
        &router,
        handles.client,
        .ping_v1,
        &([_]u8{0} ** 8),
        &pong_second,
        .{},
        pair.now,
    );
    try std.testing.expect(requests.cancel(&pair.client, &router, application_second, pair.now));
    try std.testing.expect(controls.cancel(&pair.client, &router, control_second, pair.now));
    try std.testing.expect(requests.cancel(&pair.client, &router, application, pair.now));
    try std.testing.expect(controls.cancel(&pair.client, &router, control, pair.now));
    try std.testing.expectEqual(
        @as(usize, 0),
        requests.pump(&pair.client, &router, pair.now, &.{}),
    );
    try std.testing.expectEqual(0, router.negotiator.active());
    // Each instance delivers its terminals in the order they were latched.
    var output: [1]rr.Event = undefined;
    try std.testing.expectEqual(1, controls.pump(&pair.client, &router, pair.now, &output));
    try std.testing.expectEqual(control_second, output[0].failed.request);
    try std.testing.expectEqual(1, controls.pump(&pair.client, &router, pair.now, &output));
    try std.testing.expectEqual(control, output[0].failed.request);
    try std.testing.expectEqual(1, requests.pump(&pair.client, &router, pair.now, &output));
    try std.testing.expectEqual(application_second, output[0].failed.request);
    try std.testing.expectEqual(1, requests.pump(&pair.client, &router, pair.now, &output));
    try std.testing.expectEqual(application, output[0].failed.request);
    _ = requests.pump(&pair.client, &router, pair.now, &.{});
    try std.testing.expectEqual(0, requests.pendingCounts().outbound);
}
