//! Tests for `compatible_union.zig`.

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const FixedListType = @import("list.zig").FixedListType;
const VariableListType = @import("list.zig").VariableListType;
const UintType = @import("uint.zig").UintType;
const BoolType = @import("bool.zig").BoolType;
const VariableContainerType = @import("container.zig").VariableContainerType;
const FixedProgressiveListType = @import("progressive_list.zig").FixedProgressiveListType;
const CompatibleUnionType = @import("compatible_union.zig").CompatibleUnionType;
const initValue = @import("value_init.zig").initValue;

fn expectProgressiveFromValuePoolExhaustionReclaimsNodes(
    comptime ST: type,
    value: *const ST.Type,
    max_available_nodes: usize,
) !void {
    var saw_failure = false;

    // Start with no room and add one slot per attempt. This walks each partial build until the
    // first capacity that can finish the value.
    for (0..max_available_nodes + 1) |available_nodes| {
        var pool = try Node.Pool.init(.{
            .page_allocator = std.testing.allocator,
            .allocator = std.testing.allocator,
            .pool_size = @intCast(available_nodes),
        });
        defer pool.deinit();

        const baseline = pool.getNodesInUse();
        const root = ST.tree.fromValue(&pool, value) catch |err| {
            try std.testing.expectEqual(error.PoolExhausted, err);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            saw_failure = true;
            continue;
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(saw_failure);
        return;
    }
    return error.TestUnexpectedResult;
}

test "memory_safety: compatible union tree.fromValue reclaims unpublished nodes on pool exhaustion" {
    const Union = CompatibleUnionType(.{
        .{ 1, UintType(64) },
        .{ 2, UintType(64) },
    });
    const value: Union.Type = @unionInit(Union.Type, "option_1", 42);

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Union, &value, 32);
}

test "memory_safety: compatible union JSON deserialization preserves out after trailing error" {
    const Items = FixedListType(UintType(8), 8, .{});
    const Union = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    var out: Union.Type = @unionInit(Union.Type, "option_1", Items.default_value);
    defer Union.deinit(std.testing.allocator, &out);

    var scanner = std.json.Scanner.initCompleteInput(
        std.testing.allocator,
        "{\"selector\":\"2\",\"data\":[\"1\",\"2\"]",
    );
    defer scanner.deinit();

    var failed = false;
    Union.deserializeFromJson(std.testing.allocator, &scanner, &out) catch {
        failed = true;
    };
    try std.testing.expect(failed);
    try std.testing.expectEqual(@as(u8, 1), Union.getSelector(&out));
    try std.testing.expectEqual(@as(usize, 0), out.option_1.items.len);
}

test "memory_safety: compatible union clone preserves out on OOM" {
    const Items = FixedListType(UintType(8), 8, .{});
    const Union = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });

    var source_data: ?Items.Type = Items.default_value;
    errdefer if (source_data) |*value| value.deinit(std.testing.allocator);
    try source_data.?.append(std.testing.allocator, 1);
    var source: Union.Type = @unionInit(Union.Type, "option_2", source_data.?);
    source_data = null;
    defer Union.deinit(std.testing.allocator, &source);

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, input: *const Union.Type) !void {
            var out: Union.Type = @unionInit(Union.Type, "option_1", Items.default_value);
            defer Union.deinit(allocator, &out);
            Union.clone(allocator, input, &out) catch |err| {
                try std.testing.expectEqual(@as(u8, 1), Union.getSelector(&out));
                try std.testing.expectEqual(@as(usize, 0), out.option_1.items.len);
                return err;
            };
            try std.testing.expect(Union.equals(input, &out));
        }
    }.run, .{&source});
}

test "memory_safety: compatible union byte deserialization preserves out on malformed input" {
    const Items = FixedProgressiveListType(BoolType(), .{});
    const Union = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    var out: Union.Type = @unionInit(Union.Type, "option_1", Items.default_value);
    defer Union.deinit(std.testing.allocator, &out);

    try std.testing.expectError(
        error.invalidBoolean,
        Union.deserializeFromBytes(std.testing.allocator, &.{ 2, 1, 2 }, &out),
    );
    try std.testing.expectEqual(@as(u8, 1), Union.getSelector(&out));
    try std.testing.expectEqual(@as(usize, 0), out.option_1.items.len);
}

