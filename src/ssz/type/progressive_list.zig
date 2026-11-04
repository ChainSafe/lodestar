const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isBasicType = @import("type_kind.zig").isBasicType;
const isFixedType = @import("type_kind.zig").isFixedType;
const canMemcpySsz = @import("type_kind.zig").canMemcpySsz;
const VariableElementIterator = @import("variable_element_iterator.zig").VariableElementIterator;
const initValue = @import("value_init.zig").initValue;
const mixInLength = @import("hashing").mixInLength;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const Depth = @import("hashing").Depth;
const Node = @import("persistent_merkle_tree").Node;
const ChunkedLeaf = @import("persistent_merkle_tree").ChunkedLeaf;
const progressive = @import("progressive.zig");
const chunk_utils = @import("chunk.zig");
/// Progressive merkleization has no length bound. `limit` carries the bound the consensus rules
/// give each progressive list, so decoding and growth can reject longer inputs; it defaults to
/// unbounded.
pub const TypeOpts = struct {
    chunked_leaf: bool = false,
    limit: usize = std.math.maxInt(usize),
};

pub fn FixedProgressiveListType(comptime ST: type, comptime _opts: TypeOpts) type {
    comptime {
        if (!isFixedType(ST)) {
            @compileError("ST must be fixed type");
        }
        if (_opts.chunked_leaf and !isBasicType(ST)) {
            @compileError("chunked_leaf requires basic elements");
        }
        if (_opts.limit == 0) {
            @compileError("limit must be greater than 0");
        }
    }

    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_list;
        pub const Element: type = ST;
        pub const opts: TypeOpts = _opts;
        const use_chunked_leaf = _opts.chunked_leaf;
        const items_per_chunk = 32 / Element.fixed_size;
        /// `opts.limit`, capped by the longest list a node-backed tree can address. It bounds decoding
        /// and growth but not merkleization.
        pub const limit: usize = @intCast(@min(
            opts.limit,
            @as(u128, progressive.max_node_chunks) * (if (isBasicType(Element)) items_per_chunk else 1),
            std.math.maxInt(usize) / Element.fixed_size,
        ));
        pub const Type: type = std.ArrayList(Element.Type);
        pub const TreeView = if (isBasicType(Element))
            @import("../tree_view/progressive_list_basic.zig").ProgressiveListBasicTreeView(@This())
        else
            @import("../tree_view/progressive_list_composite.zig").ProgressiveListCompositeTreeView(@This());
        pub const min_size: usize = 0;
        pub const max_size: usize = if (opts.limit == std.math.maxInt(usize))
            std.math.maxInt(usize)
        else
            limit * Element.fixed_size;

        pub const default_value: Type = Type.empty;
        pub const default_root: [32]u8 = @import("hashing").getZeroHash(1).*;

        pub fn equals(a: *const Type, b: *const Type) bool {
            if (a.items.len != b.items.len) return false;
            for (a.items, b.items) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) return false;
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            value.deinit(allocator);
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or
        /// error.
        pub fn clone(allocator: std.mem.Allocator, value: *const Type, out: *Type) !void {
            return cloneInto(@This(), allocator, value, out);
        }

        /// Initialize `out` with `DestinationST.default_value`; the caller deinitializes it after
        /// success or error.
        pub fn cloneInto(
            comptime DestinationST: type,
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *DestinationST.Type,
        ) !void {
            try out.ensureTotalCapacity(allocator, value.items.len);
            for (value.items) |*element| {
                out.appendAssumeCapacity(DestinationST.Element.default_value);
                try Element.clone(element, &out.items[out.items.len - 1]);
            }
        }

        pub fn chunkCount(value: *const Type) usize {
            return chunkCountForLength(value.items.len);
        }

        fn chunkCountForLength(len: usize) usize {
            if (comptime isBasicType(Element)) {
                return len / items_per_chunk + @intFromBool(len % items_per_chunk != 0);
            } else return len;
        }

        fn packBasicChunk(elements: []const Element.Type) [32]u8 {
            std.debug.assert(elements.len <= 32 / Element.fixed_size);
            var chunk: [32]u8 = @splat(0);
            for (elements, 0..) |*element, i| {
                _ = Element.serializeIntoBytes(element, chunk[i * Element.fixed_size ..][0..Element.fixed_size]);
            }
            return chunk;
        }

        pub fn hashTreeRoot(_: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(chunkCount(value));
            if (comptime isBasicType(Element)) {
                var chunks = std.mem.window(Element.Type, value.items, items_per_chunk, items_per_chunk);
                while (chunks.next()) |elements| {
                    const chunk = packBasicChunk(elements);
                    try accumulator.append(&chunk);
                }
            } else {
                for (value.items) |*element| {
                    var chunk: [32]u8 = undefined;
                    try Element.hashTreeRoot(element, &chunk);
                    try accumulator.append(&chunk);
                }
            }
            try accumulator.finish(out);
            mixInLength(value.items.len, out);
        }

        pub fn serializedSize(value: *const Type) usize {
            return value.items.len * Element.fixed_size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var i: usize = 0;
            for (value.items) |element| {
                i += Element.serializeIntoBytes(&element, out[i..]);
            }
            return i;
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            if (data.len % Element.fixed_size != 0) {
                return error.InvalidSSZ;
            }

            const len = data.len / Element.fixed_size;
            if (len > limit) return error.LengthOverLimit;

            try out.resize(allocator, len);
            @memset(out.items, Element.default_value);
            for (0..len) |i| {
                try Element.deserializeFromBytes(
                    data[i * Element.fixed_size .. (i + 1) * Element.fixed_size],
                    &out.items[i],
                );
            }
        }

        pub fn serializeIntoJson(_: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            try writer.beginArray();
            for (in.items) |element| {
                try Element.serializeIntoJson(writer, &element);
            }
            try writer.endArray();
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            while ((try source.peekNextTokenType()) != .array_end) {
                if (out.items.len == limit) return error.LengthOverLimit;
                try out.append(allocator, Element.default_value);
                try Element.deserializeFromJson(source, &out.items[out.items.len - 1]);
            }
            _ = try source.next();
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                const len = try length(data);
                for (0..len) |i| {
                    try Element.serialized.validate(data[i * Element.fixed_size .. (i + 1) * Element.fixed_size]);
                }
            }

            pub fn length(data: []const u8) !usize {
                const len = std.math.divExact(usize, data.len, Element.fixed_size) catch {
                    return error.InvalidSSZ;
                };
                if (len > limit) return error.LengthOverLimit;
                return len;
            }

            pub fn hashTreeRoot(_: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                const len = try length(data);
                var accumulator = try progressive.MerkleAccumulator.init(chunkCountForLength(len));
                if (comptime isBasicType(Element)) {
                    var chunks = std.mem.window(u8, data, 32, 32);
                    while (chunks.next()) |bytes| {
                        const chunk = chunk_utils.fromBytes(bytes);
                        try accumulator.append(&chunk);
                    }
                } else {
                    for (0..len) |i| {
                        var chunk: [32]u8 = undefined;
                        try Element.serialized.hashTreeRoot(data[i * Element.fixed_size ..][0..Element.fixed_size], &chunk);
                        try accumulator.append(&chunk);
                    }
                }
                try accumulator.finish(out);
                mixInLength(len, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                return try pool.createBranch(@enumFromInt(0), @enumFromInt(0));
            }

            /// Returns `len` zero elements without materializing them.
            pub fn zeros(pool: *Node.Pool, len: usize) !Node.Id {
                comptime std.debug.assert(isBasicType(Element));
                if (len > limit) return error.LengthOverLimit;
                var contents: Node.Id = @enumFromInt(0);
                errdefer pool.unref(contents);

                var subtree_i = progressive.subtreeCount(chunkCountForLength(len));
                while (subtree_i > 0) {
                    subtree_i -= 1;
                    contents = try pool.createBranch(@enumFromInt(progressive.subtreeDepth(subtree_i)), contents);
                }

                const length_leaf = try pool.createLeafFromUint(len);
                errdefer pool.unref(length_leaf);

                return pool.createBranch(contents, length_leaf);
            }

            /// Builds a list from borrowed element roots; see `progressive.contentsFromNodes`.
            pub fn fromNodes(pool: *Node.Pool, nodes: []Node.Id) !Node.Id {
                comptime std.debug.assert(!isBasicType(Element));
                if (nodes.len > limit) return error.LengthOverLimit;
                const contents = try progressive.contentsFromNodes(pool, nodes);
                errdefer pool.unref(contents);

                const length_leaf = try pool.createLeafFromUint(nodes.len);
                errdefer pool.unref(length_leaf);

                return pool.createBranch(contents, length_leaf);
            }

            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);

                const len_u256 = std.mem.readInt(u256, hash[0..32], .little);
                if (len_u256 > limit) return error.LengthOverLimit;
                const len: usize = @intCast(len_u256);

                return len;
            }

            /// Decodes `values.len` packed elements from `bytes`, which start on a chunk boundary.
            pub fn toValuesPackedFromBytes(bytes: []const u8, values: []Element.Type) void {
                comptime std.debug.assert(isBasicType(Element));
                std.debug.assert(bytes.len % 32 == 0);
                std.debug.assert(bytes.len >= values.len * Element.fixed_size);
                if (comptime canMemcpySsz(Element)) {
                    const size = values.len * Element.fixed_size;
                    @memcpy(std.mem.sliceAsBytes(values), bytes[0..size]);
                } else {
                    for (values, 0..) |*value, i| {
                        const chunk = bytes[i / items_per_chunk * 32 ..][0..32];
                        Element.tree.toValuePackedFromBytes(chunk, i, value);
                    }
                }
            }

            fn toValueChunked(
                allocator: std.mem.Allocator,
                node: Node.Id,
                pool: *Node.Pool,
                out: *Type,
            ) !void {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.initChunkedLeaf(
                    pool,
                    try node.getLeft(pool),
                    chunkCountForLength(len),
                );

                // Basic elements own nothing, so unfilled slots are safe for the caller to deinit.
                try out.resize(allocator, len);
                var index: usize = 0;
                while (try it.nextBytes()) |bytes| {
                    const count = @min(bytes.len / Element.fixed_size, len - index);
                    toValuesPackedFromBytes(bytes, out.items[index..][0..count]);
                    index += count;
                }
                std.debug.assert(index == len);
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                if (comptime use_chunked_leaf) return toValueChunked(allocator, node, pool, out);
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), chunkCountForLength(len));
                try out.resize(allocator, len);
                @memset(out.items, Element.default_value);
                var index: usize = 0;
                while (try it.next()) |chunk| {
                    if (comptime isBasicType(Element)) {
                        const count = @min(32 / Element.fixed_size, len - index);
                        for (0..count) |i| {
                            try Element.tree.toValuePacked(chunk, pool, i, &out.items[index + i]);
                        }
                        index += count;
                    } else {
                        try Element.tree.toValue(chunk, pool, &out.items[index]);
                        index += 1;
                    }
                }
                std.debug.assert(index == len);
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                return std.math.mul(usize, try length(node, pool), Element.fixed_size);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                const size = try std.math.mul(usize, len, Element.fixed_size);
                if (out.len < size) return error.InvalidSize;
                const chunk_count = chunkCountForLength(len);
                if (comptime use_chunked_leaf) {
                    var it = try progressive.NodeIterator.initChunkedLeaf(
                        pool,
                        try node.getLeft(pool),
                        chunk_count,
                    );
                    var offset: usize = 0;
                    while (try it.nextBytes()) |bytes| {
                        const count = @min(bytes.len, size - offset);
                        @memcpy(out[offset..][0..count], bytes[0..count]);
                        offset += count;
                    }
                    std.debug.assert(offset == size);
                    return size;
                }
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), chunk_count);
                var offset: usize = 0;
                while (try it.next()) |chunk| {
                    if (comptime isBasicType(Element)) {
                        const byte_count = @min(32, size - offset);
                        @memcpy(out[offset..][0..byte_count], chunk.getRoot(pool)[0..byte_count]);
                        offset += byte_count;
                    } else {
                        offset += try Element.tree.serializeIntoBytes(chunk, pool, out[offset..][0..Element.fixed_size]);
                    }
                }
                std.debug.assert(offset == size);
                return size;
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                const len = try serialized.length(data);
                // Packed leaves bypass element decoding, so reject noncanonical boolean bytes here.
                if (comptime Element.kind == .bool) try serialized.validate(data);
                var builder = try initTreeBuilder(pool, chunkCountForLength(len));
                defer builder.deinit();
                if (comptime use_chunked_leaf) {
                    try appendPackedBytes(&builder, data);
                } else if (comptime isBasicType(Element)) {
                    var chunks = std.mem.window(u8, data, 32, 32);
                    while (chunks.next()) |bytes| {
                        const chunk = chunk_utils.fromBytes(bytes);
                        try builder.appendOwned(try pool.createLeaf(&chunk));
                    }
                } else {
                    for (0..len) |i| {
                        try builder.appendOwned(try Element.tree.deserializeFromBytes(pool, data[i * Element.fixed_size ..][0..Element.fixed_size]));
                    }
                }
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
            }

            const initTreeBuilder = if (use_chunked_leaf)
                progressive.TreeBuilder.initChunkedLeaf
            else
                progressive.TreeBuilder.init;

            fn appendPackedBytes(builder: *progressive.TreeBuilder, bytes: []const u8) !void {
                var offset: usize = 0;
                while (offset < bytes.len) {
                    const size = @min(builder.nextNodeChunks() * 32, bytes.len - offset);
                    try builder.appendPacked(bytes[offset..][0..size]);
                    offset += size;
                }
            }

            fn appendPackedItems(
                builder: *progressive.TreeBuilder,
                items: []const Element.Type,
            ) !void {
                if (comptime canMemcpySsz(Element)) {
                    return appendPackedBytes(builder, std.mem.sliceAsBytes(items));
                }
                var bytes: [ChunkedLeaf.K * 32]u8 = undefined;
                var index: usize = 0;
                while (index < items.len) {
                    const node_items = builder.nextNodeChunks() * items_per_chunk;
                    const count = @min(node_items, items.len - index);
                    for (items[index..][0..count], 0..) |*item, i| {
                        const item_bytes = bytes[i * Element.fixed_size ..][0..Element.fixed_size];
                        _ = Element.serializeIntoBytes(item, item_bytes);
                    }
                    try builder.appendPacked(bytes[0 .. count * Element.fixed_size]);
                    index += count;
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var builder = try initTreeBuilder(pool, chunkCount(value));
                defer builder.deinit();
                if (comptime use_chunked_leaf) {
                    try appendPackedItems(&builder, value.items);
                } else if (comptime isBasicType(Element)) {
                    var chunks = std.mem.window(Element.Type, value.items, items_per_chunk, items_per_chunk);
                    while (chunks.next()) |elements| {
                        const chunk = packBasicChunk(elements);
                        try builder.appendOwned(try pool.createLeaf(&chunk));
                    }
                } else {
                    for (value.items) |*element| {
                        try builder.appendOwned(try Element.tree.fromValue(pool, element));
                    }
                }
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(value.items.len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
            }
        };
    };
}

