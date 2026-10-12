const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;

const isFixedType = @import("type_kind.zig").isFixedType;
const isBasicType = @import("type_kind.zig").isBasicType;

const merkleize = @import("hashing").merkleize;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;

const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;
const Depth = pmt.Depth;
const ContainerTreeView = @import("../tree_view/root.zig").ContainerTreeView;
const StructContainerTreeView = @import("../tree_view/root.zig").StructContainerTreeView;

pub fn FixedContainerType(comptime ST: type) type {
    const ssz_fields = switch (@typeInfo(ST)) {
        .@"struct" => |s| s.fields,
        else => @compileError("Expected a struct type."),
    };

    comptime var native_names: [ssz_fields.len][:0]const u8 = undefined;
    comptime var native_types: [ssz_fields.len]type = undefined;
    comptime var native_attrs: [ssz_fields.len]std.builtin.Type.StructField.Attributes = undefined;
    comptime var _offsets: [ssz_fields.len]usize = undefined;
    comptime var _fixed_size: usize = 0;
    inline for (ssz_fields, 0..) |field, i| {
        if (!comptime isFixedType(field.type)) {
            @compileError("FixedContainerType must only contain fixed fields");
        }

        native_names[i] = field.name;
        native_types[i] = field.type.Type;
        native_attrs[i] = .{};
        _offsets[i] = _fixed_size;
        _fixed_size += field.type.fixed_size;
    }

    const T = @Struct(.auto, null, &native_names, &native_types, &native_attrs);

    return struct {
        pub const kind = TypeKind.container;
        pub const Fields: type = ST;
        pub const fields: []const std.builtin.Type.StructField = ssz_fields;
        pub const Type: type = T;
        pub const TreeView: type = ContainerTreeView(@This());
        pub const fixed_size: usize = _fixed_size;
        pub const field_offsets: [fields.len]usize = _offsets;
        pub const chunk_count: usize = fields.len;
        pub const chunk_depth: Depth = maxChunksToDepth(chunk_count);

        pub const default_value: Type = blk: {
            var out: Type = undefined;
            for (fields) |field| {
                @field(out, field.name) = field.type.default_value;
            }
            break :blk out;
        };

        pub const default_root: [32]u8 = blk: {
            var buf: [32]u8 = undefined;
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            for (fields, 0..) |field, i| {
                @memcpy(&chunks[i], &field.type.default_root);
            }
            merkleize(@ptrCast(&chunks), chunk_depth, &buf) catch unreachable;
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            inline for (fields) |field| {
                if (!field.type.equals(&@field(a, field.name), &@field(b, field.name))) {
                    return false;
                }
            }
            return true;
        }

        /// Creates a new `FixedContainerType` and clones all underlying fields in the container.
        /// `out` is a pointer to any types that contains all fields of `Type`.
        /// Caller owns the memory.
        pub fn clone(value: *const Type, out: anytype) !void {
            const OutType = @TypeOf(out.*);
            comptime {
                const OutInfo = @typeInfo(@TypeOf(out));
                std.debug.assert(OutInfo == .pointer);
            }
            if (OutType == Type) {
                out.* = value.*;
            } else {
                inline for (fields) |field| {
                    @field(out, field.name) = @field(value, field.name);
                }
            }
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            inline for (fields, 0..) |field, i| {
                try field.type.hashTreeRoot(&@field(value, field.name), &chunks[i]);
            }
            try merkleize(@ptrCast(&chunks), chunk_depth, out);
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
            var i: usize = 0;
            inline for (fields) |field| {
                try field.type.deserializeFromBytes(data[i .. i + field.type.fixed_size], &@field(out, field.name));
                i += field.type.fixed_size;
            }
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
                var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                var i: usize = 0;
                inline for (fields, 0..) |field, field_i| {
                    try field.type.serialized.hashTreeRoot(data[i .. i + field.type.fixed_size], &chunks[field_i]);
                    i += field.type.fixed_size;
                }
                try merkleize(@ptrCast(&chunks), chunk_depth, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);
                inline for (fields, 0..) |field, i| {
                    if (comptime isBasicType(field.type)) {
                        nodes[i] = @enumFromInt(0);
                    } else {
                        nodes[i] = try field.type.tree.default(pool);
                    }
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }

                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);
                var offset: usize = 0;

                inline for (fields, 0..) |field, i| {
                    const field_bytes = data[offset .. offset + field.type.fixed_size];
                    offset += field.type.fixed_size;

                    nodes[i] = try field.type.tree.deserializeFromBytes(pool, field_bytes);
                }

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);
                inline for (fields, 0..) |field, i| {
                    const child_node = nodes[i];
                    try field.type.tree.toValue(child_node, pool, &@field(out, field.name));
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                inline for (fields, 0..) |field, i| {
                    const field_value = &@field(value, field.name);
                    nodes[i] = try field.type.tree.fromValue(pool, field_value);
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                var offset: usize = 0;
                inline for (fields, 0..) |field, i| {
                    offset += try field.type.tree.serializeIntoBytes(nodes[i], pool, out[offset..]);
                }
                return offset;
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
                    &@field(out, field.name),
                );
            }

            // end object token "}"
            switch (try source.next()) {
                .object_end => {},
                else => return error.InvalidJson,
            }
        }

        pub fn getFieldIndex(comptime name: []const u8) usize {
            comptime {
                @setEvalBranchQuota(20000);
            }
            inline for (fields, 0..) |field, i| {
                if (std.mem.eql(u8, name, field.name)) {
                    return i;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn hasField(comptime name: []const u8) bool {
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return true;
                }
            }
            return false;
        }

        pub fn getFieldType(comptime name: []const u8) type {
            comptime {
                @setEvalBranchQuota(20000);
            }
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return field.type;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldGindex(comptime name: []const u8) Gindex {
            const field_index = getFieldIndex(name);
            return comptime Gindex.fromDepth(chunk_depth, field_index);
        }
    };
}

