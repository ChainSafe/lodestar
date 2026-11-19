const std = @import("std");
const pb = @import("protobuf.zig");
test "protobuf checked scalar varints reject noncanonical and accept maximum values" {
    var reader = pb.Reader.init(&.{ 0x80, 0 });
    try std.testing.expectError(error.NonCanonical, reader.varint());
    reader = pb.Reader.init(&.{ 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1 });
    try std.testing.expectEqual(std.math.maxInt(u64), try reader.varint());
    reader = pb.Reader.init(&.{ 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2 });
    try std.testing.expectError(error.Overflow, reader.varint());
    var bytes: [10]u8 = undefined;
    var writer = pb.Writer.init(&bytes);
    writer.varint(std.math.maxInt(u64));
    try std.testing.expectEqual(@as(usize, 10), writer.len);
}

test "protobuf validates tag ranges and supported wire types before dispatch" {
    var bytes: [16]u8 = undefined;
    for ([_]u64{ 0, 1, 7, @as(u64, 1) << 32 }) |raw| {
        var writer = pb.Writer.init(&bytes);
        writer.varint(raw);
        var reader = pb.Reader.init(writer.written());
        try std.testing.expectError(error.InvalidField, reader.tag());
    }
    for ([_]u3{ 3, 4, 6, 7 }) |wire| {
        var writer = pb.Writer.init(&bytes);
        writer.tag(1, wire);
        var reader = pb.Reader.init(writer.written());
        try std.testing.expectError(error.BadWireType, reader.tag());
    }
    for ([_]u3{ 0, 1, 2, 5 }) |wire| {
        var writer = pb.Writer.init(&bytes);
        writer.tag(std.math.maxInt(u29), wire);
        var reader = pb.Reader.init(writer.written());
        try std.testing.expectEqual(pb.Tag{ .field = std.math.maxInt(u29), .wire = wire }, try reader.tag());
    }
    var reader = pb.Reader.init(&.{ 0x88, 0 });
    try std.testing.expectError(error.NonCanonical, reader.tag());
    reader = pb.Reader.init(&.{ 0x80, 0 });
    try std.testing.expectError(error.NonCanonical, reader.lenDelimited());
}
