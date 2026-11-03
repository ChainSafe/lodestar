//! Tests for `root.zig`.

const std = @import("std");
const UintType = @import("type/uint.zig").UintType;
const FixedProgressiveListType = @import("type/progressive_list.zig").FixedProgressiveListType;
const ProgressiveBitListType = @import("type/progressive_bit_list.zig").ProgressiveBitListType;
const FixedProgressiveContainerType = @import("type/progressive_container.zig").FixedProgressiveContainerType;
const CompatibleUnionType = @import("type/compatible_union.zig").CompatibleUnionType;
const testing = std.testing;
const ssz = @import("root.zig");
const types = ssz.types;
const HasherData = ssz.HasherData;

test "SSZ bit schemas use the standalone packed value types" {
    const bit_array = @import("bit_array");
    const List = ssz.BitListType(17);
    const Vector = ssz.BitVectorType(17);
    const Progressive = ssz.ProgressiveBitListType(.{});

    try testing.expect(List.Type == bit_array.BitList(.{ .limit = 17 }));
    try testing.expect(Vector.Type == bit_array.BitVector(17));
    try testing.expect(Progressive.Type == bit_array.BitList(.{ .limit = bit_array.unlimited }));
    try testing.expect(ssz.isBitListType(List));
    try testing.expect(!ssz.isBitListType(Progressive));
    try testing.expect(ssz.isBitVectorType(Vector));
    try testing.expect(ssz.isProgressiveBitListType(Progressive));
}

test "redundant SSZ helper APIs are not exposed" {
    try testing.expect(!@hasDecl(types, "isProgressiveListType"));
    try testing.expect(!@hasDecl(types, "isCompatibleUnionType"));
    try testing.expect(!@hasDecl(HasherData, "getAllocator"));
}

test "memory_safety: progressive tree deserialization uses the standard pool API" {
    const List = FixedProgressiveListType(UintType(64), .{});
    const Bits = ProgressiveBitListType(.{});
    const Container = FixedProgressiveContainerType(struct {
        a: UintType(64),
    }, &.{1});
    const Union = CompatibleUnionType(.{
        .{ 1, UintType(64) },
        .{ 2, UintType(64) },
    });

    inline for (.{ List, Bits, Container, Union }) |ST| {
        try std.testing.expect(@hasDecl(ST.tree, "deserializeFromBytes"));
        if (comptime @hasDecl(ST.tree, "deserializeFromBytes")) {
            try std.testing.expectEqual(2, @typeInfo(@TypeOf(ST.tree.deserializeFromBytes)).@"fn".params.len);
        }
    }
}