/// A fixed-size container whose tree representation is a single
/// `.container_struct` Node (vtable + cached deserialized struct), instead of a
/// merkleized subtree of leaf chunks.
///
/// This trades a ~50% reduction in struct-decode work (no per-field tree
/// walk + leaf re-decode) for opaque tree navigation: gindex paths into the
/// container's interior are not navigable. Use this for hot-path types where
/// callers consume the whole struct (e.g. `validatorsSlice`).
///
/// Wraps an underlying `FixedContainerType(ST)` and re-exports its
/// merkleization, serialization, JSON, and field metadata. The differences
/// live entirely in the `tree` namespace, which routes through
/// `Pool.createContainerStruct` / `Pool.getStructPtr`.
pub fn StructContainerType(comptime ST: type) type {
    const FixedCT = FixedContainerType(ST);

    return struct {
        pub const kind = TypeKind.container;
        pub const Fields: type = ST;
        pub const fields: []const std.builtin.Type.StructField = FixedCT.fields;
        pub const Type: type = FixedCT.Type;
        pub const TreeView: type = StructContainerTreeView(@This());
        pub const fixed_size: usize = FixedCT.fixed_size;
        pub const field_offsets: [fields.len]usize = FixedCT.field_offsets;
        pub const chunk_count: usize = fields.len;
        pub const chunk_depth: Depth = maxChunksToDepth(chunk_count);
        pub const default_value: Type = FixedCT.default_value;
        pub const default_root: [32]u8 = FixedCT.default_root;
        pub const serialized = FixedCT.serialized;
        const Self = @This();

        /// Wrapper that satisfies the ContainerStructRef vtable contract.
        ///
        /// `value` is the full deserialized struct (cached at the leaf-Node
        /// level). The Pool clones via `init` and frees via `deinit`. Root
        /// computation merkleizes the wrapped value via `FixedCT.hashTreeRoot`.
        pub const WrappedT = struct {
            value: Type,

            pub fn getRoot(self: *const WrappedT, out: *[32]u8) void {
                FixedCT.hashTreeRoot(&self.value, out) catch unreachable;
            }

            /// Materialize a temporary navigable PMT subtree representing this
            /// container's full hash-tree. Used by proof traversal — see
            /// `Pool.materializeContainerStruct`. The returned Id has refcount=0;
            /// the caller is responsible for `unref`'ing it.
            pub fn toTree(self: *const WrappedT, pool: *Node.Pool) !Node.Id {
                return try FixedCT.tree.fromValue(pool, &self.value);
            }

            pub fn init(allocator: std.mem.Allocator, wrapped: *const WrappedT) !*const WrappedT {
                const ptr = try allocator.create(WrappedT);
                errdefer allocator.destroy(ptr);
                try FixedCT.clone(&wrapped.value, &ptr.value);
                return ptr;
            }

            pub fn deinit(self: *WrappedT, allocator: std.mem.Allocator) void {
                allocator.destroy(self);
            }
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            return FixedCT.equals(a, b);
        }

        pub fn clone(value: *const Type, out: anytype) !void {
            return FixedCT.clone(value, out);
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            return FixedCT.hashTreeRoot(value, out);
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            return FixedCT.serializeIntoBytes(value, out);
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            return FixedCT.deserializeFromBytes(data, out);
        }

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                const wrapped = WrappedT{ .value = default_value };
                return try pool.createContainerStruct(WrappedT, &wrapped);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
                var wrapped: WrappedT = undefined;
                try Self.deserializeFromBytes(data, &wrapped.value);
                return try pool.createContainerStruct(WrappedT, &wrapped);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const wrapped = try pool.getStructPtr(node, WrappedT);
                try Self.clone(&wrapped.value, out);
            }

            /// Returns a read-only pointer to the value stored in a
            /// `.container_struct` node, with no copy. The pointer is valid
            /// as long as the node's refcount is held and the value isn't
            /// replaced via CoW. Caller must not retain the pointer past
            /// any mutation of the same validator slot.
            pub fn getValuePtr(node: Node.Id, pool: *Node.Pool) !*const Type {
                const wrapped = try pool.getStructPtr(node, WrappedT);
                return &wrapped.value;
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const wrapped = WrappedT{ .value = value.* };
                return try pool.createContainerStruct(WrappedT, &wrapped);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const wrapped = try pool.getStructPtr(node, WrappedT);
                return Self.serializeIntoBytes(&wrapped.value, out);
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            return FixedCT.serializeIntoJson(writer, in);
        }

        pub fn deserializeFromJson(source: *std.json.Scanner, out: *Type) !void {
            return FixedCT.deserializeFromJson(source, out);
        }

        pub fn getFieldIndex(comptime name: []const u8) usize {
            return FixedCT.getFieldIndex(name);
        }

        pub fn hasField(comptime name: []const u8) bool {
            return FixedCT.hasField(name);
        }

        pub fn getFieldType(comptime name: []const u8) type {
            return FixedCT.getFieldType(name);
        }

        pub fn getFieldGindex(comptime name: []const u8) Gindex {
            return FixedCT.getFieldGindex(name);
        }
    };
}

