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

        pub fn hashTreeRoot(_: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(chunkCount(value));
            if (comptime isBasicType(Element)) {
                const items_per_chunk = 32 / Element.fixed_size;
                var index: usize = 0;
                while (index < value.items.len) {
                    var chunk: [32]u8 = @splat(0);
                    const count = @min(items_per_chunk, value.items.len - index);
                    for (value.items[index..][0..count], 0..) |*element, i| {
                        _ = Element.serializeIntoBytes(element, chunk[i * Element.fixed_size ..][0..Element.fixed_size]);
                    }
                    try accumulator.append(&chunk);
                    index += count;
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
                    var offset: usize = 0;
                    while (offset < data.len) {
                        var chunk: [32]u8 = @splat(0);
                        const count = @min(32, data.len - offset);
                        @memcpy(chunk[0..count], data[offset..][0..count]);
                        try accumulator.append(&chunk);
                        offset += count;
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
                const chunk_count = if (comptime isBasicType(Element))
                    (Element.fixed_size * len + 31) / 32
                else
                    len;

                var replacement: Type = .empty;
                errdefer replacement.deinit(allocator);
                if (chunk_count == 0) {
                    out.* = replacement;
                    return;
                }

                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);

                const contents_node = try node.getLeft(pool);
                try progressive.getNodes(pool, contents_node, nodes);

                try replacement.resize(allocator, len);
                @memset(replacement.items, Element.default_value);
                if (comptime isBasicType(Element)) {
                    for (0..len) |i| {
                        const chunk_index = (i * Element.fixed_size) / 32;
                        const element_index = i % (32 / Element.fixed_size);
                        try Element.tree.toValuePacked(
                            nodes[chunk_index],
                            pool,
                            element_index,
                            &replacement.items[i],
                        );
                    }
                } else {
                    for (0..len) |i| {
                        try Element.tree.toValue(
                            nodes[i],
                            pool,
                            &replacement.items[i],
                        );
                    }
                }

                out.* = replacement;
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
                const allocator = pool.allocator;
                var value = Self.default_value;
                defer Self.deinit(allocator, &value);

                try Self.deserializeFromBytes(allocator, data, &value);
                return fromValue(pool, &value);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const allocator = pool.allocator;
                const len = value.items.len;
                const chunk_count = chunkCount(value);

                if (chunk_count == 0) {
                    const length_leaf = try pool.createLeafFromUint(0);
                    errdefer pool.unref(length_leaf);

                    return try pool.createBranch(@enumFromInt(0), length_leaf);
                }

                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);
                @memset(nodes, @as(Node.Id, @enumFromInt(0)));
                var content_owns_nodes = false;
                errdefer if (!content_owns_nodes) pool.free(nodes);
                if (comptime isBasicType(Element)) {
                    const items_per_chunk = 32 / Element.fixed_size;
                    var next: usize = 0;

                    for (0..chunk_count) |i| {
                        var leaf_buf = [_]u8{0} ** 32;

                        const remaining = len - next;
                        const to_write = @min(remaining, items_per_chunk);

                        for (0..to_write) |j| {
                            const dst_off = j * Element.fixed_size;
                            const dst_slice = leaf_buf[dst_off .. dst_off + Element.fixed_size];
                            _ = Element.serializeIntoBytes(&value.items[next + j], dst_slice);
                        }
                        next += to_write;

                        nodes[i] = try pool.createLeaf(&leaf_buf);
                    }
                } else {
                    for (0..chunk_count) |i| {
                        nodes[i] = try Element.tree.fromValue(pool, &value.items[i]);
                    }
                }

                const contents_tree = try progressive.fillWithContents(allocator, pool, nodes);
                content_owns_nodes = true;
                errdefer pool.unref(contents_tree);

                const length_leaf = try pool.createLeafFromUint(len);
                errdefer pool.unref(length_leaf);

                const result = try pool.createBranch(
                    contents_tree,
                    length_leaf,
                );
                return result;
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
                const chunk_count = len;
                var replacement: Type = .empty;
                errdefer deinit(allocator, &replacement);
                if (chunk_count == 0) {
                    out.* = replacement;
                    return;
                }

                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);

                try progressive.getNodes(pool, try node.getLeft(pool), nodes);

                try replacement.resize(allocator, len);
                @memset(replacement.items, Element.default_value);
                for (0..len) |i| {
                    try Element.tree.toValue(
                        allocator,
                        nodes[i],
                        pool,
                        &replacement.items[i],
                    );
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
                const len = value.items.len;
                const chunk_count = len;
                if (chunk_count == 0) {
                    const length_leaf = try pool.createLeafFromUint(0);
                    errdefer pool.unref(length_leaf);

                    return try pool.createBranch(@enumFromInt(0), length_leaf);
                }

                const nodes = try allocator.alloc(Node.Id, chunk_count);
                defer allocator.free(nodes);
                @memset(nodes, @as(Node.Id, @enumFromInt(0)));
                var content_owns_nodes = false;
                errdefer if (!content_owns_nodes) pool.free(nodes);
                for (0..chunk_count) |i| {
                    nodes[i] = try Element.tree.fromValue(pool, &value.items[i]);
                }

                const contents_tree = try progressive.fillWithContents(allocator, pool, nodes);
                content_owns_nodes = true;
                errdefer pool.unref(contents_tree);

                const length_leaf = try pool.createLeafFromUint(len);
                errdefer pool.unref(length_leaf);

                return try pool.createBranch(contents_tree, length_leaf);
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
