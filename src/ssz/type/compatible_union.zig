const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isFixedType = @import("type_kind.zig").isFixedType;
const hashOne = @import("hashing").hashOne;
const Node = @import("persistent_merkle_tree").Node;

/// Validates that a selector is within the valid range (1-127)
fn isValidSelector(selector: u8) bool {
    return selector >= 1 and selector <= 127;
}

/// Validates and extracts selector from serialized data
fn validateAndExtractSelector(data: []const u8, comptime options: anytype) !u8 {
    if (data.len < 1) return error.InvalidSize;
    const selector = data[0];
    if (!isValidSelector(selector)) return error.InvalidSelector;

    inline for (options) |option| {
        if (option.@"0" == selector) return selector;
    }
    return error.InvalidSelector;
}

/// Creates a 32-byte padded array with the selector in the first byte
fn selectorPadded(selector: u8) [32]u8 {
    var result = [_]u8{0} ** 32;
    result[0] = selector;
    return result;
}

/// Creates a tag enum for the union
fn UnionTagType(comptime options: anytype) type {
    const fields_count = options.len;

    comptime var enum_names: [fields_count][:0]const u8 = undefined;
    comptime var enum_values: [fields_count]u8 = undefined;
    inline for (options, 0..) |option, i| {
        const selector = option.@"0";
        const name = std.fmt.comptimePrint("option_{d}", .{selector});

        enum_names[i] = name;
        enum_values[i] = selector;
    }

    return @Enum(u8, .exhaustive, &enum_names, &enum_values);
}

/// Creates a tagged union type for the data portion
fn UnionDataType(comptime options: anytype) type {
    const fields_count = options.len;

    // Build union fields from options
    comptime var union_names: [fields_count][:0]const u8 = undefined;
    comptime var union_types: [fields_count]type = undefined;
    comptime var union_attrs: [fields_count]std.builtin.Type.UnionField.Attributes = undefined;
    inline for (options, 0..) |option, i| {
        const selector = option.@"0";
        const option_type = option.@"1";

        // Create a sentinel-terminated field name
        const name = std.fmt.comptimePrint("option_{d}", .{selector});

        union_names[i] = name;
        union_types[i] = option_type.Type;
        union_attrs[i] = .{ .@"align" = @alignOf(option_type.Type) };
    }

    return @Union(.auto, UnionTagType(options), &union_names, &union_types, &union_attrs);
}

pub fn areTypesCompatible(comptime A: type, comptime B: type) bool {
    if (A == B) return true;

    if (A.kind == .compatible_union and B.kind == .compatible_union) {
        inline for (A._union_options) |option_a| {
            inline for (B._union_options) |option_b| {
                if (!areTypesCompatible(option_a.@"1", option_b.@"1")) return false;
            }
        }
        return true;
    }

    if (A.kind != B.kind) return false;

    return switch (A.kind) {
        .bool => true,
        .uint => A.fixed_size == B.fixed_size,
        .progressive_bit_list => true,
        .list => A.limit == B.limit and areTypesCompatible(A.Element, B.Element),
        .vector => A.length == B.length and areTypesCompatible(A.Element, B.Element),
        .progressive_list => areTypesCompatible(A.Element, B.Element),
        .container => containersAreCompatible(A, B),
        .progressive_container => progressiveContainersAreCompatible(A, B),
        .compatible_union => unreachable,
    };
}

fn containersAreCompatible(comptime A: type, comptime B: type) bool {
    if (A.fields.len != B.fields.len) return false;

    inline for (A.fields, B.fields) |field_a, field_b| {
        if (!std.mem.eql(u8, field_a.name, field_b.name)) return false;
        if (!areTypesCompatible(field_a.type, field_b.type)) return false;
    }
    return true;
}

fn progressiveContainersAreCompatible(comptime A: type, comptime B: type) bool {
    inline for (A.fields, A.field_indices) |field_a, index_a| {
        inline for (B.fields, B.field_indices) |field_b, index_b| {
            if (index_a == index_b) {
                if (!std.mem.eql(u8, field_a.name, field_b.name)) return false;
                if (!areTypesCompatible(field_a.type, field_b.type)) return false;
            }
            if (std.mem.eql(u8, field_a.name, field_b.name) and index_a != index_b) return false;
        }
    }
    return true;
}