pub fn VariableProgressiveListType(comptime ST: type, comptime _opts: TypeOpts) type {
    comptime {
        if (isFixedType(ST)) {
            @compileError("ST must not be fixed type");
        }
        if (_opts.chunked_leaf) {
            @compileError("chunked_leaf requires basic elements");
        }
        if (_opts.limit == 0) {
            @compileError("limit must be greater than 0");
        }
    }
    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_list;
        pub const Element: type = ST;
        pub const opts: TypeOpts = _opts;
        /// `opts.limit`, capped by the longest list a node-backed tree can address. It bounds decoding
        /// and growth but not merkleization.
        pub const limit: usize = @min(opts.limit, progressive.max_node_chunks, std.math.maxInt(usize) / 4);
        pub const Type: type = std.ArrayList(Element.Type);
        pub const TreeView = @import("../tree_view/progressive_list_composite.zig").ProgressiveListCompositeTreeView(@This());
        pub const min_size: usize = 0;
        pub const max_size: usize = if (opts.limit == std.math.maxInt(usize))
            std.math.maxInt(usize)
        else
            limit *| 4 +| limit *| Element.max_size;

        pub const default_value: Type = Type.empty;
        pub const default_root: [32]u8 = @import("hashing").getZeroHash(1).*;

        pub fn equals(a: *const Type, b: *const Type) bool {
            if (a.items.len != b.items.len) return false;
            for (a.items, b.items) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) return false;
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            for (value.items) |*element| {
                Element.deinit(allocator, element);
            }
            value.deinit(allocator);
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or
        /// error.
        pub fn clone(allocator: std.mem.Allocator, value: *const Type, out: *Type) !void {
            return cloneInto(@This(), allocator, value, out);
        }

        /// Initialize `out` with `DestinationST.default_value`; the caller deinitializes it after
        /// success or error.
        pub fn cloneInto(
            comptime DestinationST: type,
            allocator: std.mem.Allocator,
            value: *const Type,
            out: *DestinationST.Type,
        ) !void {
            try out.ensureTotalCapacity(allocator, value.items.len);
            for (value.items) |*element| {
                out.appendAssumeCapacity(initValue(DestinationST.Element));
                try Element.cloneInto(
                    DestinationST.Element,
                    allocator,
                    element,
                    &out.items[out.items.len - 1],
                );
            }
        }

        pub fn chunkCount(value: *const Type) usize {
            return value.items.len;
        }

        pub fn hashTreeRoot(allocator: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(value.items.len);
            for (value.items) |*element| {
                var chunk: [32]u8 = undefined;
                try Element.hashTreeRoot(allocator, element, &chunk);
                try accumulator.append(&chunk);
            }
            try accumulator.finish(out);
            mixInLength(value.items.len, out);
        }

        pub fn serializedSize(value: *const Type) usize {
            var size: usize = value.items.len * 4;
            for (value.items) |element| {
                size += Element.serializedSize(&element);
            }
            return size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var variable_index = value.items.len * 4;
            for (value.items, 0..) |element, i| {
                std.mem.writeInt(u32, out[i * 4 ..][0..4], @intCast(variable_index), .little);
                variable_index += Element.serializeIntoBytes(&element, out[variable_index..]);
            }
            return variable_index;
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            var elements = try VariableElementIterator(Self).init(data);
            const len = elements.len;

            try out.resize(allocator, len);
            @memset(out.items, initValue(Element));

            var i: usize = 0;
            while (try elements.next()) |element_bytes| : (i += 1) {
                try Element.deserializeFromBytes(
                    allocator,
                    element_bytes,
                    &out.items[i],
                );
            }
            std.debug.assert(i == len);
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                var elements = try VariableElementIterator(Self).init(data);
                while (try elements.next()) |element_bytes| {
                    try Element.serialized.validate(element_bytes);
                }
            }

            pub fn length(data: []const u8) !usize {
                const elements = try VariableElementIterator(Self).init(data);
                return elements.len;
            }

            pub fn hashTreeRoot(allocator: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                var elements = try VariableElementIterator(Self).init(data);
                var accumulator = try progressive.MerkleAccumulator.init(elements.len);
                while (try elements.next()) |element_bytes| {
                    var chunk: [32]u8 = undefined;
                    try Element.serialized.hashTreeRoot(allocator, element_bytes, &chunk);
                    try accumulator.append(&chunk);
                }
                try accumulator.finish(out);
                mixInLength(elements.len, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                return try pool.createBranch(@enumFromInt(0), @enumFromInt(0));
            }

            /// Builds a list from borrowed element roots; see `progressive.contentsFromNodes`.
            pub fn fromNodes(pool: *Node.Pool, nodes: []Node.Id) !Node.Id {
                comptime std.debug.assert(!isBasicType(Element));
                if (nodes.len > limit) return error.LengthOverLimit;
                const contents = try progressive.contentsFromNodes(pool, nodes);
                errdefer pool.unref(contents);

                const length_leaf = try pool.createLeafFromUint(nodes.len);
                errdefer pool.unref(length_leaf);

                return pool.createBranch(contents, length_leaf);
            }

            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);

                const len_u256 = std.mem.readInt(u256, hash[0..32], .little);
                if (len_u256 > limit) return error.LengthOverLimit;
                const len: usize = @intCast(len_u256);

                return len;
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), len);
                try out.resize(allocator, len);
                @memset(out.items, initValue(Element));
                var index: usize = 0;
                while (try it.next()) |chunk| {
                    try Element.tree.toValue(allocator, chunk, pool, &out.items[index]);
                    index += 1;
                }
                std.debug.assert(index == len);
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), len);
                var size = try std.math.mul(usize, len, 4);
                while (try it.next()) |child| {
                    size = try std.math.add(usize, size, try Element.tree.serializedSize(child, pool));
                }
                return size;
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), len);
                var variable_index = try std.math.mul(usize, len, 4);
                if (out.len < variable_index) return error.InvalidSize;
                var fixed_index: usize = 0;
                while (try it.next()) |child| {
                    const size = try Element.tree.serializedSize(child, pool);
                    const end = try std.math.add(usize, variable_index, size);
                    if (out.len < end) return error.InvalidSize;
                    const offset = std.math.cast(u32, variable_index) orelse return error.Overflow;
                    std.mem.writeInt(u32, out[fixed_index..][0..4], offset, .little);
                    const written = try Element.tree.serializeIntoBytes(child, pool, out[variable_index..end]);
                    std.debug.assert(written == size);
                    variable_index = end;
                    fixed_index += 4;
                }
                return variable_index;
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                var elements = try VariableElementIterator(Self).init(data);
                var builder = try progressive.TreeBuilder.init(pool, elements.len);
                defer builder.deinit();
                while (try elements.next()) |element_bytes| {
                    try builder.appendOwned(try Element.tree.deserializeFromBytes(pool, element_bytes));
                }
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(elements.len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var builder = try progressive.TreeBuilder.init(pool, value.items.len);
                defer builder.deinit();
                for (value.items) |*element| {
                    try builder.appendOwned(try Element.tree.fromValue(pool, element));
                }
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(value.items.len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
            }
        };

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            try writer.beginArray();
            for (in.items) |element| {
                try Element.serializeIntoJson(allocator, writer, &element);
            }
            try writer.endArray();
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            while ((try source.peekNextTokenType()) != .array_end) {
                if (out.items.len == limit) return error.LengthOverLimit;
                try out.append(allocator, initValue(Element));
                try Element.deserializeFromJson(
                    allocator,
                    source,
                    &out.items[out.items.len - 1],
                );
            }
            _ = try source.next();
        }
    };
}

test {
    _ = @import("progressive_list_test.zig");
}
