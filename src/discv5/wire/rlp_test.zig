const std = @import("std");
const rlp = @import("rlp.zig");

test "RLP round-trips strings integers and nested lists" {
    var buffer: [128]u8 = undefined;
    var writer = rlp.Writer.init(&buffer);
    const outer = try writer.beginList();
    try writer.writeBytes("cat");
    try writer.writeUint(1_024);
    const inner = try writer.beginList();
    try writer.writeBytes(&.{});
    try writer.writeBytes(&.{0x7f});
    writer.finishList(inner);
    writer.finishList(outer);

    var encoded = rlp.Reader.init(writer.bytes());
    var decoded = try encoded.readList();
    try std.testing.expectEqualSlices(u8, "cat", try decoded.readBytes());
    try std.testing.expectEqual(@as(u64, 1_024), try decoded.readUint());
    var decoded_inner = try decoded.readList();
    try std.testing.expectEqual(@as(usize, 0), (try decoded_inner.readBytes()).len);
    try std.testing.expectEqualSlices(u8, &.{0x7f}, try decoded_inner.readBytes());
    try std.testing.expect(decoded_inner.atEnd());
    try std.testing.expect(decoded.atEnd());
    try std.testing.expect(encoded.atEnd());
}

test "RLP writer leaves state unchanged when capacity is exhausted" {
    var buffer = [_]u8{0xa5} ** 4;
    var writer = rlp.Writer.init(&buffer);
    try writer.writeBytes(&.{0x01});
    const length_before = writer.bytes().len;
    const bytes_before = buffer;

    try std.testing.expectError(error.BufferTooSmall, writer.writeBytes("long"));
    try std.testing.expectEqual(length_before, writer.bytes().len);
    try std.testing.expectEqualSlices(u8, &bytes_before, &buffer);
}

test "RLP rejects non-canonical encodings" {
    const single = [_]u8{ 0x81, 0x01 };
    var single_reader = rlp.Reader.init(&single);
    try std.testing.expectError(error.InvalidEncoding, single_reader.readBytes());

    const long_string = [_]u8{ 0xb8, 0x01, 0x80 };
    var string_reader = rlp.Reader.init(&long_string);
    try std.testing.expectError(error.InvalidEncoding, string_reader.readRawItem());

    const long_list = [_]u8{ 0xf8, 0x01, 0xc0 };
    var list_reader = rlp.Reader.init(&long_list);
    try std.testing.expectError(error.InvalidEncoding, list_reader.readList());

    const leading_zero = [_]u8{0x00};
    var integer_reader = rlp.Reader.init(&leading_zero);
    try std.testing.expectError(error.InvalidEncoding, integer_reader.readUint());
}

test "RLP raw item requires exactly one canonical item" {
    var buffer: [32]u8 = undefined;
    var writer = rlp.Writer.init(&buffer);
    try std.testing.expectError(
        error.InvalidEncoding,
        writer.writeRawItem(&.{ 0x80, 0x80 }),
    );
    try std.testing.expectEqual(@as(usize, 0), writer.bytes().len);
}