fn compatibleUnionOptionsAreCompatible(comptime options: anytype) bool {
    inline for (options, 0..) |option_a, i| {
        inline for (options, 0..) |option_b, j| {
            if (i < j and !areTypesCompatible(option_a.@"1", option_b.@"1")) return false;
        }
    }
    return true;
}

pub fn CompatibleUnionType(comptime options: anytype) type {
    comptime {
        // Validate that we have at least one option
        if (options.len == 0) {
            @compileError("CompatibleUnion must have at least one type option");
        }

        // Validate all selectors are in valid range
        for (options) |option| {
            const selector = option.@"0";
            if (!isValidSelector(selector)) {
                @compileError("CompatibleUnion selectors must be in range 1-127");
            }
        }

        // Check for duplicate selectors.
        for (options, 0..) |option1, i| {
            for (options, 0..) |option2, j| {
                if (i < j and option1.@"0" == option2.@"0") {
                    @compileError("CompatibleUnion has duplicate selector");
                }
            }
        }

        if (!compatibleUnionOptionsAreCompatible(options)) {
            @compileError("CompatibleUnion option types are not compatible");
        }
    }

    const ValueType = UnionDataType(options);

    // Calculate min and max sizes
    comptime var _min_size: usize = std.math.maxInt(usize);
    comptime var _max_size: usize = 0;

    inline for (options) |option| {
        const option_type = option.@"1";
        const option_min = if (@hasDecl(option_type, "min_size")) option_type.min_size else option_type.fixed_size;
        const option_max = if (@hasDecl(option_type, "max_size")) option_type.max_size else option_type.fixed_size;
        _min_size = @min(_min_size, option_min);
        // Handle unbounded types (max_size == maxInt(usize))
        if (option_max == std.math.maxInt(usize)) {
            _max_size = std.math.maxInt(usize);
        } else {
            _max_size = @max(_max_size, option_max);
        }
    }

    // Add 1 byte for the selector
    _min_size += 1;
    if (_max_size != std.math.maxInt(usize)) {
        _max_size += 1;
    }

    return struct {
        const Self = @This();
        pub const kind = TypeKind.compatible_union;
        pub const Type: type = ValueType;
        pub const min_size: usize = _min_size;
        pub const max_size: usize = _max_size;
        pub const _union_options = options;

        /// Get the selector value from a union value
        pub fn getSelector(value: *const Type) u8 {
            return @intFromEnum(std.meta.activeTag(value.*));
        }

        /// Check if a selector is valid
        pub fn isValidSelectorValue(selector: u8) bool {
            inline for (options) |option| {
                if (option.@"0" == selector) {
                    return true;
                }
            }
            return false;
        }

        pub fn equals(a: *const Type, b: *const Type) bool {
            const a_selector = getSelector(a);
            const b_selector = getSelector(b);
            if (a_selector != b_selector) {
                return false;
            }

            // Compare data based on selector
            inline for (options) |option| {
                if (a_selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});
                    return option_type.equals(&@field(a.*, field_name), &@field(b.*, field_name));
                }
            }
            return false;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            const selector = getSelector(value);
            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    if (!comptime isFixedType(option_type)) {
                        const data_ptr = &@field(value.*, field_name);
                        option_type.deinit(allocator, data_ptr);
                    }
                    return;
                }
            }
        }

        pub fn clone(
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *Type,
        ) !void {
            const selector = getSelector(value);

            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    const value_data_ptr = &@field(value.*, field_name);
                    var replacement = @unionInit(Type, field_name, option_type.default_value);
                    errdefer deinit(allocator, &replacement);
                    const replacement_data_ptr = &@field(replacement, field_name);
                    if (comptime isFixedType(option_type)) {
                        try option_type.clone(value_data_ptr, replacement_data_ptr);
                    } else {
                        try option_type.clone(allocator, value_data_ptr, replacement_data_ptr);
                    }
                    out.* = replacement;
                    return;
                }
            }
            return error.InvalidSelector;
        }

        /// Hash tree root: mix_in_selector(hash_tree_root(data), selector)
        pub fn hashTreeRoot(allocator: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var data_root: [32]u8 = undefined;
            const selector = getSelector(value);

            // Hash the data based on selector
            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    const data_ptr = &@field(value.*, field_name);

                    if (comptime isFixedType(option_type)) {
                        try option_type.hashTreeRoot(data_ptr, &data_root);
                    } else {
                        try option_type.hashTreeRoot(allocator, data_ptr, &data_root);
                    }

                    // Mix in selector: hash(data_root, selector_padded)
                    const selector_bytes = selectorPadded(selector);
                    hashOne(out, &data_root, &selector_bytes);
                    return;
                }
            }

            return error.InvalidSelector;
        }

        pub fn serializedSize(value: *const Type) usize {
            var size: usize = 1; // selector byte
            const selector = getSelector(value);

            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    if (comptime isFixedType(option_type)) {
                        size += option_type.fixed_size;
                    } else {
                        const data_ptr = &@field(value.*, field_name);
                        size += option_type.serializedSize(data_ptr);
                    }
                    return size;
                }
            }

            return size;
        }

        /// Serialize: selector (1 byte) + serialize(data)
        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            const selector = getSelector(value);
            out[0] = selector;

            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    // Access the union field properly using the active tag
                    const data_ref = &@field(value.*, field_name);
                    const bytes_written = option_type.serializeIntoBytes(data_ref, out[1..]);
                    return 1 + bytes_written;
                }
            }

            return 1;
        }

        /// Deserialize: read selector, then deserialize data using selected type
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            const selector = try validateAndExtractSelector(data, options);

            // Deserialize data based on selector
            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    var replacement = @unionInit(Type, field_name, option_type.default_value);
                    errdefer deinit(allocator, &replacement);
                    const replacement_data_ptr = &@field(replacement, field_name);

                    if (comptime isFixedType(option_type)) {
                        try option_type.deserializeFromBytes(data[1..], replacement_data_ptr);
                    } else {
                        try option_type.deserializeFromBytes(allocator, data[1..], replacement_data_ptr);
                    }

                    out.* = replacement;
                    return;
                }
            }

            return error.InvalidSelector;
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                const selector = try validateAndExtractSelector(data, options);

                // Validate data based on selector
                inline for (options) |option| {
                    if (selector == option.@"0") {
                        const option_type = option.@"1";
                        try option_type.serialized.validate(data[1..]);
                        return;
                    }
                }
            }

            pub fn hashTreeRoot(allocator: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                const selector = try validateAndExtractSelector(data, options);
                var data_root: [32]u8 = undefined;

                // Hash data based on selector
                inline for (options) |option| {
                    if (selector == option.@"0") {
                        const option_type = option.@"1";

                        if (comptime isFixedType(option_type)) {
                            try option_type.serialized.hashTreeRoot(data[1..], &data_root);
                        } else {
                            try option_type.serialized.hashTreeRoot(allocator, data[1..], &data_root);
                        }

                        // Mix in selector
                        const selector_bytes = selectorPadded(selector);
                        hashOne(out, &data_root, &selector_bytes);
                        return;
                    }
                }
            }
        };

        /// JSON format: {"selector": "number", "data": type_json}
        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, value: *const Type) !void {
            const selector = getSelector(value);
            try writer.beginObject();

            try writer.objectField("selector");
            try writer.print("\"{d}\"", .{selector});

            try writer.objectField("data");

            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    const data_ptr = &@field(value.*, field_name);

                    if (comptime isFixedType(option_type)) {
                        try option_type.serializeIntoJson(writer, data_ptr);
                    } else {
                        try option_type.serializeIntoJson(allocator, writer, data_ptr);
                    }

                    try writer.endObject();
                    return;
                }
            }

            try writer.endObject();
        }

        pub const tree = struct {
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                // Get selector from right child (mixed in)
                const selector_node = try node.getRight(pool);
                const selector_bytes = selector_node.getRoot(pool);
                const selector = selector_bytes[0];
                if (!isValidSelector(selector) or !isValidSelectorValue(selector)) {
                    return error.InvalidSelector;
                }

                // Get data from left child
                const data_node = try node.getLeft(pool);

                // Deserialize data based on selector
                inline for (options) |option| {
                    if (selector == option.@"0") {
                        const option_type = option.@"1";
                        const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                        var replacement = @unionInit(Type, field_name, option_type.default_value);
                        errdefer deinit(allocator, &replacement);
                        const replacement_data_ptr = &@field(replacement, field_name);

                        if (comptime isFixedType(option_type)) {
                            try option_type.tree.toValue(data_node, pool, replacement_data_ptr);
                        } else {
                            try option_type.tree.toValue(allocator, data_node, pool, replacement_data_ptr);
                        }
                        out.* = replacement;
                        return;
                    }
                }

                return error.InvalidSelector;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const allocator = pool.allocator;
                var value: Type = undefined;
                try toValue(allocator, node, pool, &value);
                defer Self.deinit(allocator, &value);

                return Self.serializedSize(&value);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const allocator = pool.allocator;
                var value: Type = undefined;
                try toValue(allocator, node, pool, &value);
                defer Self.deinit(allocator, &value);

                return Self.serializeIntoBytes(&value, out);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                const allocator = pool.allocator;
                var value: Type = undefined;
                try Self.deserializeFromBytes(allocator, data, &value);
                defer Self.deinit(allocator, &value);

                return fromValue(pool, &value);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var data_tree: Node.Id = undefined;
                const selector = getSelector(value);

                // Create tree for data based on selector
                inline for (options) |option| {
                    if (selector == option.@"0") {
                        const option_type = option.@"1";
                        const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                        const data_ptr = &@field(value.*, field_name);

                        data_tree = try option_type.tree.fromValue(pool, data_ptr);
                        errdefer pool.unref(data_tree);

                        // Mix in selector: create branch with data on left, selector on right
                        const selector_bytes = selectorPadded(selector);
                        const selector_node = try pool.createLeaf(&selector_bytes);
                        errdefer pool.unref(selector_node);

                        return try pool.createBranch(data_tree, selector_node);
                    }
                }

                return error.InvalidSelector;
            }
        };

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            // Start object "{"
            switch (try source.next()) {
                .object_begin => {},
                else => return error.InvalidJson,
            }

            // Read "selector" field
            const selector_key = switch (try source.next()) {
                .string => |str| str,
                else => return error.InvalidJson,
            };

            if (!std.mem.eql(u8, selector_key, "selector")) {
                return error.InvalidJson;
            }

            const selector: u8 = switch (try source.next()) {
                .string => |str| std.fmt.parseInt(u8, str, 10) catch return error.InvalidJson,
                else => return error.InvalidJson,
            };
            if (!isValidSelector(selector) or !isValidSelectorValue(selector)) {
                return error.InvalidSelector;
            }

            // Read "data" field
            const data_key = switch (try source.next()) {
                .string => |str| str,
                else => return error.InvalidJson,
            };

            if (!std.mem.eql(u8, data_key, "data")) {
                return error.InvalidJson;
            }

            // Deserialize data based on selector
            inline for (options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});

                    var replacement = @unionInit(Type, field_name, option_type.default_value);
                    errdefer deinit(allocator, &replacement);
                    const replacement_data_ptr = &@field(replacement, field_name);

                    if (comptime isFixedType(option_type)) {
                        try option_type.deserializeFromJson(source, replacement_data_ptr);
                    } else {
                        try option_type.deserializeFromJson(allocator, source, replacement_data_ptr);
                    }

                    // End object "}"
                    switch (try source.next()) {
                        .object_end => {},
                        else => return error.InvalidJson,
                    }
                    out.* = replacement;
                    return;
                }
            }
        }
    };
}

