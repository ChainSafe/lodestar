const std = @import("std");

/// Allocation-free, deinitializable storage for decoding or cloning. This is
/// separate from an SSZ default: compatible unions have no default value. For
/// those, select the first declared option solely to initialize the native tag
/// and empty owned fields before a decoder replaces the value. For every type
/// that has a `default_value`, the result equals it. Never use it where the SSZ
/// default is meant: tree roots, list growth, or fork upgrades.
pub fn initValue(comptime ST: type) ST.Type {
    // The value depends only on the type. Keeping the aggregate initialization
    // at comptime avoids one runtime memcpy per element of large fixed vectors.
    return comptime switch (ST.kind) {
        .compatible_union => @unionInit(
            ST.Type,
            std.fmt.comptimePrint("option_{d}", .{ST._union_options[0].@"0"}),
            initValue(ST._union_options[0].@"1"),
        ),
        .container, .progressive_container => blk: {
            var value: ST.Type = undefined;
            for (ST.fields) |field| @field(value, field.name) = initValue(field.type);
            break :blk value;
        },
        .vector => if (@typeInfo(ST.Type) == .array)
            @splat(initValue(ST.Element))
        else
            ST.default_value,
        else => ST.default_value,
    };
}

test "initValue should start a union at its first option and equal default_value otherwise" {
    const UintType = @import("uint.zig").UintType;
    const BitVectorType = @import("bit_vector.zig").BitVectorType;
    const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
    const FixedListType = @import("list.zig").FixedListType;
    const VariableContainerType = @import("container.zig").VariableContainerType;
    const CompatibleUnionType = @import("compatible_union.zig").CompatibleUnionType;

    const Items = FixedListType(UintType(8), 8, .{});
    const Shape = CompatibleUnionType(.{
        .{ 3, Items },
        .{ 1, Items },
    });
    const shape = initValue(Shape);
    try std.testing.expectEqual(@as(u8, 3), Shape.getSelector(&shape));
    try std.testing.expectEqual(@as(usize, 0), shape.option_3.items.len);

    const Holder = VariableContainerType(struct {
        tag: UintType(64),
        root: ByteVectorType(32),
        flags: BitVectorType(4),
        items: Items,
    });
    try std.testing.expect(Holder.equals(&initValue(Holder), &Holder.default_value));
}
