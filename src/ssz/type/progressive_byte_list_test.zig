const std = @import("std");
const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const UintType = @import("uint.zig").UintType;
const FixedProgressiveListType = @import("progressive_list.zig").FixedProgressiveListType;
const ProgressiveByteListType = @import("progressive_byte_list.zig").ProgressiveByteListType;
const isProgressiveByteListType = @import("progressive_byte_list.zig").isProgressiveByteListType;
const VariableContainerType = @import("container.zig").VariableContainerType;

fn decode(comptime ST: type, allocator: std.mem.Allocator, text: []const u8, out: *ST.Type) !void {
    var scanner = std.json.Scanner.initCompleteInput(allocator, text);
    defer scanner.deinit();
    try ST.deserializeFromJson(allocator, &scanner, out);
}

test "ProgressiveByteListType should use hex JSON while uint8 lists keep arrays" {
    const allocator = testing.allocator;
    const Bytes = ProgressiveByteListType(.{});
    const Numbers = FixedProgressiveListType(UintType(8), .{});
    try testing.expect(isProgressiveByteListType(Bytes));
    try testing.expect(!isProgressiveByteListType(Numbers));

    var value = Bytes.default_value;
    defer Bytes.deinit(allocator, &value);
    try decode(Bytes, allocator, "\"0x00fF12\"", &value);
    try testing.expectEqualSlices(u8, &.{ 0, 255, 18 }, value.items);

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    var writer: std.json.Stringify = .{ .writer = &output.writer };
    try Bytes.serializeIntoJson(allocator, &writer, &value);
    try testing.expectEqualStrings("\"0x00ff12\"", output.written());
    output.clearRetainingCapacity();
    writer = .{ .writer = &output.writer };
    try Numbers.serializeIntoJson(allocator, &writer, &value);
    try testing.expectEqualStrings("[\"0\",\"255\",\"18\"]", output.written());

    var empty = Bytes.default_value;
    defer Bytes.deinit(allocator, &empty);
    try decode(Bytes, allocator, "\"0x\"", &empty);
    try testing.expectEqual(@as(usize, 0), empty.items.len);
}

test "ProgressiveByteListType should match uint8 list roots through its tree view" {
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    inline for (.{ false, true }) |chunked| {
        const Bytes = ProgressiveByteListType(.{ .chunked_leaf = chunked });
        const Numbers = FixedProgressiveListType(UintType(8), .{ .chunked_leaf = chunked });
        for ([_]usize{ 0, 1, 31, 32, 33, 672, 673, 2079 }) |length| {
            var value = Bytes.default_value;
            defer Bytes.deinit(allocator, &value);
            try value.resize(allocator, length);
            for (value.items, 0..) |*byte, i| byte.* = @truncate(i);
            var expected: [32]u8 = undefined;
            try Numbers.hashTreeRoot(allocator, &value, &expected);
            const view = try Bytes.TreeView.fromValue(allocator, &pool, &value);
            defer view.deinit();
            try testing.expectEqualSlices(u8, &expected, try view.hashTreeRoot());
            if (length > 0) {
                try view.set(length - 1, 77);
                value.items[length - 1] = 77;
                try Numbers.hashTreeRoot(allocator, &value, &expected);
                try testing.expectEqualSlices(u8, &expected, try view.hashTreeRoot());
            }
        }
    }
    try testing.expectEqual(baseline, pool.getNodesInUse());
}

test "ProgressiveByteListType should clone directly and as an ordinary container field" {
    const allocator = testing.allocator;
    const Bytes = ProgressiveByteListType(.{});
    const Payload = VariableContainerType(struct {
        id: UintType(64),
        transaction: Bytes,
    });

    var value = Payload.default_value;
    defer Payload.deinit(allocator, &value);
    value.id = 7;
    try value.transaction.appendSlice(allocator, &.{ 1, 2, 3 });

    var copy = Payload.default_value;
    defer Payload.deinit(allocator, &copy);
    try Payload.clone(allocator, &value, &copy);
    try testing.expect(Payload.equals(&value, &copy));
    try testing.expect(copy.transaction.items.ptr != value.transaction.items.ptr);

    var bytes = Bytes.default_value;
    defer Bytes.deinit(allocator, &bytes);
    try Bytes.clone(allocator, &value.transaction, &bytes);
    try testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, bytes.items);
}

test "ProgressiveByteListType JSON decoding should reject malformed hex and accept short input" {
    const allocator = testing.allocator;
    const Bytes = ProgressiveByteListType(.{});
    const cases = [_]struct { text: []const u8, err: anyerror }{
        .{ .text = "\"0\"", .err = error.InvalidLength },
        .{ .text = "\"0x0\"", .err = error.InvalidLength },
        .{ .text = "\"0xgg\"", .err = error.InvalidCharacter },
        .{ .text = "[]", .err = error.InvalidJson },
        .{ .text = "null", .err = error.InvalidJson },
    };
    for (cases) |case| {
        var value = Bytes.default_value;
        defer Bytes.deinit(allocator, &value);
        try testing.expectError(case.err, decode(Bytes, allocator, case.text, &value));
    }

    var empty = Bytes.default_value;
    defer Bytes.deinit(allocator, &empty);
    try decode(Bytes, allocator, "\"\"", &empty);
    try testing.expectEqual(@as(usize, 0), empty.items.len);

    var value = Bytes.default_value;
    defer Bytes.deinit(allocator, &value);
    try decode(Bytes, allocator, "\"0x001122\"", &value);
    try testing.expectEqualSlices(u8, &.{ 0, 17, 34 }, value.items);
}

test "memory_safety: ProgressiveByteListType JSON decoding should not leak on allocation failure" {
    try testing.checkAllAllocationFailures(testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            const Bytes = ProgressiveByteListType(.{});
            var value = Bytes.default_value;
            defer Bytes.deinit(allocator, &value);
            try decode(Bytes, allocator, "\"0x00112233445566778899aabbccddeeff\"", &value);
            try testing.expectEqual(@as(usize, 16), value.items.len);
            try testing.expectEqual(@as(u8, 255), value.items[15]);
        }
    }.run, .{});
}