const UintType = @import("uint.zig").UintType;

test "CompatibleUnion - has no default value" {
    const Square = @import("container.zig").FixedContainerType(struct {
        side: UintType(16),
        color: UintType(8),
    });

    const Shape = CompatibleUnionType(.{
        .{ 1, Square },
        .{ 2, Square },
    });

    try std.testing.expect(!@hasDecl(Shape, "default_value"));
}

test "CompatibleUnion - basic square" {
    const Square = @import("container.zig").FixedContainerType(struct {
        side: UintType(16),
        color: UintType(8),
    });

    const Shape = CompatibleUnionType(.{
        .{ 1, Square },
        .{ 2, Square },
    });

    // Initialize the union properly with @unionInit
    var square_data = Square.default_value;
    square_data.side = 10;
    square_data.color = 5;

    var square_value: Shape.Type = @unionInit(Shape.Type, "option_1", square_data);

    // Test serialization
    var buf: [256]u8 = undefined;
    const size = Shape.serializeIntoBytes(&square_value, &buf);

    try std.testing.expectEqual(@as(usize, 4), size); // 1 selector + 2 side + 1 color
    try std.testing.expectEqual(@as(u8, 1), buf[0]); // selector

    // Test deserialization
    var deserialized: Shape.Type = undefined;
    try Shape.deserializeFromBytes(std.testing.allocator, buf[0..size], &deserialized);

    try std.testing.expectEqual(@as(u8, 1), Shape.getSelector(&deserialized));
    try std.testing.expectEqual(@as(u16, 10), deserialized.option_1.side);
    try std.testing.expectEqual(@as(u8, 5), deserialized.option_1.color);
}

