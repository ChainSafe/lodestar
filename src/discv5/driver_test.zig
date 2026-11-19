const std = @import("std");
const Transport = @import("Transport.zig");
const CallTable = @import("CallTable.zig");
const message = @import("wire/message.zig");
const types = @import("types.zig");
const test_support = @import("test_support.zig");
const Pair = @import("transport_test_support.zig").Pair;
const endpoint = test_support.endpoint;
const driver = @import("driver.zig");

test "transport returns call expiries when rejecting a malformed datagram" {
    var setup_io: test_support.ManualIo = .{};
    var pair: Pair = undefined;
    try pair.init(setup_io.io(), 1, true);
    defer pair.deinit();

    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x45}),
        .enr_sequence = pair.record_a.sequence,
    } };
    var host: test_support.ManualIo = .{};
    const handle = try pair.transport_a.startCall(host.io(), endpoint(&pair.record_b), &pair.record_b, &request, try Transport.monotonicMilliseconds(host.io()));
    host.receive_advance_ms = 1;
    host.datagram = .{ .from = pair.transport_b.localAddress(), .bytes = &.{0xff} };

    var expired: [4]CallTable.Expired = undefined;
    const result = try driver.step(&pair.transport_a, host.io(), &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(?Transport.Failure, null), result.failure);
    try std.testing.expect(result.datagram == .rejected);
    try std.testing.expectEqual(types.RejectReason.malformed_packet, result.datagram.rejected);
    try std.testing.expectEqual(@as(usize, 1), result.calls_expired);
    try std.testing.expectEqual(handle, expired[0].handle);
    try std.testing.expectEqual(@as(u64, 1), result.now_ms);
    const next = try driver.step(&pair.transport_a, host.io(), &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(usize, 0), next.calls_expired);
}

test "transport polls no later than a pending call deadline" {
    var setup_io: test_support.ManualIo = .{};
    var pair: Pair = undefined;
    try pair.init(setup_io.io(), 105, true);
    defer pair.deinit();
    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x47}),
        .enr_sequence = pair.record_a.sequence,
    } };
    var output: [1_280]u8 = undefined;
    _ = try pair.transport_a.engine.startCall(
        &output,
        endpoint(&pair.record_b),
        &pair.record_b,
        &request,
        0,
        &test_support.sealEntropy(0x33),
    );
    var host: test_support.ManualIo = .{ .now_ms = 100, .receive_failure = error.ConcurrencyUnavailable };
    var expired: [4]CallTable.Expired = undefined;
    const result = try driver.step(&pair.transport_a, host.io(), &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(error.ConcurrencyUnavailable, result.failure.?.cause);
    try std.testing.expectEqual(Transport.FailureStage.receive, result.failure.?.stage);
    try std.testing.expectEqual(@as(i96, 5), host.poll_ms.?);
    _ = try driver.step(&pair.transport_a, host.io(), &expired, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, 102) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(i96, 2), host.poll_ms.?);
}

test "discovery driver preserves received input when its post-wait clock fails" {
    var host: test_support.ManualIo = .{ .now_ms = 100 };
    var pair: Pair = undefined;
    try pair.init(host.io(), 100, false);
    defer pair.deinit();
    host.datagram = .{ .from = pair.transport_b.localAddress(), .bytes = &.{0xff} };
    const Clock = struct {
        fn read(context: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
            const state: *test_support.ManualIo = @ptrCast(@alignCast(context.?));
            return .{ .nanoseconds = if (state.datagram == null) -1 else @as(i96, state.now_ms) * std.time.ns_per_ms };
        }
    };
    var vtable = host.io().vtable.*;
    vtable.now = Clock.read;
    const io: std.Io = .{ .userdata = &host, .vtable = &vtable };
    var expired: [1]CallTable.Expired = undefined;
    const result = try driver.step(&pair.transport_a, io, &expired, .{});
    try std.testing.expectEqual(error.ClockOutOfRange, result.failure.?.cause);
    try std.testing.expectEqual(Transport.FailureStage.clock, result.failure.?.stage);
    try std.testing.expectEqual(@as(u64, 100), result.now_ms);
    try std.testing.expectEqual(types.RejectReason.malformed_packet, result.datagram.rejected);
}