test "variable list of compatible unions should decode, round trip and clone" {
    const allocator = std.testing.allocator;
    const Items = FixedListType(UintType(8), 8, .{});
    const Shape = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    const Shapes = VariableListType(Shape, 4);
    // Two offsets, then {selector 2, data 7 8} and {selector 1, no data}.
    const bytes = [_]u8{ 8, 0, 0, 0, 11, 0, 0, 0, 2, 7, 8, 1 };

    var decoded = initValue(Shapes);
    defer Shapes.deinit(allocator, &decoded);
    try Shapes.deserializeFromBytes(allocator, &bytes, &decoded);
    try std.testing.expectEqual(@as(usize, 2), decoded.items.len);
    try std.testing.expectEqual(@as(u8, 2), Shape.getSelector(&decoded.items[0]));
    try std.testing.expectEqualSlices(u8, &.{ 7, 8 }, decoded.items[0].option_2.items);
    try std.testing.expectEqual(@as(u8, 1), Shape.getSelector(&decoded.items[1]));
    try std.testing.expectEqual(@as(usize, 0), decoded.items[1].option_1.items.len);

    var serialized: [bytes.len]u8 = undefined;
    try std.testing.expectEqual(bytes.len, Shapes.serializeIntoBytes(&decoded, &serialized));
    try std.testing.expectEqualSlices(u8, &bytes, &serialized);

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();
    const root = try Shapes.tree.fromValue(&pool, &decoded);
    defer pool.unref(root);

    var expected_root: [32]u8 = undefined;
    try Shapes.hashTreeRoot(allocator, &decoded, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, root.getRoot(&pool));

    var from_tree = initValue(Shapes);
    defer Shapes.deinit(allocator, &from_tree);
    try Shapes.tree.toValue(allocator, root, &pool, &from_tree);
    try std.testing.expect(Shapes.equals(&decoded, &from_tree));

    var cloned = initValue(Shapes);
    defer Shapes.deinit(allocator, &cloned);
    try Shapes.clone(allocator, &decoded, &cloned);
    try std.testing.expect(Shapes.equals(&decoded, &cloned));

    var scanner = std.json.Scanner.initCompleteInput(
        allocator,
        "[{\"selector\":\"2\",\"data\":[\"7\",\"8\"]},{\"selector\":\"1\",\"data\":[]}]",
    );
    defer scanner.deinit();
    var from_json = initValue(Shapes);
    defer Shapes.deinit(allocator, &from_json);
    try Shapes.deserializeFromJson(allocator, &scanner, &from_json);
    try std.testing.expect(Shapes.equals(&decoded, &from_json));
}

test "variable container holding a compatible union should clone into owned memory" {
    const allocator = std.testing.allocator;
    const Items = FixedListType(UintType(8), 8, .{});
    const Shape = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    const Holder = VariableContainerType(struct {
        tag: UintType(64),
        body: Shape,
    });
    // Tag 5, body offset 12, then {selector 2, data 7 8}.
    const bytes = [_]u8{ 5, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 2, 7, 8 };

    var source = initValue(Holder);
    defer Holder.deinit(allocator, &source);
    try Holder.deserializeFromBytes(allocator, &bytes, &source);

    var cloned = initValue(Holder);
    defer Holder.deinit(allocator, &cloned);
    try Holder.clone(allocator, &source, &cloned);
    try std.testing.expect(Holder.equals(&source, &cloned));

    source.body.option_2.items[0] = 9;
    try std.testing.expectEqual(@as(u8, 7), cloned.body.option_2.items[0]);
}

test "memory_safety: compatible union list should stay deinit-safe after an invalid selector" {
    const allocator = std.testing.allocator;
    const Items = FixedListType(UintType(8), 8, .{});
    const Shape = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    const Shapes = VariableListType(Shape, 4);
    // The first element {selector 2, data 7 8} decodes and allocates; the second has selector 3.
    const bytes = [_]u8{ 8, 0, 0, 0, 11, 0, 0, 0, 2, 7, 8, 3 };

    var out = initValue(Shapes);
    defer Shapes.deinit(allocator, &out);
    try std.testing.expectError(
        error.InvalidSelector,
        Shapes.deserializeFromBytes(allocator, &bytes, &out),
    );
    try std.testing.expectEqual(@as(usize, 2), out.items.len);
    try std.testing.expectEqualSlices(u8, &.{ 7, 8 }, out.items[0].option_2.items);
    try std.testing.expectEqual(@as(u8, 1), Shape.getSelector(&out.items[1]));
    try std.testing.expectEqual(@as(usize, 0), out.items[1].option_1.items.len);
}

test "compatible union cloneInto should keep the selector in the destination union" {
    const allocator = std.testing.allocator;
    const Items = FixedListType(UintType(8), 8, .{});
    const Shape = CompatibleUnionType(.{
        .{ 1, Items },
        .{ 2, Items },
    });
    const Destination = CompatibleUnionType(.{
        .{ 2, Items },
        .{ 5, Items },
    });

    var source = initValue(Shape);
    defer Shape.deinit(allocator, &source);
    try Shape.deserializeFromBytes(allocator, &.{ 2, 7, 8 }, &source);

    var out = initValue(Destination);
    defer Destination.deinit(allocator, &out);
    try Shape.cloneInto(Destination, allocator, &source, &out);
    try std.testing.expectEqual(@as(u8, 2), Destination.getSelector(&out));
    try std.testing.expectEqualSlices(u8, &.{ 7, 8 }, out.option_2.items);

    // Destination has no selector 1, so the clone fails and leaves `out` as it was.
    const unmapped = initValue(Shape);
    try std.testing.expectError(
        error.InvalidSelector,
        Shape.cloneInto(Destination, allocator, &unmapped, &out),
    );
    try std.testing.expectEqualSlices(u8, &.{ 7, 8 }, out.option_2.items);
}