test "CompatibleUnion - hash tree root with selector mix-in" {
    const Square = @import("container.zig").FixedContainerType(struct {
        side: UintType(16),
    });

    const Shape = CompatibleUnionType(.{
        .{ 1, Square },
    });

    // Initialize the union properly with @unionInit
    var square_data = Square.default_value;
    square_data.side = 10;

    var square_value: Shape.Type = @unionInit(Shape.Type, "option_1", square_data);

    var root: [32]u8 = undefined;
    try Shape.hashTreeRoot(std.testing.allocator, &square_value, &root);

    // The root should not be all zeros
    var all_zero = true;
    for (root) |byte| {
        if (byte != 0) {
            all_zero = false;
            break;
        }
    }
    try std.testing.expect(!all_zero);
}

test "CompatibleUnion - invalid selector rejected" {
    const Square = @import("container.zig").FixedContainerType(struct {
        side: UintType(16),
    });

    const Shape = CompatibleUnionType(.{
        .{ 1, Square },
    });

    // Try to deserialize with invalid selector (0)
    var buf = [_]u8{ 0, 10, 0 };
    var value: Shape.Type = undefined;

    const result = Shape.deserializeFromBytes(std.testing.allocator, &buf, &value);
    try std.testing.expectError(error.InvalidSelector, result);

    // Try to deserialize with invalid selector (128)
    buf[0] = 128;
    const result2 = Shape.deserializeFromBytes(std.testing.allocator, &buf, &value);
    try std.testing.expectError(error.InvalidSelector, result2);

    // Try to deserialize with selector not in options (2)
    buf[0] = 2;
    const result3 = Shape.deserializeFromBytes(std.testing.allocator, &buf, &value);
    try std.testing.expectError(error.InvalidSelector, result3);
}

test "CompatibleUnion - rejects options with incompatible Merkleization" {
    const Square = @import("container.zig").FixedContainerType(struct {
        side: UintType(16),
        color: UintType(8),
    });
    const Circle = @import("container.zig").FixedContainerType(struct {
        radius: UintType(16),
        color: UintType(8),
    });

    try std.testing.expect(!compatibleUnionOptionsAreCompatible(.{
        .{ 1, Square },
        .{ 2, Circle },
    }));
}

test {
    _ = @import("compatible_union_test.zig");
}
