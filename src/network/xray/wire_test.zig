const std = @import("std");
const wire = @import("wire.zig");
const pb = @import("../wire/protobuf.zig");
const trace = @import("../stream_trace.zig");

test "xray handshake validates version and capture gap capability" {
    try std.testing.expectEqual(@as(u64, 300), try wire.serverHello(&.{ 8, 3, 24, 172, 2, 32, 1 }));
    try std.testing.expectError(error.UnsupportedCollector, wire.serverHello(&.{ 8, 3 }));
    try std.testing.expectError(error.UnsupportedCollector, wire.serverHello(&.{ 8, 2, 32, 1 }));
    try std.testing.expectError(error.Truncated, wire.serverHello(&.{ 8, 128 }));
    try std.testing.expectError(error.InvalidHandshake, wire.serverHello(&.{ 10, 0 }));
}

test "xray chunk envelope preserves sequence timestamps direction and exact bytes" {
    var frame: wire.Frame = .{};
    const event: trace.Event = .{ .observed_at_ns = 987654321, .payload = .{ .data = .{ .stream = 19, .direction = .outbound, .offset = 2, .length = 3 } } };
    const bytes = frame.event(&event, "xxabc", 300, false);
    try std.testing.expectEqual(@as(u8, 3), bytes[0]);
    var outer = pb.Reader.init(bytes[1..]);
    const length = try outer.varint();
    try std.testing.expectEqual(length, outer.data.len - outer.pos);
    var reader = pb.Reader.init(outer.data[outer.pos..]);
    try std.testing.expectEqual(@as(u32, 1), (try reader.tag()).field);
    try std.testing.expectEqual(@as(u64, 300), try reader.varint());
    try std.testing.expectEqual(@as(u32, 2), (try reader.tag()).field);
    try std.testing.expectEqual(event.observed_at_ns, try reader.varint());
    try std.testing.expectEqual(@as(u32, 26), (try reader.tag()).field);
    try std.testing.expectEqualSlices(u8, &.{ 8, 19, 16, 2, 26, 3, 'a', 'b', 'c' }, try reader.lenDelimited());
    try std.testing.expect(reader.atEnd());
}

test "xray maximum chunk fits one bounded frame" {
    const data = try std.testing.allocator.alloc(u8, trace.chunk_max);
    defer std.testing.allocator.free(data);
    @memset(data, 0xaa);
    var frame: wire.Frame = .{};
    const event: trace.Event = .{ .observed_at_ns = std.math.maxInt(u64), .payload = .{ .data = .{ .stream = std.math.maxInt(u64), .direction = .inbound, .offset = 0, .length = data.len } } };
    const bytes = frame.event(&event, data, std.math.maxInt(u64), false);
    try std.testing.expect(bytes.len > data.len and bytes.len <= wire.frame_max);
}
