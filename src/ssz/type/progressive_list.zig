const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isBasicType = @import("type_kind.zig").isBasicType;
const isFixedType = @import("type_kind.zig").isFixedType;
const VariableElementIterator = @import("variable_element_iterator.zig").VariableElementIterator;
const mixInLength = @import("hashing").mixInLength;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const Depth = @import("hashing").Depth;
const Node = @import("persistent_merkle_tree").Node;
const progressive = @import("progressive.zig");
const chunk_utils = @import("chunk.zig");

pub fn FixedProgressiveListType(comptime ST: type) type {
    comptime {
        if (!isFixedType(ST)) {
            @compileError("ST must be fixed type");
        }
    }

    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_list;
        pub const Element: type = ST;
        pub const Type: type = std.ArrayList(Element.Type);
        pub const min_size: usize = 0;
        pub const max_size: usize = std.math.maxInt(usize);

        pub const default_value: Type = Type.empty;

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

        pub fn chunkCount(value: *const Type) usize {
            return chunkCountForLength(value.items.len);
        }

        fn chunkCountForLength(len: usize) usize {
            if (comptime isBasicType(Element)) {
                const items_per_chunk = 32 / Element.fixed_size;
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
                const items_per_chunk = 32 / Element.fixed_size;
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

            var replacement: Type = .empty;
            errdefer replacement.deinit(allocator);
            try replacement.resize(allocator, len);
            @memset(replacement.items, Element.default_value);
            for (0..len) |i| {
                try Element.deserializeFromBytes(
                    data[i * Element.fixed_size .. (i + 1) * Element.fixed_size],
                    &replacement.items[i],
                );
            }

            out.* = replacement;
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

            var replacement: Type = .empty;
            errdefer replacement.deinit(allocator);
            while ((try source.peekNextTokenType()) != .array_end) {
                try replacement.append(allocator, Element.default_value);
                try Element.deserializeFromJson(source, &replacement.items[replacement.items.len - 1]);
            }
            _ = try source.next();

            out.* = replacement;
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                const len = std.math.divExact(usize, data.len, Element.fixed_size) catch {
                    return error.InvalidSSZ;
                };

                for (0..len) |i| {
                    try Element.serialized.validate(data[i * Element.fixed_size .. (i + 1) * Element.fixed_size]);
                }
            }

            pub fn length(data: []const u8) !usize {
                const len = std.math.divExact(usize, data.len, Element.fixed_size) catch {
                    return error.InvalidSSZ;
                };
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
            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);

                const len_u256 = std.mem.readInt(u256, hash[0..32], .little);
                const len = @as(usize, @intCast(@min(len_u256, std.math.maxInt(usize))));

                return len;
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), chunkCountForLength(len));
                var value: Type = .empty;
                errdefer value.deinit(allocator);
                try value.resize(allocator, len);
                @memset(value.items, Element.default_value);
                var index: usize = 0;
                while (try it.next()) |chunk| {
                    if (comptime isBasicType(Element)) {
                        const count = @min(32 / Element.fixed_size, len - index);
                        for (0..count) |i| {
                            try Element.tree.toValuePacked(chunk, pool, i, &value.items[index + i]);
                        }
                        index += count;
                    } else {
                        try Element.tree.toValue(chunk, pool, &value.items[index]);
                        index += 1;
                    }
                }
                std.debug.assert(index == len);
                out.* = value;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                return std.math.mul(usize, try length(node, pool), Element.fixed_size);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                const size = try std.math.mul(usize, len, Element.fixed_size);
                if (out.len < size) return error.InvalidSize;
                const chunk_count = chunkCountForLength(len);
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
                var builder = try progressive.TreeBuilder.init(pool, chunkCountForLength(len));
                defer builder.deinit();
                if (comptime isBasicType(Element)) {
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

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var builder = try progressive.TreeBuilder.init(pool, chunkCount(value));
                defer builder.deinit();
                if (comptime isBasicType(Element)) {
                    const items_per_chunk = 32 / Element.fixed_size;
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

pub fn VariableProgressiveListType(comptime ST: type) type {
    comptime {
        if (isFixedType(ST)) {
            @compileError("ST must not be fixed type");
        }
    }
    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_list;
        pub const Element: type = ST;
        pub const Type: type = std.ArrayList(Element.Type);
        pub const min_size: usize = 0;
        pub const max_size: usize = std.math.maxInt(usize);

        pub const default_value: Type = Type.empty;

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

            var replacement: Type = .empty;
            errdefer deinit(allocator, &replacement);
            try replacement.resize(allocator, len);
            @memset(replacement.items, Element.default_value);

            var i: usize = 0;
            while (try elements.next()) |element_bytes| : (i += 1) {
                try Element.deserializeFromBytes(
                    allocator,
                    element_bytes,
                    &replacement.items[i],
                );
            }
            std.debug.assert(i == len);

            out.* = replacement;
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
            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);

                const len_u256 = std.mem.readInt(u256, hash[0..32], .little);
                const len = @as(usize, @intCast(@min(len_u256, std.math.maxInt(usize))));

                return len;
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const len = try length(node, pool);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), len);
                var value: Type = .empty;
                errdefer deinit(allocator, &value);
                try value.resize(allocator, len);
                @memset(value.items, Element.default_value);
                var index: usize = 0;
                while (try it.next()) |chunk| {
                    try Element.tree.toValue(allocator, chunk, pool, &value.items[index]);
                    index += 1;
                }
                std.debug.assert(index == len);
                out.* = value;
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

            var replacement: Type = .empty;
            errdefer deinit(allocator, &replacement);
            while ((try source.peekNextTokenType()) != .array_end) {
                try replacement.append(allocator, Element.default_value);
                try Element.deserializeFromJson(
                    allocator,
                    source,
                    &replacement.items[replacement.items.len - 1],
                );
            }
            _ = try source.next();

            out.* = replacement;
        }
    };
}

test {
    _ = @import("progressive_list_test.zig");
}
