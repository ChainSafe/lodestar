const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isFixedType = @import("type_kind.zig").isFixedType;
const isBasicType = @import("type_kind.zig").isBasicType;
const progressive = @import("progressive.zig");
const hashOne = @import("hashing").hashOne;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const Depth = @import("persistent_merkle_tree").Depth;

/// Pack active_fields bitvector into a 32-byte array (limited to 256 bits)
fn packActiveFields(comptime active_fields: []const u1) [32]u8 {
    var result = [_]u8{0} ** 32;
    for (active_fields, 0..) |bit, i| {
        if (bit == 1) {
            result[i / 8] |= @as(u8, 1) << @as(u3, @intCast(i % 8));
        }
    }
    return result;
}

/// Validates active_fields configuration at comptime
fn validateActiveFields(comptime active_fields: []const u1, comptime field_count: usize) void {
    // active_fields must not be empty
    if (active_fields.len == 0) {
        @compileError("active_fields cannot be empty");
    }

    // active_fields must not exceed 256 bits
    if (active_fields.len > 256) {
        @compileError("active_fields cannot exceed 256 entries");
    }

    // active_fields must not end in 0
    if (active_fields[active_fields.len - 1] == 0) {
        @compileError("active_fields cannot end in 0");
    }

    // count of 1s in active_fields must equal field_count
    var count: usize = 0;
    for (active_fields) |bit| {
        if (bit == 1) count += 1;
    }
    if (count != field_count) {
        @compileError("count of 1s in active_fields must equal number of fields");
    }
}

/// Returns the merkle tree index (position in active_fields) for the nth field
fn getActiveFieldIndex(comptime active_fields: []const u1, comptime n: usize) usize {
    var count: usize = 0;
    for (active_fields, 0..) |bit, i| {
        if (bit == 1) {
            if (count == n) {
                return i;
            }
            count += 1;
        }
    }
    @compileError("field index out of range");
}

