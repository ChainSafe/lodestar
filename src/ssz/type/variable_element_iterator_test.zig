const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const VariableElementIterator = @import("variable_element_iterator.zig").VariableElementIterator;

/// A dummy ssz variable element used for tests.
const VariableElement = struct {
    pub const kind = TypeKind.list;
};

/// A dummy ssz variable list used for tests.
const VariableList = struct {
    pub const kind = TypeKind.list;
    pub const Element = VariableElement;
    pub const limit = 2;
};

/// A dummy ssz variable vector used for tests.
const VariableVector = struct {
    pub const kind = TypeKind.vector;
    pub const Element = VariableElement;
    pub const length = 2;
};

const VariableProgressiveList = struct {
    pub const kind = TypeKind.progressive_list;
    pub const Element = VariableElement;
    pub const limit = 2;
};

test "iterates validated variable elements" {
    const data = [_]u8{
        8,  0, 0, 0,
        10, 0, 0, 0,
        1,  2, 3, 4,
        5,
    };

    var elements = try VariableElementIterator(VariableList).init(&data);
    try std.testing.expectEqual(@as(usize, 2), elements.len);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2 }, (try elements.next()).?);
    try std.testing.expectEqualSlices(u8, &.{ 3, 4, 5 }, (try elements.next()).?);
    try std.testing.expectEqual(null, try elements.next());
}

test "iterates progressive list elements" {
    const data = [_]u8{
        8,  0, 0, 0,
        10, 0, 0, 0,
        1,  2, 3, 4,
        5,
    };

    var elements = try VariableElementIterator(VariableProgressiveList).init(&data);
    try std.testing.expectEqual(@as(usize, 2), elements.len);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2 }, (try elements.next()).?);
    try std.testing.expectEqualSlices(u8, &.{ 3, 4, 5 }, (try elements.next()).?);
    try std.testing.expectEqual(null, try elements.next());
}

test "accepts empty list and empty elements" {
    var empty_list = try VariableElementIterator(VariableList).init(&.{});
    try std.testing.expectEqual(@as(usize, 0), empty_list.len);
    try std.testing.expectEqual(null, try empty_list.next());

    const data = [_]u8{
        8, 0, 0, 0,
        8, 0, 0, 0,
    };
    var empty_elements = try VariableElementIterator(VariableList).init(&data);
    try std.testing.expectEqualSlices(u8, &.{}, (try empty_elements.next()).?);
    try std.testing.expectEqualSlices(u8, &.{}, (try empty_elements.next()).?);
    try std.testing.expectEqual(null, try empty_elements.next());
}

test "rejects malformed offsets during iteration or initialization" {
    var decreasing = try VariableElementIterator(VariableList).init(&.{
        8, 0, 0, 0,
        7, 0, 0, 0,
    });
    try std.testing.expectError(error.offsetNotIncreasing, decreasing.next());

    var out_of_range = try VariableElementIterator(VariableList).init(&.{
        8, 0, 0, 0,
        9, 0, 0, 0,
    });
    try std.testing.expectError(error.offsetOutOfRange, out_of_range.next());
    try std.testing.expectError(
        error.offsetNotDivisibleBy4,
        VariableElementIterator(VariableList).init(&.{ 5, 0, 0, 0, 0 }),
    );
    try std.testing.expectError(
        error.invalidOffsetCount,
        VariableElementIterator(VariableVector).init(&.{ 4, 0, 0, 0 }),
    );
    inline for (.{ VariableList, VariableProgressiveList }) |List| {
        try std.testing.expectError(
            error.invalidOffsetCount,
            VariableElementIterator(List).init(&.{ 12, 0, 0, 0 }),
        );
    }
    try std.testing.expectError(
        error.offsetOutOfRange,
        VariableElementIterator(VariableVector).init(&.{}),
    );
}