pub fn VariableContainerType(comptime ST: type) type {
    const ssz_fields = switch (@typeInfo(ST)) {
        .@"struct" => |s| s.fields,
        else => @compileError("Expected a struct type."),
    };

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
            @compileError("expected at least one fixed field type");
        }
    }

    const var_count = ssz_fields.len - _fixed_count;

    const T = @Struct(.auto, null, &native_names, &native_types, &native_attrs);

    return struct {
        pub const kind = TypeKind.container;
        pub const fields: []const std.builtin.Type.StructField = ssz_fields;
        pub const Fields: type = ST;
        pub const Type: type = T;
        pub const TreeView: type = ContainerTreeView(@This());
        pub const min_size: usize = _min_size;
        pub const max_size: usize = _max_size;
        pub const field_offsets: [fields.len]usize = _offsets;
        pub const fixed_end: usize = _fixed_end;
        pub const fixed_count: usize = _fixed_count;
        pub const chunk_count: usize = fields.len;
        pub const chunk_depth: u8 = maxChunksToDepth(chunk_count);

        pub const default_value: Type = blk: {
            var out: Type = undefined;
            for (fields) |field| {
                @field(out, field.name) = field.type.default_value;
            }
            break :blk out;
        };

        pub const default_root: [32]u8 = blk: {
            var buf: [32]u8 = undefined;
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            for (fields, 0..) |field, i| {
                @memcpy(&chunks[i], &field.type.default_root);
            }
            merkleize(@ptrCast(&chunks), chunk_depth, &buf) catch unreachable;
            break :blk buf;
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
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            inline for (fields, 0..) |field, i| {
                if (comptime isFixedType(field.type)) {
                    try field.type.hashTreeRoot(&@field(value, field.name), &chunks[i]);
                } else {
                    try field.type.hashTreeRoot(allocator, &@field(value, field.name), &chunks[i]);
                }
            }
            try merkleize(@ptrCast(&chunks), chunk_depth, out);
        }

        /// The caller initializes `out` with `default_value`; this uses `cloneInto`'s contract.
        pub fn clone(
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *Type,
        ) !void {
            return cloneInto(@This(), allocator, value, out);
        }

        /// The caller initializes `out` with `DestinationST.default_value` and deinitializes it
        /// after success or error. Errors leave `out` safe to deinitialize.
        pub fn cloneInto(
            comptime DestinationST: type,
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *DestinationST.Type,
        ) !void {
            inline for (fields) |field| {
                if (comptime isFixedType(field.type)) {
                    try field.type.clone(&@field(value, field.name), &@field(out, field.name));
                } else {
                    try field.type.cloneInto(
                        DestinationST.getFieldType(field.name),
                        allocator,
                        &@field(value, field.name),
                        &@field(out, field.name),
                    );
                }
            }
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

            inline for (fields, 0..) |field, i| {
                if (comptime isFixedType(field.type)) {
                    try field.type.deserializeFromBytes(
                        data[ranges[i][0]..ranges[i][1]],
                        &@field(out, field.name),
                    );
                } else {
                    try field.type.deserializeFromBytes(
                        allocator,
                        data[ranges[i][0]..ranges[i][1]],
                        &@field(out, field.name),
                    );
                }
            }
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

        pub fn hasField(comptime name: []const u8) bool {
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return true;
                }
            }
            return false;
        }

        pub fn getFieldType(comptime name: []const u8) type {
            @setEvalBranchQuota(20000);
            inline for (fields) |field| {
                if (std.mem.eql(u8, name, field.name)) {
                    return field.type;
                }
            } else {
                @compileError("field does not exist");
            }
        }

        pub fn getFieldGindex(comptime name: []const u8) Gindex {
            const field_index = getFieldIndex(name);
            return comptime Gindex.fromDepth(chunk_depth, field_index);
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
                var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                const ranges = try readFieldRanges(data);

                inline for (fields, 0..) |field, i| {
                    if (comptime isFixedType(field.type)) {
                        try field.type.serialized.hashTreeRoot(
                            data[ranges[i][0]..ranges[i][1]],
                            &chunks[i],
                        );
                    } else {
                        try field.type.serialized.hashTreeRoot(
                            allocator,
                            data[ranges[i][0]..ranges[i][1]],
                            &chunks[i],
                        );
                    }
                }

                try merkleize(@ptrCast(&chunks), chunk_depth, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);
                inline for (fields, 0..) |field, i| {
                    if (comptime isBasicType(field.type)) {
                        nodes[i] = @enumFromInt(0);
                    } else {
                        nodes[i] = try field.type.tree.default(pool);
                    }
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len > max_size or data.len < min_size) {
                    return error.InvalidSize;
                }

                const ranges = try readFieldRanges(data);
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                inline for (fields, 0..) |field, i| {
                    const start = ranges[i][0];
                    const end = ranges[i][1];
                    const field_bytes = data[start..end];

                    nodes[i] = try field.type.tree.deserializeFromBytes(pool, field_bytes);
                }

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);
                inline for (fields, 0..) |field, i| {
                    const child_node = nodes[i];
                    if (comptime isFixedType(field.type)) {
                        try field.type.tree.toValue(child_node, pool, &@field(out, field.name));
                    } else {
                        try field.type.tree.toValue(allocator, child_node, pool, &@field(out, field.name));
                    }
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                inline for (fields, 0..) |field, i| {
                    const field_value = &@field(value, field.name);
                    nodes[i] = try field.type.tree.fromValue(pool, field_value);
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                var fixed_index: usize = 0;
                var variable_index: usize = fixed_end;

                inline for (fields, 0..) |field, i| {
                    if (comptime isFixedType(field.type)) {
                        fixed_index += try field.type.tree.serializeIntoBytes(nodes[i], pool, out[fixed_index..]);
                    } else {
                        std.mem.writeInt(u32, out[fixed_index..][0..4], @intCast(variable_index), .little);
                        fixed_index += 4;
                        variable_index += try field.type.tree.serializeIntoBytes(nodes[i], pool, out[variable_index..]);
                    }
                }
                return variable_index;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                var total_size: usize = 0;
                inline for (fields, 0..) |field, i| {
                    if (comptime isFixedType(field.type)) {
                        total_size += field.type.fixed_size;
                    } else {
                        total_size += 4 + try field.type.tree.serializedSize(nodes[i], pool);
                    }
                }
                return total_size;
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
                        &@field(out, field.name),
                    );
                } else {
                    try field.type.deserializeFromJson(
                        allocator,
                        source,
                        &@field(out, field.name),
                    );
                }
            }

            // end object token "}"
            switch (try source.next()) {
                .object_end => {},
                else => return error.InvalidJson,
            }
        }
    };
}

test {
    _ = @import("container_test.zig");
}
