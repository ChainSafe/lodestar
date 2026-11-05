const Reader = @import("frame.zig").Reader;
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");
const std = @import("std");
const writeFrame = @import("frame.zig").writeFrame;

test "frame reader rejects nonminimal length prefixes across reads" {
    var reader: Reader = .{};
    try std.testing.expectEqual(@as(usize, 1), try reader.readPrefix(&.{0x81}));
    try std.testing.expectError(error.VarintTooLong, reader.readPrefix(&.{0}));
    try std.testing.expect(reader.declaredLen() == null);
}

test "frame reader reads a whole frame and round trips writeFrame" {
    var out: [64]u8 = undefined;
    const framed = writeFrame(&out, "hello frame");
    try std.testing.expectEqual(@as(usize, 1 + 11), framed.len);
    var reader = Reader{};
    var body: [64]u8 = undefined;
    const result = try reader.feed(framed, &body);
    try std.testing.expectEqual(framed.len, result.consumed);
    try std.testing.expectEqualStrings("hello frame", result.frame.?);
}

test "frame reader resumes across split prefix and body" {
    var out: [64]u8 = undefined;
    const framed = writeFrame(&out, "abcdefghij"); // 10-byte body, 1-byte prefix
    var reader = Reader{};
    var body: [64]u8 = undefined;
    // feed one byte at a time
    var offset: usize = 0;
    var got: ?[]const u8 = null;
    while (offset < framed.len) {
        const result = try reader.feed(framed[offset..], &body);
        offset += result.consumed;
        if (result.frame) |frame| got = frame;
        try std.testing.expect(result.consumed > 0);
    }
    try std.testing.expectEqualStrings("abcdefghij", got.?);
}

test "frame reader delivers multiple frames from one buffer" {
    var out: [128]u8 = undefined;
    var writer = protobuf.Writer.init(&out);
    writer.varint(3);
    writer.bytes("aaa");
    writer.varint(3);
    writer.bytes("bbb");
    var reader = Reader{};
    var body: [16]u8 = undefined;
    var input = writer.written();
    const first = try reader.feed(input, &body);
    try std.testing.expectEqualStrings("aaa", first.frame.?);
    input = input[first.consumed..];
    const second = try reader.feed(input, &body);
    try std.testing.expectEqualStrings("bbb", second.frame.?);
}

test "frame reader asks the caller to grow the body, then resumes" {
    var out: [64]u8 = undefined;
    const framed = writeFrame(&out, "0123456789ABCDEF"); // 16-byte body
    var reader = Reader{};
    var small: [8]u8 = undefined;
    const first = try reader.feed(framed, &small);
    try std.testing.expect(first.frame == null); // body too small
    try std.testing.expectEqual(@as(?usize, 16), reader.declaredLen());
    try std.testing.expectEqual(@as(usize, 1), first.consumed); // only the prefix consumed
    var big: [32]u8 = undefined;
    const result = try reader.feed(framed[first.consumed..], &big);
    try std.testing.expectEqualStrings("0123456789ABCDEF", result.frame.?);
}

test "frame reader rejects an overlong varint" {
    var reader = Reader{};
    var body: [8]u8 = undefined;
    try std.testing.expectError(error.VarintTooLong, reader.feed(&([_]u8{0x80} ** 11), &body));
}

test "frame reader accepts an empty frame and rejects an oversized declaration" {
    var reader: Reader = .{};
    var body: [1]u8 = undefined;
    const empty = try reader.feed(&.{0}, &body);
    try std.testing.expectEqual(@as(usize, 1), empty.consumed);
    try std.testing.expectEqual(@as(usize, 0), empty.frame.?.len);
    try std.testing.expect(reader.declaredLen() == null);
    var prefix: [10]u8 = undefined;
    var writer = protobuf.Writer.init(&prefix);
    writer.varint(constants.GOSSIP_MAX_SIZE + 1);
    try std.testing.expectError(error.FrameTooLarge, reader.feed(writer.written(), &body));
}
