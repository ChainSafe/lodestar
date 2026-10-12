const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isBasicType = @import("type_kind.zig").isBasicType;
const isFixedType = @import("type_kind.zig").isFixedType;
const canMemcpySsz = @import("type_kind.zig").canMemcpySsz;
const VariableElementIterator = @import("variable_element_iterator.zig").VariableElementIterator;
const merkleize = @import("hashing").merkleize;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const getZeroHash = @import("hashing").getZeroHash;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const tree_view = @import("../tree_view/root.zig");
const ArrayBasicTreeView = tree_view.ArrayBasicTreeView;
const ArrayCompositeTreeView = tree_view.ArrayCompositeTreeView;

pub const TypeOpts = @import("list.zig").TypeOpts;

pub fn FixedVectorType(comptime ST: type, comptime _length: comptime_int, comptime _opts: TypeOpts) type {
    comptime {
        if (!isFixedType(ST)) {
            @compileError("ST must be fixed type");
        }
        if (_length <= 0) {
            @compileError("length must be greater than 0");
        }
        if (_opts.chunked_leaf and !isBasicType(ST)) {
            @compileError("FixedVectorType: opts.chunked_leaf=true requires isBasicType(Element)");
        }
        if (_opts.chunked_leaf) {
            const ChunkedLeaf = pmt.ChunkedLeaf;
            const items_per_chunk_local = if (isBasicType(ST)) (32 / ST.fixed_size) else 1;
            const min_length = ChunkedLeaf.K * items_per_chunk_local;
            if (_length < min_length) {
                @compileError(std.fmt.comptimePrint(
                    "FixedVectorType: opts.chunked_leaf=true requires length >= K * items_per_chunk = {d} (chunk_depth must be >= ChunkedLeaf.k_log2)",
                    .{min_length},
                ));
            }
        }
    }
    return struct {
        pub const kind = TypeKind.vector;
        pub const Element: type = ST;
        pub const length: usize = _length;
        pub const opts: TypeOpts = _opts;
        pub const Type: type = [length]Element.Type;
        pub const TreeView: type = if (isBasicType(Element))
            ArrayBasicTreeView(@This())
        else
            ArrayCompositeTreeView(@This());
        pub const fixed_size: usize = Element.fixed_size * length;
        pub const chunk_count: usize = if (isBasicType(Element)) std.math.divCeil(usize, fixed_size, 32) catch unreachable else length;
        pub const chunk_depth: u8 = maxChunksToDepth(chunk_count);
        pub const use_chunked_leaf: bool = _opts.chunked_leaf;
        const ChunkedLeaf = if (use_chunked_leaf) pmt.ChunkedLeaf else struct {};
        const chunked_leaf_depth: u8 = if (use_chunked_leaf) chunk_depth - ChunkedLeaf.k_log2 else 0;

        pub const default_value: Type = [_]Element.Type{Element.default_value} ** length;

        pub const default_root: [32]u8 = getZeroHash(chunk_depth).*;

        pub fn equals(a: *const Type, b: *const Type) bool {
            for (a, b) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) {
                    return false;
                }
            }
            return true;
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            if (comptime chunk_count <= 64) {
                var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                if (comptime isBasicType(Element)) {
                    _ = serializeIntoBytes(value, @ptrCast(&chunks));
                } else {
                    for (value, 0..) |*element, i| {
                        try Element.hashTreeRoot(element, &chunks[i]);
                    }
                }
                return merkleize(@ptrCast(&chunks), chunk_depth, out);
            }
            var accumulator = @import("hashing").MerkleAccumulator.init(chunk_depth);
            if (comptime isBasicType(Element)) {
                const items_per_chunk = 32 / Element.fixed_size;
                var next: usize = 0;
                for (0..chunk_count) |_| {
                    var chunk: [32]u8 = @splat(0);
                    const end = next + @min(items_per_chunk, length - next);
                    if (comptime canMemcpySsz(Element)) {
                        const bytes = std.mem.sliceAsBytes(value[next..end]);
                        @memcpy(chunk[0..bytes.len], bytes);
                    } else {
                        for (value[next..end], 0..) |*element, i| {
                            _ = Element.serializeIntoBytes(element, chunk[i * Element.fixed_size ..]);
                        }
                    }
                    try accumulator.append(&chunk);
                    next = end;
                }
                std.debug.assert(next == length);
            } else {
                for (value) |*element| {
                    var chunk: [32]u8 = undefined;
                    try Element.hashTreeRoot(element, &chunk);
                    try accumulator.append(&chunk);
                }
            }
            try accumulator.finish(out);
        }

        pub fn clone(value: *const Type, out: anytype) !void {
            comptime {
                const OutInfo = @typeInfo(@TypeOf(out.*));
                std.debug.assert(OutInfo == .array);
                std.debug.assert(OutInfo.array.len == length);
            }

            const OutType = @TypeOf(out.*);
            if (OutType == Type) {
                out.* = value.*;
            } else {
                inline for (value, 0..) |*element, i| {
                    try Element.clone(element, &out[i]);
                }
            }
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            if (comptime canMemcpySsz(Element)) {
                const bytes = std.mem.sliceAsBytes(value);
                @memcpy(out[0..fixed_size], bytes);
                return fixed_size;
            }
            var i: usize = 0;
            for (value) |element| {
                i += Element.serializeIntoBytes(&element, out[i..]);
            }
            return i;
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            if (data.len != fixed_size) {
                return error.InvalidSize;
            }

            if (comptime canMemcpySsz(Element)) {
                @memcpy(std.mem.sliceAsBytes(out), data[0..fixed_size]);
                return;
            }
            for (0..length) |i| {
                try Element.deserializeFromBytes(
                    data[i * Element.fixed_size .. (i + 1) * Element.fixed_size],
                    &out[i],
                );
            }
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
                for (0..length) |i| {
                    try Element.serialized.validate(data[i * Element.fixed_size .. (i + 1) * Element.fixed_size]);
                }
            }

            pub fn hashTreeRoot(data: []const u8, out: *[32]u8) !void {
                if (data.len != fixed_size) return error.InvalidSize;
                if (comptime chunk_count <= 64) {
                    var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                    if (comptime isBasicType(Element)) {
                        @memcpy(@as([]u8, @ptrCast(&chunks))[0..fixed_size], data);
                    } else {
                        for (0..length) |i| {
                            try Element.serialized.hashTreeRoot(
                                data[i * Element.fixed_size .. (i + 1) * Element.fixed_size],
                                &chunks[i],
                            );
                        }
                    }
                    return merkleize(@ptrCast(&chunks), chunk_depth, out);
                }
                var accumulator = @import("hashing").MerkleAccumulator.init(chunk_depth);
                if (comptime isBasicType(Element)) {
                    for (0..chunk_count) |i| {
                        var chunk: [32]u8 = @splat(0);
                        const start = i * 32;
                        const len = @min(32, data.len - start);
                        @memcpy(chunk[0..len], data[start..][0..len]);
                        try accumulator.append(&chunk);
                    }
                } else {
                    for (0..length) |i| {
                        var chunk: [32]u8 = undefined;
                        try Element.serialized.hashTreeRoot(
                            data[i * Element.fixed_size ..][0..Element.fixed_size],
                            &chunk,
                        );
                        try accumulator.append(&chunk);
                    }
                }
                try accumulator.finish(out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                if (comptime isBasicType(Element)) {
                    return @enumFromInt(chunk_depth);
                } else {
                    var nodes: [chunk_count]Node.Id = undefined;

                    const element_default = try Element.tree.default(pool);
                    defer pool.free(&element_default);

                    for (0..chunk_count) |i| {
                        nodes[i] = element_default;
                    }

                    return try Node.fillWithContents(pool, &nodes, chunk_depth);
                }
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
                if (comptime Element.kind == .bool) {
                    try serialized.validate(data);
                }

                if (comptime use_chunked_leaf) {
                    var it = Node.FillWithContentsIterator.initWithOffset(pool, chunked_leaf_depth, ChunkedLeaf.k_log2);
                    errdefer it.deinit();

                    const bytes_per_chunked_leaf: usize = ChunkedLeaf.K * 32;
                    var byte_idx: usize = 0;

                    while (byte_idx < data.len) {
                        const remaining = data.len - byte_idx;
                        const chunked_leaf_bytes = @min(remaining, bytes_per_chunked_leaf);
                        const valid_chunks: u16 = @intCast((chunked_leaf_bytes + 31) / 32);
                        var chunked_leaf_id_opt: ?Node.Id = try pool.createChunkedLeafEmpty(valid_chunks);
                        errdefer if (chunked_leaf_id_opt) |id| pool.unref(id);
                        const storage = try chunked_leaf_id_opt.?.getChunkedLeafPtr(pool);
                        @memcpy(@as([*]u8, @ptrCast(&storage.chunks))[0..chunked_leaf_bytes], data[byte_idx..][0..chunked_leaf_bytes]);
                        try it.append(chunked_leaf_id_opt.?);
                        chunked_leaf_id_opt = null;
                        byte_idx += chunked_leaf_bytes;
                    }

                    return try it.finish();
                }

                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                if (comptime isBasicType(Element)) {
                    var chunks: [chunk_count][32]u8 = [_][32]u8{[_]u8{0} ** 32} ** chunk_count;
                    const chunk_bytes: []u8 = @ptrCast(&chunks);
                    @memcpy(chunk_bytes[0..fixed_size], data[0..fixed_size]);

                    for (&chunks, 0..) |*chunk, i| {
                        nodes[i] = try pool.createLeaf(chunk);
                    }
                } else {
                    for (0..length) |i| {
                        const elem_bytes = data[i * Element.fixed_size .. (i + 1) * Element.fixed_size];
                        nodes[i] = try Element.tree.deserializeFromBytes(pool, elem_bytes);
                    }
                }

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                if (comptime use_chunked_leaf) {
                    const items_per_chunk = 32 / Element.fixed_size;
                    const chunked_leaf_count = (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K;
                    var chunked_leaf_ids: [chunked_leaf_count]Node.Id = undefined;
                    try node.getNodesAtDepth(pool, chunked_leaf_depth, 0, &chunked_leaf_ids);

                    const state_col = pool.nodes.items(.state);
                    var item_idx: usize = 0;
                    outer: for (chunked_leaf_ids) |sid| {
                        // Zero subtree at chunked_leaf boundary == all-zero values.
                        if (state_col[@intFromEnum(sid)].kind() == .zero) {
                            const items_in_chunked_leaf = @min(ChunkedLeaf.K * items_per_chunk, length - item_idx);
                            for (0..items_in_chunked_leaf) |i| {
                                out[item_idx + i] = std.mem.zeroes(Element.Type);
                            }
                            item_idx += items_in_chunked_leaf;
                            if (item_idx >= length) break :outer;
                            continue;
                        }
                        const chunks = try sid.getChunkedLeafChunks(pool);
                        for (0..ChunkedLeaf.K) |intra_chunk| {
                            if (item_idx >= length) break :outer;
                            const items_in_chunk = @min(items_per_chunk, length - item_idx);
                            for (0..items_in_chunk) |i| {
                                Element.tree.toValuePackedFromBytes(&chunks[intra_chunk], item_idx + i, &out[item_idx + i]);
                            }
                            item_idx += items_in_chunk;
                        }
                    }
                    return;
                }

                var nodes: [chunk_count]Node.Id = undefined;

                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                if (comptime isBasicType(Element)) {
                    // tightly packed list
                    for (0..length) |i| {
                        try Element.tree.toValuePacked(
                            nodes[i * Element.fixed_size / 32],
                            pool,
                            i,
                            &out[i],
                        );
                    }
                } else {
                    for (0..length) |i| {
                        try Element.tree.toValue(
                            nodes[i],
                            pool,
                            &out[i],
                        );
                    }
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                if (comptime use_chunked_leaf) {
                    var it = Node.FillWithContentsIterator.initWithOffset(pool, chunked_leaf_depth, ChunkedLeaf.k_log2);
                    errdefer it.deinit();

                    const items_per_chunk = 32 / Element.fixed_size;
                    const items_per_chunked_leaf: usize = items_per_chunk * ChunkedLeaf.K;
                    var item_idx: usize = 0;

                    while (item_idx < length) {
                        const remaining = length - item_idx;
                        const items_in_chunked_leaf = @min(remaining, items_per_chunked_leaf);
                        const valid_chunks: u16 = @intCast((items_in_chunked_leaf + items_per_chunk - 1) / items_per_chunk);

                        var chunked_leaf_id_opt: ?Node.Id = try pool.createChunkedLeafEmpty(valid_chunks);
                        errdefer if (chunked_leaf_id_opt) |id| pool.unref(id);
                        const storage = try chunked_leaf_id_opt.?.getChunkedLeafPtr(pool);

                        for (0..items_in_chunked_leaf) |k| {
                            const chunked_leaf_chunk_idx = k / items_per_chunk;
                            const intra_chunk = k % items_per_chunk;
                            const dst_off = intra_chunk * Element.fixed_size;
                            const dst_slice = storage.chunks[chunked_leaf_chunk_idx][dst_off .. dst_off + Element.fixed_size];
                            _ = Element.serializeIntoBytes(&value[item_idx + k], dst_slice);
                        }

                        try it.append(chunked_leaf_id_opt.?);
                        chunked_leaf_id_opt = null;
                        item_idx += items_in_chunked_leaf;
                    }

                    return try it.finish();
                }

                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                if (comptime isBasicType(Element)) {
                    const items_per_chunk = 32 / Element.fixed_size;
                    var l: usize = 0;
                    for (0..chunk_count) |i| {
                        var leaf_buf = [_]u8{0} ** 32;
                        for (0..items_per_chunk) |j| {
                            _ = Element.serializeIntoBytes(&value[l], leaf_buf[j * Element.fixed_size ..]);
                            l += 1;
                            if (l >= length) break;
                        }
                        nodes[i] = try pool.createLeaf(&leaf_buf);
                    }
                } else {
                    for (0..chunk_count) |i| {
                        nodes[i] = try Element.tree.fromValue(pool, &value[i]);
                    }
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                if (comptime use_chunked_leaf) {
                    const chunked_leaf_count = (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K;
                    var chunked_leaf_ids: [chunked_leaf_count]Node.Id = undefined;
                    try node.getNodesAtDepth(pool, chunked_leaf_depth, 0, &chunked_leaf_ids);

                    const state_col = pool.nodes.items(.state);
                    var byte_idx: usize = 0;
                    outer: for (chunked_leaf_ids) |sid| {
                        // Zero subtree at chunked_leaf boundary == all-zero output bytes.
                        if (state_col[@intFromEnum(sid)].kind() == .zero) {
                            const remaining = fixed_size - byte_idx;
                            const zero_bytes = @min(ChunkedLeaf.K * 32, remaining);
                            @memset(out[byte_idx..][0..zero_bytes], 0);
                            byte_idx += zero_bytes;
                            if (byte_idx >= fixed_size) break :outer;
                            continue;
                        }
                        const chunks = try sid.getChunkedLeafChunks(pool);
                        for (0..ChunkedLeaf.K) |intra_chunk| {
                            if (byte_idx >= fixed_size) break :outer;
                            const remaining = fixed_size - byte_idx;
                            const bytes_to_copy = @min(remaining, 32);
                            @memcpy(out[byte_idx..][0..bytes_to_copy], chunks[intra_chunk][0..bytes_to_copy]);
                            byte_idx += bytes_to_copy;
                        }
                    }
                    return fixed_size;
                }

                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                if (comptime isBasicType(Element)) {
                    for (0..chunk_count) |i| {
                        const start_idx = i * 32;
                        const remaining_bytes = fixed_size - start_idx;
                        const bytes_to_copy = @min(remaining_bytes, 32);
                        if (bytes_to_copy > 0) {
                            @memcpy(out[start_idx..][0..bytes_to_copy], nodes[i].getRoot(pool)[0..bytes_to_copy]);
                        }
                    }
                } else {
                    var offset: usize = 0;
                    for (0..length) |i| {
                        offset += try Element.tree.serializeIntoBytes(nodes[i], pool, out[offset..]);
                    }
                }
                return fixed_size;
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            try writer.beginArray();
            for (in) |element| {
                try Element.serializeIntoJson(writer, &element);
            }
            try writer.endArray();
        }

        pub fn deserializeFromJson(source: *std.json.Scanner, out: *Type) !void {
            // start array token "["
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            for (0..length) |i| {
                try Element.deserializeFromJson(source, &out[i]);
            }

            // end array token "]"
            switch (try source.next()) {
                .array_end => {},
                else => return error.InvalidJson,
            }
        }
    };
}

pub fn VariableVectorType(comptime ST: type, comptime _length: comptime_int) type {
    comptime {
        if (isFixedType(ST)) {
            @compileError("ST must not be fixed type");
        }
        if (_length <= 0) {
            @compileError("length must be greater than 0");
        }
    }
    return struct {
        const Self = @This();

        pub const kind = TypeKind.vector;
        pub const Element: type = ST;
        pub const length: usize = _length;
        pub const Type: type = [length]Element.Type;
        pub const TreeView: type = if (isBasicType(Element))
            ArrayBasicTreeView(@This())
        else
            ArrayCompositeTreeView(@This());
        pub const min_size: usize = Element.min_size * length + 4 * length;
        pub const max_size: usize = Element.max_size * length + 4 * length;
        pub const chunk_count: usize = length;
        pub const chunk_depth: u8 = maxChunksToDepth(chunk_count);

        pub const default_value: Type = [_]Element.Type{Element.default_value} ** length;

        pub const default_root: [32]u8 = blk: {
            var buf: [32]u8 = undefined;
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            @memset(chunks[0..length], Element.default_root);
            merkleize(@ptrCast(&chunks), chunk_depth, &buf) catch unreachable;
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            for (a, b) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) {
                    return false;
                }
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            for (0..length) |i| {
                Element.deinit(allocator, &value[i]);
            }
        }

        pub fn hashTreeRoot(allocator: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            if (comptime chunk_count <= 64) {
                var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                for (value, 0..) |*element, i| {
                    try Element.hashTreeRoot(allocator, element, &chunks[i]);
                }
                return merkleize(@ptrCast(&chunks), chunk_depth, out);
            }
            var accumulator = @import("hashing").MerkleAccumulator.init(chunk_depth);
            for (value) |*element| {
                var chunk: [32]u8 = undefined;
                try Element.hashTreeRoot(allocator, element, &chunk);
                try accumulator.append(&chunk);
            }
            try accumulator.finish(out);
        }

        /// The caller initializes `out` with `default_value`; this uses `cloneInto`'s contract.
        pub fn clone(allocator: std.mem.Allocator, value: *const Type, out: *Type) !void {
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
            comptime std.debug.assert(DestinationST.length == length);

            for (value, 0..) |*element, i| {
                try Element.cloneInto(DestinationST.Element, allocator, element, &out[i]);
            }
        }

        pub fn serializedSize(value: *const Type) usize {
            var size: usize = 0;
            for (value) |*element| {
                size += 4 + Element.serializedSize(element);
            }
            return size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var variable_index = length * 4;
            for (value, 0..) |element, i| {
                // write offset
                std.mem.writeInt(u32, out[i * 4 ..][0..4], @intCast(variable_index), .little);
                // write element data
                variable_index += Element.serializeIntoBytes(&element, out[variable_index..]);
            }
            return variable_index;
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            if (data.len > max_size or data.len < min_size) {
                return error.InvalidSize;
            }

            var elements = try VariableElementIterator(Self).init(data);

            var i: usize = 0;
            while (try elements.next()) |element_bytes| : (i += 1) {
                try Element.deserializeFromBytes(allocator, element_bytes, &out[i]);
            }
            std.debug.assert(i == length);
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len > max_size or data.len < min_size) {
                    return error.InvalidSize;
                }

                var elements = try VariableElementIterator(Self).init(data);
                while (try elements.next()) |element_bytes| {
                    try Element.serialized.validate(element_bytes);
                }
            }

            pub fn hashTreeRoot(allocator: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                if (comptime chunk_count <= 64) {
                    var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                    var elements = try VariableElementIterator(Self).init(data);
                    var i: usize = 0;
                    while (try elements.next()) |element_bytes| : (i += 1) {
                        try Element.serialized.hashTreeRoot(allocator, element_bytes, &chunks[i]);
                    }
                    std.debug.assert(i == length);

                    return merkleize(@ptrCast(&chunks), chunk_depth, out);
                }
                var accumulator = @import("hashing").MerkleAccumulator.init(chunk_depth);
                var elements = try VariableElementIterator(Self).init(data);
                var i: usize = 0;
                while (try elements.next()) |element_bytes| : (i += 1) {
                    var chunk: [32]u8 = undefined;
                    try Element.serialized.hashTreeRoot(allocator, element_bytes, &chunk);
                    try accumulator.append(&chunk);
                }
                std.debug.assert(i == length);
                try accumulator.finish(out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                var nodes: [chunk_count]Node.Id = undefined;

                const element_default = try Element.tree.default(pool);
                defer pool.unref(element_default);

                for (0..chunk_count) |i| {
                    nodes[i] = element_default;
                }

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len > max_size or data.len < min_size) {
                    return error.InvalidSize;
                }

                var elements = try VariableElementIterator(Self).init(data);
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                var i: usize = 0;
                while (try elements.next()) |elem_bytes| : (i += 1) {
                    nodes[i] = try Element.tree.deserializeFromBytes(pool, elem_bytes);
                }
                std.debug.assert(i == length);

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                var nodes: [chunk_count]Node.Id = undefined;

                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                for (0..length) |i| {
                    try Element.tree.toValue(
                        allocator,
                        nodes[i],
                        pool,
                        &out[i],
                    );
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                // Zero-filled so a mid-build error's errdefer is a no-op over the unfilled slots.
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                for (0..chunk_count) |i| {
                    nodes[i] = try Element.tree.fromValue(pool, &value[i]);
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                const fixed_end = length * 4;
                var variable_index = fixed_end;

                for (0..length) |i| {
                    std.mem.writeInt(u32, out[i * 4 ..][0..4], @intCast(variable_index), .little);
                    variable_index += try Element.tree.serializeIntoBytes(nodes[i], pool, out[variable_index..]);
                }

                return variable_index;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);

                var total_size: usize = length * 4; // Offsets
                for (0..length) |i| {
                    total_size += try Element.tree.serializedSize(nodes[i], pool);
                }
                return total_size;
            }
        };

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            try writer.beginArray();
            for (in) |element| {
                try Element.serializeIntoJson(allocator, writer, &element);
            }
            try writer.endArray();
        }

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            // start array token "["
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            for (0..length) |i| {
                try Element.deserializeFromJson(allocator, source, &out[i]);
            }

            // end array token "]"
            switch (try source.next()) {
                .array_end => {},
                else => return error.InvalidJson,
            }
        }
    };
}

test {
    _ = @import("vector_test.zig");
}