/// Creates a progressive container type with only fixed-size fields.
///
/// Parameters:
///   - ST: A struct type containing only fixed-size SSZ fields
///   - active_fields: Bitvector indicating field positions in the Merkle tree
///
/// The active_fields bitvector determines where each field is placed in the Merkle tree.
/// A '1' at position i means that position is occupied; fields are assigned to positions
/// with '1' bits in order.
///
/// Example:
/// ```zig
/// const MyType = FixedProgressiveContainerType(struct {
///     field_a: UintType(8),
///     field_b: UintType(16),
/// }, &[_]u1{ 1, 0, 1 });
/// // field_a is at position 0, field_b is at position 2
/// ```
pub fn FixedProgressiveContainerType(comptime ST: type, comptime active_fields: []const u1) type {
    const ssz_fields = switch (@typeInfo(ST)) {
        .@"struct" => |s| s.fields,
        else => @compileError("Expected a struct type."),
    };

    // Validate active_fields configuration
    comptime validateActiveFields(active_fields, ssz_fields.len);

    // Validate that container has at least one field
    comptime {
        if (ssz_fields.len == 0) {
            @compileError("ProgressiveContainer with no fields is illegal");
        }
    }

    comptime var native_names: [ssz_fields.len][:0]const u8 = undefined;
    comptime var native_types: [ssz_fields.len]type = undefined;
    comptime var native_attrs: [ssz_fields.len]std.builtin.Type.StructField.Attributes = undefined;
    comptime var _offsets: [ssz_fields.len]usize = undefined;
    comptime var _fixed_size: usize = 0;
    inline for (ssz_fields, 0..) |field, i| {
        if (!comptime isFixedType(field.type)) {
            @compileError("FixedProgressiveContainerType must only contain fixed fields");
        }

        native_names[i] = field.name;
        native_types[i] = field.type.Type;
        native_attrs[i] = .{};
        _offsets[i] = _fixed_size;
        _fixed_size += field.type.fixed_size;
    }

    const T = @Struct(.auto, null, &native_names, &native_types, &native_attrs);

    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_container;
        pub const Fields: type = ST;
        pub const fields: []const std.builtin.Type.StructField = ssz_fields;
        pub const field_indices: [fields.len]usize = blk: {
            var indices: [fields.len]usize = undefined;
            for (0..fields.len) |i| {
                indices[i] = getActiveFieldIndex(active_fields, i);
            }
            break :blk indices;
        };
        pub const Type: type = T;
        pub const fixed_size: usize = _fixed_size;
        pub const field_offsets: [fields.len]usize = _offsets;
        pub const chunk_count: usize = active_fields.len;

        pub const default_value: Type = blk: {
            var out: Type = undefined;
            for (fields) |field| {
                @field(out, field.name) = field.type.default_value;
            }
            break :blk out;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            inline for (fields) |field| {
                if (!field.type.equals(&@field(a, field.name), &@field(b, field.name))) {
                    return false;
                }
            }
            return true;
        }

        /// Creates a new `FixedProgressiveContainerType` and clones all underlying fields in the container.
        ///
        /// Caller owns the memory.
        pub fn clone(value: *const Type, out: *Type) !void {
            out.* = value.*;
        }

        pub fn serializedSize(_: *const Type) usize {
            return fixed_size;
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(chunk_count);
            var next_index: usize = 0;
            inline for (fields, 0..) |field, i| {
                const field_idx = comptime getActiveFieldIndex(active_fields, i);
                while (next_index < field_idx) : (next_index += 1) {
                    try accumulator.append(&@as([32]u8, @splat(0)));
                }
                var chunk: [32]u8 = undefined;
                try field.type.hashTreeRoot(&@field(value, field.name), &chunk);
                try accumulator.append(&chunk);
                next_index += 1;
            }
            var content_root: [32]u8 = undefined;
            try accumulator.finish(&content_root);
            const active_fields_packed = comptime packActiveFields(active_fields);
            hashOne(out, &content_root, &active_fields_packed);
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var i: usize = 0;
            inline for (fields) |field| {
                const field_value_ptr = &@field(value, field.name);
                i += field.type.serializeIntoBytes(field_value_ptr, out[i..]);
            }
            return i;
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            if (data.len != fixed_size) {
                return error.InvalidSize;
            }
            var replacement = default_value;
            var i: usize = 0;
            inline for (fields) |field| {
                try field.type.deserializeFromBytes(
                    data[i .. i + field.type.fixed_size],
                    &@field(replacement, field.name),
                );
                i += field.type.fixed_size;
            }
            out.* = replacement;
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
                var i: usize = 0;
                inline for (fields) |field| {
                    try field.type.serialized.validate(data[i .. i + field.type.fixed_size]);
                    i += field.type.fixed_size;
                }
            }

            pub fn hashTreeRoot(data: []const u8, out: *[32]u8) !void {
                if (data.len != fixed_size) return error.InvalidSize;
                var offset: usize = 0;
                var accumulator = try progressive.MerkleAccumulator.init(chunk_count);
                var next_index: usize = 0;
                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    while (next_index < field_idx) : (next_index += 1) {
                        try accumulator.append(&@as([32]u8, @splat(0)));
                    }
                    var chunk: [32]u8 = undefined;
                    try field.type.serialized.hashTreeRoot(data[offset..][0..field.type.fixed_size], &chunk);
                    try accumulator.append(&chunk);
                    next_index += 1;
                    offset += field.type.fixed_size;
                }
                var content_root: [32]u8 = undefined;
                try accumulator.finish(&content_root);
                const active_fields_packed = comptime packActiveFields(active_fields);
                hashOne(out, &content_root, &active_fields_packed);
            }
        };

        pub const tree = struct {
            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                var nodes: [chunk_count]Node.Id = undefined;

                // Extract the active_fields mix-in node (get left child which is the content)
                const content_node = try node.getLeft(pool);

                try progressive.getNodes(pool, content_node, &nodes);

                var replacement = default_value;
                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    const child_node = nodes[field_idx];
                    try field.type.tree.toValue(
                        child_node,
                        pool,
                        &@field(replacement, field.name),
                    );
                }
                out.* = replacement;
            }

            pub fn serializedSize(_: Node.Id, _: *Node.Pool) !usize {
                return Self.fixed_size;
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                var value = Self.default_value;
                try toValue(node, pool, &value);
                return Self.serializeIntoBytes(&value, out);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                var value = Self.default_value;
                try Self.deserializeFromBytes(data, &value);
                return fromValue(pool, &value);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                var content_owns_nodes = false;
                errdefer if (!content_owns_nodes) pool.free(&nodes);

                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    const field_value = &@field(value, field.name);
                    nodes[field_idx] = try field.type.tree.fromValue(pool, field_value);
                }

                const content_tree = try progressive.fillWithContentsComptime(chunk_count, pool, &nodes);
                content_owns_nodes = true;
                errdefer pool.unref(content_tree);

                // Mix in active_fields
                const active_fields_packed = comptime packActiveFields(active_fields);
                const active_fields_node = try pool.createLeaf(&active_fields_packed);
                errdefer pool.unref(active_fields_node);

                return try pool.createBranch(content_tree, active_fields_node);
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            try writer.beginObject();
            inline for (fields) |field| {
                const field_value_ptr = &@field(in, field.name);
                try writer.objectField(field.name);
                try field.type.serializeIntoJson(writer, field_value_ptr);
            }
            try writer.endObject();
        }

        pub fn deserializeFromJson(source: *std.json.Scanner, out: *Type) !void {
            // start object token "{"
            switch (try source.next()) {
                .object_begin => {},
                else => return error.InvalidJson,
            }

            var replacement = default_value;
            inline for (fields) |field| {
                const field_name = switch (try source.next()) {
                    .string => |str| str,
                    else => return error.InvalidJson,
                };
                if (!std.mem.eql(u8, field_name, field.name)) {
                    return error.InvalidJson;
                }
                try field.type.deserializeFromJson(
                    source,
                    &@field(replacement, field.name),
                );
            }

            // end object token "}"
            switch (try source.next()) {
                .object_end => {},
                else => return error.InvalidJson,
            }
            out.* = replacement;
        }

        pub fn getFieldIndex(comptime name: []const u8) usize {
            inline for (fields, 0..) |field, i| {
                if (std.mem.eql(u8, name, field.name)) {
                    return i;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldType(comptime name: []const u8) type {
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return field.type;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldGindex(comptime name: []const u8) Gindex {
            const field_i = getFieldIndex(name);
            const field_idx = comptime getActiveFieldIndex(active_fields, field_i);
            return comptime progressive.chunkGindex(field_idx);
        }
    };
}

pub fn VariableProgressiveContainerType(comptime ST: type, comptime active_fields: []const u1) type {
    const ssz_fields = switch (@typeInfo(ST)) {
        .@"struct" => |s| s.fields,
        else => @compileError("Expected a struct type."),
    };

    // Validate active_fields configuration
    comptime validateActiveFields(active_fields, ssz_fields.len);

    // Validate that container has at least one field
    comptime {
        if (ssz_fields.len == 0) {
            @compileError("ProgressiveContainer with no fields is illegal");
        }
    }

    comptime var native_names: [ssz_fields.len][:0]const u8 = undefined;
    comptime var native_types: [ssz_fields.len]type = undefined;
    comptime var native_attrs: [ssz_fields.len]std.builtin.Type.StructField.Attributes = undefined;
    comptime var _offsets: [ssz_fields.len]usize = undefined;
    comptime var _min_size: usize = 0;
    comptime var _max_size: usize = 0;
    comptime var _fixed_end: usize = 0;
    comptime var _fixed_count: usize = 0;
    inline for (ssz_fields, 0..) |field, i| {
        _offsets[i] = _fixed_end;
        if (comptime isFixedType(field.type)) {
            _min_size += field.type.fixed_size;
            if (_max_size != std.math.maxInt(usize)) {
                _max_size += field.type.fixed_size;
            }
            _fixed_end += field.type.fixed_size;
            _fixed_count += 1;
        } else {
            _min_size += field.type.min_size + 4;
            // Handle unbounded types (max_size == maxInt(usize))
            if (field.type.max_size == std.math.maxInt(usize) or _max_size == std.math.maxInt(usize)) {
                _max_size = std.math.maxInt(usize);
            } else {
                _max_size += field.type.max_size + 4;
            }
            _fixed_end += 4;
        }

        native_names[i] = field.name;
        native_types[i] = field.type.Type;
        native_attrs[i] = .{};
    }

    comptime {
        if (_fixed_count == ssz_fields.len) {
            @compileError("expected at least one variable field type");
        }
    }

    const var_count = ssz_fields.len - _fixed_count;

    const T = @Struct(.auto, null, &native_names, &native_types, &native_attrs);

    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_container;
        pub const fields: []const std.builtin.Type.StructField = ssz_fields;
        pub const field_indices: [fields.len]usize = blk: {
            var indices: [fields.len]usize = undefined;
            for (0..fields.len) |i| {
                indices[i] = getActiveFieldIndex(active_fields, i);
            }
            break :blk indices;
        };
        pub const Fields: type = ST;
        pub const Type: type = T;
        pub const min_size: usize = _min_size;
        pub const max_size: usize = _max_size;
        pub const field_offsets: [fields.len]usize = _offsets;
        pub const fixed_end: usize = _fixed_end;
        pub const fixed_count: usize = _fixed_count;
        pub const chunk_count: usize = active_fields.len;

        pub const default_value: Type = blk: {
            var out: Type = undefined;
            for (fields) |field| {
                @field(out, field.name) = field.type.default_value;
            }
            break :blk out;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            inline for (fields) |field| {
                if (!field.type.equals(&@field(a, field.name), &@field(b, field.name))) {
                    return false;
                }
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            inline for (fields) |field| {
                if (!comptime isFixedType(field.type)) {
                    field.type.deinit(allocator, &@field(value, field.name));
                }
            }
        }

        pub fn hashTreeRoot(allocator: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(chunk_count);
            var next_index: usize = 0;
            inline for (fields, 0..) |field, i| {
                const field_idx = comptime getActiveFieldIndex(active_fields, i);
                while (next_index < field_idx) : (next_index += 1) {
                    try accumulator.append(&@as([32]u8, @splat(0)));
                }
                var chunk: [32]u8 = undefined;
                if (comptime isFixedType(field.type)) {
                    try field.type.hashTreeRoot(&@field(value, field.name), &chunk);
                } else {
                    try field.type.hashTreeRoot(allocator, &@field(value, field.name), &chunk);
                }
                try accumulator.append(&chunk);
                next_index += 1;
            }
            var content_root: [32]u8 = undefined;
            try accumulator.finish(&content_root);
            const active_fields_packed = comptime packActiveFields(active_fields);
            hashOne(out, &content_root, &active_fields_packed);
        }

        /// Creates a new `VariableProgressiveContainerType` and clones all underlying fields in the container.
        ///
        /// Caller owns the memory.
        pub fn clone(
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *Type,
        ) !void {
            var replacement = default_value;
            errdefer deinit(allocator, &replacement);
            inline for (fields) |field| {
                if (comptime isFixedType(field.type)) {
                    try field.type.clone(
                        &@field(value, field.name),
                        &@field(replacement, field.name),
                    );
                } else {
                    try field.type.clone(
                        allocator,
                        &@field(value, field.name),
                        &@field(replacement, field.name),
                    );
                }
            }
            out.* = replacement;
        }

        pub fn serializedSize(value: *const Type) usize {
            var i: usize = 0;
            inline for (fields) |field| {
                if (comptime isFixedType(field.type)) {
                    i += field.type.fixed_size;
                } else {
                    i += 4 + field.type.serializedSize(&@field(value, field.name));
                }
            }
            return i;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var fixed_index: usize = 0;
            var variable_index: usize = fixed_end;
            inline for (fields) |field| {
                if (comptime isFixedType(field.type)) {
                    // write field value
                    fixed_index += field.type.serializeIntoBytes(&@field(value, field.name), out[fixed_index..]);
                } else {
                    // write offset
                    std.mem.writeInt(u32, out[fixed_index..][0..4], @intCast(variable_index), .little);
                    fixed_index += 4;
                    // write field value
                    variable_index += field.type.serializeIntoBytes(&@field(value, field.name), out[variable_index..]);
                }
            }
            return variable_index;
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            if (data.len > max_size or data.len < min_size) {
                return error.InvalidSize;
            }

            const ranges = try readFieldRanges(data);

            var replacement = default_value;
            errdefer deinit(allocator, &replacement);
            inline for (fields, 0..) |field, i| {
                if (comptime isFixedType(field.type)) {
                    try field.type.deserializeFromBytes(
                        data[ranges[i][0]..ranges[i][1]],
                        &@field(replacement, field.name),
                    );
                } else {
                    try field.type.deserializeFromBytes(
                        allocator,
                        data[ranges[i][0]..ranges[i][1]],
                        &@field(replacement, field.name),
                    );
                }
            }

            out.* = replacement;
        }

        pub fn getFieldIndex(comptime name: []const u8) usize {
            inline for (fields, 0..) |field, i| {
                if (std.mem.eql(u8, name, field.name)) {
                    return i;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldType(comptime name: []const u8) type {
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return field.type;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldGindex(comptime name: []const u8) Gindex {
            const field_i = getFieldIndex(name);
            const field_idx = comptime getActiveFieldIndex(active_fields, field_i);
            return comptime progressive.chunkGindex(field_idx);
        }

        // Returns the bytes ranges of all fields, both variable and fixed size.
        // Fields may not be contiguous in the serialized bytes, so the returned ranges are [start, end].
        pub fn readFieldRanges(data: []const u8) ![fields.len][2]usize {
            var ranges: [fields.len][2]usize = undefined;
            var offsets: [var_count + 1]u32 = undefined;
            try readVariableOffsets(data, &offsets);

            var fixed_index: usize = 0;
            var variable_index: usize = 0;
            inline for (fields, 0..) |field, i| {
                if (comptime isFixedType(field.type)) {
                    ranges[i] = [2]usize{ fixed_index, fixed_index + field.type.fixed_size };
                    fixed_index += field.type.fixed_size;
                } else {
                    ranges[i] = [2]usize{ offsets[variable_index], offsets[variable_index + 1] };
                    variable_index += 1;
                    fixed_index += 4;
                }
            }

            return ranges;
        }

        fn readVariableOffsets(data: []const u8, offsets: []u32) !void {
            var variable_index: usize = 0;
            var fixed_index: usize = 0;
            inline for (fields) |field| {
                if (comptime isFixedType(field.type)) {
                    fixed_index += field.type.fixed_size;
                } else {
                    const offset = std.mem.readInt(u32, data[fixed_index..][0..4], .little);
                    if (offset > data.len) {
                        return error.offsetOutOfRange;
                    }
                    if (variable_index == 0) {
                        if (offset != fixed_end) {
                            return error.offsetOutOfRange;
                        }
                    } else {
                        if (offset < offsets[variable_index - 1]) {
                            return error.offsetNotIncreasing;
                        }
                    }

                    offsets[variable_index] = offset;
                    variable_index += 1;
                    fixed_index += 4;
                }
            }
            // set 1 more at the end of the last variable field so that each variable field can consume 2 offsets
            offsets[variable_index] = @intCast(data.len);
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len > max_size or data.len < min_size) {
                    return error.InvalidSize;
                }

                const ranges = try readFieldRanges(data);
                inline for (fields, 0..) |field, i| {
                    const start = ranges[i][0];
                    const end = ranges[i][1];
                    try field.type.serialized.validate(data[start..end]);
                }
            }

            pub fn hashTreeRoot(allocator: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                if (data.len > max_size or data.len < min_size) return error.InvalidSize;
                const ranges = try readFieldRanges(data);
                var accumulator = try progressive.MerkleAccumulator.init(chunk_count);
                var next_index: usize = 0;
                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    while (next_index < field_idx) : (next_index += 1) {
                        try accumulator.append(&@as([32]u8, @splat(0)));
                    }
                    var chunk: [32]u8 = undefined;
                    if (comptime isFixedType(field.type)) {
                        try field.type.serialized.hashTreeRoot(data[ranges[i][0]..ranges[i][1]], &chunk);
                    } else {
                        try field.type.serialized.hashTreeRoot(allocator, data[ranges[i][0]..ranges[i][1]], &chunk);
                    }
                    try accumulator.append(&chunk);
                    next_index += 1;
                }
                var content_root: [32]u8 = undefined;
                try accumulator.finish(&content_root);
                const active_fields_packed = comptime packActiveFields(active_fields);
                hashOne(out, &content_root, &active_fields_packed);
            }
        };

        pub const tree = struct {
            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);

                // Extract the active_fields mix-in node (get left child which is the content)
                const content_node = try node.getLeft(pool);

                try progressive.getNodes(pool, content_node, nodes);

                var replacement = default_value;
                errdefer deinit(allocator, &replacement);
                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    const child_node = nodes[field_idx];
                    if (comptime isFixedType(field.type)) {
                        try field.type.tree.toValue(
                            child_node,
                            pool,
                            &@field(replacement, field.name),
                        );
                    } else {
                        try field.type.tree.toValue(
                            allocator,
                            child_node,
                            pool,
                            &@field(replacement, field.name),
                        );
                    }
                }

                out.* = replacement;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const allocator = pool.allocator;
                var value = Self.default_value;
                defer Self.deinit(allocator, &value);

                try toValue(allocator, node, pool, &value);
                return Self.serializedSize(&value);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const allocator = pool.allocator;
                var value = Self.default_value;
                defer Self.deinit(allocator, &value);

                try toValue(allocator, node, pool, &value);
                return Self.serializeIntoBytes(&value, out);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                const allocator = pool.allocator;
                var value = Self.default_value;
                defer Self.deinit(allocator, &value);

                try Self.deserializeFromBytes(allocator, data, &value);
                return fromValue(pool, &value);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const allocator = pool.allocator;
                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);
                @memset(nodes, @as(Node.Id, @enumFromInt(0)));
                var content_owns_nodes = false;
                errdefer if (!content_owns_nodes) pool.free(nodes);

                inline for (fields, 0..) |field, i| {
                    const field_idx = comptime getActiveFieldIndex(active_fields, i);
                    const field_value = &@field(value, field.name);
                    nodes[field_idx] = try field.type.tree.fromValue(pool, field_value);
                }

                const content_tree = try progressive.fillWithContents(allocator, pool, nodes);
                content_owns_nodes = true;
                errdefer pool.unref(content_tree);

                // Mix in active_fields
                const active_fields_packed = comptime packActiveFields(active_fields);
                const active_fields_node = try pool.createLeaf(&active_fields_packed);
                errdefer pool.unref(active_fields_node);

                return try pool.createBranch(content_tree, active_fields_node);
            }
        };

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            try writer.beginObject();
            inline for (fields) |field| {
                const field_value_ptr = &@field(in, field.name);
                try writer.objectField(field.name);
                if (comptime isFixedType(field.type)) {
                    try field.type.serializeIntoJson(writer, field_value_ptr);
                } else {
                    try field.type.serializeIntoJson(allocator, writer, field_value_ptr);
                }
            }
            try writer.endObject();
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            // start object token "{"
            switch (try source.next()) {
                .object_begin => {},
                else => return error.InvalidJson,
            }

            var replacement = default_value;
            errdefer deinit(allocator, &replacement);
            inline for (fields) |field| {
                const field_name = switch (try source.next()) {
                    .string => |str| str,
                    else => return error.InvalidJson,
                };
                if (!std.mem.eql(u8, field_name, field.name)) {
                    return error.InvalidJson;
                }

                if (comptime isFixedType(field.type)) {
                    try field.type.deserializeFromJson(
                        source,
                        &@field(replacement, field.name),
                    );
                } else {
                    try field.type.deserializeFromJson(
                        allocator,
                        source,
                        &@field(replacement, field.name),
                    );
                }
            }

            // end object token "}"
            switch (try source.next()) {
                .object_end => {},
                else => return error.InvalidJson,
            }

            out.* = replacement;
        }
    };
}

const BoolType = @import("bool.zig").BoolType;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;

test {
    _ = @import("progressive_container_test.zig");
}
