const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const isBasicType = @import("type_kind.zig").isBasicType;
const isFixedType = @import("type_kind.zig").isFixedType;
const canMemcpySsz = @import("type_kind.zig").canMemcpySsz;
const VariableElementIterator = @import("variable_element_iterator.zig").VariableElementIterator;
const MerkleAccumulator = @import("hashing").MerkleAccumulator;
const mixInLength = @import("hashing").mixInLength;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const getZeroHash = @import("hashing").getZeroHash;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const tree_view = @import("../tree_view/root.zig");
const ListBasicTreeView = tree_view.ListBasicTreeView;
const ListCompositeTreeView = tree_view.ListCompositeTreeView;

/// Per-type opt-in flags for SSZ list/vector types.
pub const TypeOpts = struct {
    /// When true, the basic-element packed tree is built from chunked_leaf
    /// leaves (`Pool.createChunkedLeaf`) instead of per-chunk leaves. Each
    /// chunked_leaf packs K chunks contiguously, so the upper tree is depth
    /// `chunk_depth - k_log2`. This speeds up bulk operations on large lists.
    ///
    /// `ListBasicTreeView`'s `iteratorReadonly` and `sliceTo` handle
    /// chunked_leaf types with two-level (chunked_leaf_idx, intra_chunk)
    /// navigation. Requires `limit >= K * items_per_chunk` so that
    /// `chunk_depth >= k_log2`.
    chunked_leaf: bool = false,
};

pub fn FixedListType(comptime ST: type, comptime _limit: comptime_int, comptime _opts: TypeOpts) type {
    comptime {
        if (!isFixedType(ST)) {
            @compileError("ST must be fixed type");
        }
        if (_limit <= 0) {
            @compileError("limit must be greater than 0");
        }
        if (_opts.chunked_leaf and !isBasicType(ST)) {
            @compileError("FixedListType: opts.chunked_leaf=true requires isBasicType(Element)");
        }
        if (_opts.chunked_leaf) {
            const ChunkedLeaf = pmt.ChunkedLeaf;
            const items_per_chunk_local = if (isBasicType(ST)) (32 / ST.fixed_size) else 1;
            const min_limit = ChunkedLeaf.K * items_per_chunk_local;
            if (_limit < min_limit) {
                @compileError(std.fmt.comptimePrint(
                    "FixedListType: opts.chunked_leaf=true requires limit >= K * items_per_chunk = {d} (chunk_depth must be >= ChunkedLeaf.k_log2)",
                    .{min_limit},
                ));
            }
        }
    }
    return struct {
        pub const kind = TypeKind.list;
        pub const Element: type = ST;
        pub const limit: usize = _limit;
        pub const opts: TypeOpts = _opts;
        pub const Type: type = std.ArrayList(Element.Type);
        pub const TreeView: type = if (isBasicType(Element))
            ListBasicTreeView(@This())
        else
            ListCompositeTreeView(@This());
        pub const min_size: usize = 0;
        pub const max_size: usize = Element.fixed_size * limit;
        pub const max_chunk_count: usize = if (isBasicType(Element)) std.math.divCeil(usize, max_size, 32) catch unreachable else limit;
        pub const chunk_depth: u8 = maxChunksToDepth(max_chunk_count);
        pub const use_chunked_leaf: bool = _opts.chunked_leaf;
        const ChunkedLeaf = if (use_chunked_leaf) pmt.ChunkedLeaf else struct {};
        const chunked_leaf_depth: u8 = if (use_chunked_leaf) chunk_depth - ChunkedLeaf.k_log2 else 0;

        pub const default_value: Type = Type.empty;

        pub const default_root: [32]u8 = blk: {
            var buf = getZeroHash(chunk_depth).*;
            mixInLength(0, &buf);
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            if (a.items.len != b.items.len) {
                return false;
            }
            for (a.items, b.items) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) {
                    return false;
                }
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            value.deinit(allocator);
        }

        pub fn chunkIndex(index: usize) usize {
            if (comptime isBasicType(Element)) {
                return (index * Element.fixed_size) / 32;
            } else return index;
        }

        pub fn chunkCount(value: *const Type) usize {
            if (comptime isBasicType(Element)) {
                return (Element.fixed_size * value.items.len + 31) / 32;
            } else return value.items.len;
        }

        pub fn hashTreeRoot(_: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            if (value.items.len > limit) return error.gtLimit;
            var accumulator = MerkleAccumulator.init(chunk_depth);
            if (comptime isBasicType(Element)) {
                const items_per_chunk = 32 / Element.fixed_size;
                var next: usize = 0;
                for (0..chunkCount(value)) |_| {
                    var chunk: [32]u8 = @splat(0);
                    const end = next + @min(items_per_chunk, value.items.len - next);
                    if (comptime canMemcpySsz(Element)) {
                        const bytes = std.mem.sliceAsBytes(value.items[next..end]);
                        @memcpy(chunk[0..bytes.len], bytes);
                    } else {
                        for (value.items[next..end], 0..) |*element, i| {
                            _ = Element.serializeIntoBytes(element, chunk[i * Element.fixed_size ..]);
                        }
                    }
                    try accumulator.append(&chunk);
                    next = end;
                }
                std.debug.assert(next == value.items.len);
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
            try out.ensureTotalCapacity(allocator, value.items.len);

            for (value.items) |*element| {
                out.appendAssumeCapacity(DestinationST.Element.default_value);
                try Element.clone(element, &out.items[out.items.len - 1]);
            }
        }

        pub fn serializedSize(value: *const Type) usize {
            return value.items.len * Element.fixed_size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            if (comptime canMemcpySsz(Element)) {
                const bytes = std.mem.sliceAsBytes(value.items);
                @memcpy(out[0..bytes.len], bytes);
                return bytes.len;
            }
            var i: usize = 0;
            for (value.items) |element| {
                i += Element.serializeIntoBytes(&element, out[i..]);
            }
            return i;
        }

        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            const len = try std.math.divExact(usize, data.len, Element.fixed_size);
            if (len > limit) {
                return error.gtLimit;
            }

            try out.resize(allocator, len);
            if (comptime canMemcpySsz(Element)) {
                @memcpy(std.mem.sliceAsBytes(out.items[0..len]), data);
                return;
            }
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

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            // start array token "["
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            for (0..limit + 1) |i| {
                switch (try source.peekNextTokenType()) {
                    .array_end => {
                        _ = try source.next();
                        return;
                    },
                    else => {},
                }

                _ = try out.addOne(allocator);
                out.items[i] = Element.default_value;
                try Element.deserializeFromJson(source, &out.items[i]);
            }
            return error.invalidLength;
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                const len = try std.math.divExact(usize, data.len, Element.fixed_size);
                if (len > limit) {
                    return error.gtLimit;
                }
                for (0..len) |i| {
                    try Element.serialized.validate(data[i * Element.fixed_size .. (i + 1) * Element.fixed_size]);
                }
            }

            pub fn length(data: []const u8) !usize {
                const len = try std.math.divExact(usize, data.len, Element.fixed_size);
                if (len > limit) {
                    return error.gtLimit;
                }
                return len;
            }

            pub fn hashTreeRoot(_: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                const len = try length(data);
                var accumulator = MerkleAccumulator.init(chunk_depth);
                if (comptime isBasicType(Element)) {
                    var next: usize = 0;
                    for (0..(data.len + 31) / 32) |_| {
                        var chunk: [32]u8 = @splat(0);
                        const end = next + @min(32, data.len - next);
                        @memcpy(chunk[0 .. end - next], data[next..end]);
                        try accumulator.append(&chunk);
                        next = end;
                    }
                    std.debug.assert(next == data.len);
                } else {
                    for (0..len) |i| {
                        var chunk: [32]u8 = undefined;
                        try Element.serialized.hashTreeRoot(
                            data[i * Element.fixed_size .. (i + 1) * Element.fixed_size],
                            &chunk,
                        );
                        try accumulator.append(&chunk);
                    }
                }
                try accumulator.finish(out);
                mixInLength(len, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                return try pool.createBranch(
                    @enumFromInt(chunk_depth),
                    @enumFromInt(0),
                );
            }

            pub fn zeros(pool: *Node.Pool, len: usize) !Node.Id {
                if (len > limit) {
                    return error.gtLimit;
                }

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                if (comptime isBasicType(Element)) {
                    const content_root: Node.Id = @enumFromInt(chunk_depth);
                    return try pool.createBranch(content_root, len_mixin);
                } else {
                    var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                    errdefer it.deinit();

                    const element_zero = try Element.tree.default(pool);
                    errdefer pool.unref(element_zero);

                    for (0..len) |_| {
                        try it.append(element_zero);
                    }

                    const content_root = try it.finish();
                    errdefer pool.unref(content_root);

                    return try pool.createBranch(content_root, len_mixin);
                }
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                const len = try std.math.divExact(usize, data.len, Element.fixed_size);
                if (len > limit) {
                    return error.gtLimit;
                }
                if (comptime Element.kind == .bool) {
                    try serialized.validate(data);
                }

                const chunk_count = if (comptime isBasicType(Element))
                    (Element.fixed_size * len + 31) / 32
                else
                    len;

                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                return if (comptime use_chunked_leaf)
                    deserializeFromBytesChunkedLeaf(pool, data, len)
                else
                    deserializeFromBytesPlain(pool, data, len, chunk_count);
            }

            /// `deserializeFromBytes` for chunked_leaf layouts.
            fn deserializeFromBytesChunkedLeaf(pool: *Node.Pool, data: []const u8, len: usize) !Node.Id {
                var it = Node.SubtreeBuilder.initWithOffset(pool, chunked_leaf_depth, ChunkedLeaf.k_log2);
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

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            /// `deserializeFromBytes` for non-chunked_leaf layouts.
            fn deserializeFromBytesPlain(pool: *Node.Pool, data: []const u8, len: usize, chunk_count: usize) !Node.Id {
                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                if (comptime isBasicType(Element)) {
                    for (0..chunk_count - 1) |i| {
                        var chunk: [32]u8 = undefined;
                        @memcpy(chunk[0..32], data[i * 32 ..][0..32]);
                        try it.append(try pool.createLeaf(&chunk));
                    }
                    {
                        // last chunk may be partial
                        var chunk = [_]u8{0} ** 32;
                        const i = chunk_count - 1;
                        const remaining_bytes = (len * Element.fixed_size) - i * 32;
                        @memcpy(chunk[0..remaining_bytes], data[i * 32 ..][0..remaining_bytes]);
                        try it.append(try pool.createLeaf(&chunk));
                    }
                } else {
                    for (0..len) |i| {
                        const elem_bytes = data[i * Element.fixed_size .. (i + 1) * Element.fixed_size];
                        try it.append(try Element.tree.deserializeFromBytes(pool, elem_bytes));
                    }
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);
                return std.mem.readInt(usize, hash[0..8], .little);
            }

            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const len = try length(node, pool);
                const chunk_count = if (comptime isBasicType(Element))
                    (Element.fixed_size * len + 31) / 32
                else
                    len;

                if (chunk_count == 0) {
                    try out.resize(allocator, 0);
                    return;
                }

                try out.resize(allocator, len);
                @memset(out.items, Element.default_value);

                return if (comptime use_chunked_leaf)
                    toValueChunkedLeaf(node, pool, out, len, chunk_count)
                else
                    toValuePlain(node, pool, out, len, chunk_count);
            }

            /// `toValue` for chunked_leaf layouts. `out.items` is pre-resized
            /// to `len` and zero-initialised by the caller.
            fn toValueChunkedLeaf(node: Node.Id, pool: *Node.Pool, out: *Type, len: usize, chunk_count: usize) !void {
                const content_root = try node.getLeft(pool);
                const items_per_chunk = 32 / Element.fixed_size;
                const chunked_leaf_count = (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K;
                var it = Node.DepthIterator.init(pool, content_root, chunked_leaf_depth, 0);

                const state_col = pool.nodes.items(.state);
                var item_idx: usize = 0;
                outer: for (0..chunked_leaf_count) |_| {
                    const sid = try it.next();
                    // A zero subtree at chunked_leaf boundary is semantically an
                    // all-zero chunked_leaf — out.items already initialised to
                    // Element.default_value via the @memset above, so
                    // skip the chunked_leaf payload read entirely.
                    if (state_col[@intFromEnum(sid)].kind() == .zero) {
                        const items_in_chunked_leaf = @min(ChunkedLeaf.K * items_per_chunk, len - item_idx);
                        item_idx += items_in_chunked_leaf;
                        if (item_idx >= len) break :outer;
                        continue;
                    }
                    const chunks = try sid.getChunkedLeafChunks(pool);
                    for (0..ChunkedLeaf.K) |intra_chunk| {
                        if (item_idx >= len) break :outer;
                        const items_in_chunk = @min(items_per_chunk, len - item_idx);
                        for (0..items_in_chunk) |i| {
                            Element.tree.toValuePackedFromBytes(&chunks[intra_chunk], item_idx + i, &out.items[item_idx + i]);
                        }
                        item_idx += items_in_chunk;
                    }
                }
            }

            /// `toValue` for non-chunked_leaf layouts. `out.items` is
            /// pre-resized to `len` by the caller.
            fn toValuePlain(node: Node.Id, pool: *Node.Pool, out: *Type, len: usize, chunk_count: usize) !void {
                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                if (comptime isBasicType(Element)) {
                    const items_per_chunk = 32 / Element.fixed_size;
                    var next_item: usize = 0;
                    for (0..chunk_count) |_| {
                        const chunk = try it.next();
                        const end_item = next_item + @min(items_per_chunk, len - next_item);
                        if (comptime canMemcpySsz(Element)) {
                            const bytes = std.mem.sliceAsBytes(out.items[next_item..end_item]);
                            @memcpy(bytes, chunk.getRoot(pool)[0..bytes.len]);
                        } else {
                            for (next_item..end_item) |i| {
                                try Element.tree.toValuePacked(chunk, pool, i, &out.items[i]);
                            }
                        }
                        next_item = end_item;
                    }
                    std.debug.assert(next_item == len);
                } else {
                    for (out.items) |*item| {
                        try Element.tree.toValue(try it.next(), pool, item);
                    }
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const len = value.items.len;
                const chunk_count = chunkCount(value);
                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                return if (comptime use_chunked_leaf)
                    fromValueChunkedLeaf(pool, value, len)
                else
                    fromValuePlain(pool, value, len, chunk_count);
            }

            /// `fromValue` for chunked_leaf layouts.
            fn fromValueChunkedLeaf(pool: *Node.Pool, value: *const Type, len: usize) !Node.Id {
                var it = Node.SubtreeBuilder.initWithOffset(pool, chunked_leaf_depth, ChunkedLeaf.k_log2);
                errdefer it.deinit();

                const items_per_chunk = 32 / Element.fixed_size;
                const items_per_chunked_leaf: usize = items_per_chunk * ChunkedLeaf.K;
                var item_idx: usize = 0;

                while (item_idx < len) {
                    const remaining = len - item_idx;
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
                        _ = Element.serializeIntoBytes(&value.items[item_idx + k], dst_slice);
                    }

                    try it.append(chunked_leaf_id_opt.?);
                    chunked_leaf_id_opt = null;
                    item_idx += items_in_chunked_leaf;
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            /// `fromValue` for non-chunked_leaf layouts.
            fn fromValuePlain(pool: *Node.Pool, value: *const Type, len: usize, chunk_count: usize) !Node.Id {
                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                if (comptime isBasicType(Element)) {
                    const items_per_chunk = 32 / Element.fixed_size;
                    var next: usize = 0; // index in value.items

                    for (0..chunk_count) |_| {
                        var leaf_buf = [_]u8{0} ** 32;

                        // how many items still remain to be packed into this chunk?
                        const remaining = len - next;
                        const to_write = @min(remaining, items_per_chunk);

                        // serialise exactly to_write elements into the 32‑byte buffer
                        for (0..to_write) |j| {
                            const dst_off = j * Element.fixed_size;
                            const dst_slice = leaf_buf[dst_off .. dst_off + Element.fixed_size];
                            _ = Element.serializeIntoBytes(&value.items[next + j], dst_slice);
                        }
                        next += to_write;

                        try it.append(try pool.createLeaf(&leaf_buf));
                    }
                } else {
                    for (0..chunk_count) |i| {
                        try it.append(try Element.tree.fromValue(pool, &value.items[i]));
                    }
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                if (len == 0) {
                    return 0;
                }

                const chunk_count = if (comptime isBasicType(Element))
                    (Element.fixed_size * len + 31) / 32
                else
                    len;

                return if (comptime use_chunked_leaf)
                    serializeIntoBytesChunkedLeaf(node, pool, out, len, chunk_count)
                else
                    serializeIntoBytesPlain(node, pool, out, len, chunk_count);
            }

            /// `serializeIntoBytes` for chunked_leaf layouts.
            fn serializeIntoBytesChunkedLeaf(node: Node.Id, pool: *Node.Pool, out: []u8, len: usize, chunk_count: usize) !usize {
                const serialized_size = len * Element.fixed_size;
                const content_root = try node.getLeft(pool);
                const chunked_leaf_count = (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K;

                var it = Node.DepthIterator.init(pool, content_root, chunked_leaf_depth, 0);

                const state_col = pool.nodes.items(.state);
                var byte_idx: usize = 0;
                outer: for (0..chunked_leaf_count) |_| {
                    const sid = try it.next();
                    // Zero subtree at chunked_leaf boundary == all-zero output.
                    if (state_col[@intFromEnum(sid)].kind() == .zero) {
                        const remaining = serialized_size - byte_idx;
                        const zero_bytes = @min(ChunkedLeaf.K * 32, remaining);
                        @memset(out[byte_idx..][0..zero_bytes], 0);
                        byte_idx += zero_bytes;
                        if (byte_idx >= serialized_size) break :outer;
                        continue;
                    }
                    const chunks = try sid.getChunkedLeafChunks(pool);
                    for (0..ChunkedLeaf.K) |intra_chunk| {
                        if (byte_idx >= serialized_size) break :outer;
                        const remaining = serialized_size - byte_idx;
                        const bytes_to_copy = @min(remaining, 32);
                        @memcpy(out[byte_idx..][0..bytes_to_copy], chunks[intra_chunk][0..bytes_to_copy]);
                        byte_idx += bytes_to_copy;
                    }
                }
                std.debug.assert(byte_idx == serialized_size);
                return serialized_size;
            }

            /// `serializeIntoBytes` for non-chunked_leaf layouts.
            fn serializeIntoBytesPlain(node: Node.Id, pool: *Node.Pool, out: []u8, len: usize, chunk_count: usize) !usize {
                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                if (comptime isBasicType(Element)) {
                    const serialized_size = len * Element.fixed_size;
                    for (0..chunk_count) |i| {
                        const start_idx = i * 32;
                        const remaining_bytes = serialized_size - start_idx;
                        const bytes_to_copy = @min(remaining_bytes, 32);
                        if (bytes_to_copy > 0) {
                            @memcpy(out[start_idx..][0..bytes_to_copy], (try it.next()).getRoot(pool)[0..bytes_to_copy]);
                        }
                    }
                    return serialized_size;
                } else {
                    var offset: usize = 0;
                    for (0..len) |_| {
                        offset += try Element.tree.serializeIntoBytes((try it.next()), pool, out[offset..]);
                    }
                    return offset;
                }
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const len = try length(node, pool);
                return len * Element.fixed_size;
            }
        };
    };
}

pub fn VariableListType(comptime ST: type, comptime _limit: comptime_int) type {
    comptime {
        if (isFixedType(ST)) {
            @compileError("ST must not be fixed type");
        }
        if (_limit <= 0) {
            @compileError("limit must be greater than 0");
        }
    }
    return struct {
        const Self = @This();
        pub const kind = TypeKind.list;
        pub const Element: type = ST;
        pub const limit: usize = _limit;
        pub const Type: type = std.ArrayList(Element.Type);
        pub const TreeView: type = if (isBasicType(Element))
            ListBasicTreeView(@This())
        else
            ListCompositeTreeView(@This());
        pub const min_size: usize = 0;
        pub const max_size: usize = Element.max_size * limit + 4 * limit;
        pub const max_chunk_count: usize = limit;
        pub const chunk_depth: u8 = maxChunksToDepth(max_chunk_count);

        pub const default_value: Type = Type.empty;

        pub const default_root: [32]u8 = blk: {
            var buf = getZeroHash(chunk_depth).*;
            mixInLength(0, &buf);
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            if (a.items.len != b.items.len) {
                return false;
            }
            for (a.items, b.items) |a_elem, b_elem| {
                if (!Element.equals(&a_elem, &b_elem)) {
                    return false;
                }
            }
            return true;
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            for (value.items) |*element| {
                Element.deinit(allocator, element);
            }
            value.deinit(allocator);
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
            try out.ensureTotalCapacity(allocator, value.items.len);

            for (value.items) |*element| {
                out.appendAssumeCapacity(DestinationST.Element.default_value);
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
            if (value.items.len > limit) return error.gtLimit;
            var accumulator = MerkleAccumulator.init(chunk_depth);
            for (value.items) |*element| {
                var chunk: [32]u8 = undefined;
                try Element.hashTreeRoot(allocator, element, &chunk);
                try accumulator.append(&chunk);
            }
            try accumulator.finish(out);
            mixInLength(value.items.len, out);
        }

        pub fn serializedSize(value: *const Type) usize {
            // offsets size
            var size: usize = value.items.len * 4;
            // element sizes
            for (value.items) |element| {
                size += Element.serializedSize(&element);
            }
            return size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            var variable_index = value.items.len * 4;
            for (value.items, 0..) |element, i| {
                // write offset
                std.mem.writeInt(u32, out[i * 4 ..][0..4], @intCast(variable_index), .little);
                // write element data
                variable_index += Element.serializeIntoBytes(&element, out[variable_index..]);
            }
            return variable_index;
        }

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            try writer.beginArray();
            for (in.items) |element| {
                try Element.serializeIntoJson(allocator, writer, &element);
            }
            try writer.endArray();
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            var elements = try VariableElementIterator(Self).init(data);
            const len = elements.len;

            try out.resize(allocator, len);
            @memset(out.items[0..len], Element.default_value);

            var i: usize = 0;
            while (try elements.next()) |element_bytes| : (i += 1) {
                try Element.deserializeFromBytes(allocator, element_bytes, &out.items[i]);
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
                var accumulator = MerkleAccumulator.init(chunk_depth);
                for (0..elements.len) |_| {
                    var chunk: [32]u8 = undefined;
                    try Element.serialized.hashTreeRoot(allocator, (try elements.next()).?, &chunk);
                    try accumulator.append(&chunk);
                }
                try accumulator.finish(out);
                mixInLength(elements.len, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                return try pool.createBranch(
                    @enumFromInt(chunk_depth),
                    @enumFromInt(0),
                );
            }

            pub fn zeros(pool: *Node.Pool, len: usize) !Node.Id {
                if (len > limit) {
                    return error.gtLimit;
                }

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                const element_zero = try Element.tree.default(pool);
                errdefer pool.unref(element_zero);

                for (0..len) |_| {
                    try it.append(element_zero);
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                var elements = try VariableElementIterator(Self).init(data);
                const len = elements.len;

                if (len == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                while (try elements.next()) |elem_bytes| {
                    try it.append(try Element.tree.deserializeFromBytes(pool, elem_bytes));
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);
                return std.mem.readInt(usize, hash[0..8], .little);
            }

            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const len = try length(node, pool);
                const chunk_count = len;
                if (chunk_count == 0) {
                    try out.resize(allocator, 0);
                    return;
                }

                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                try out.resize(allocator, len);
                @memset(out.items, Element.default_value);
                for (out.items) |*item| {
                    try Element.tree.toValue(allocator, try it.next(), pool, item);
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const len = value.items.len;
                const chunk_count = len;
                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                for (0..chunk_count) |i| {
                    try it.append(try Element.tree.fromValue(pool, &value.items[i]));
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);

                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                if (len == 0) {
                    return 0;
                }

                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                const fixed_end = len * 4;
                var variable_index = fixed_end;

                for (0..len) |i| {
                    std.mem.writeInt(u32, out[i * 4 ..][0..4], @intCast(variable_index), .little);
                    variable_index += try Element.tree.serializeIntoBytes((try it.next()), pool, out[variable_index..]);
                }

                return variable_index;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const len = try length(node, pool);
                if (len == 0) {
                    return 0;
                }

                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                var total_size: usize = len * 4; // Offsets
                for (0..len) |_| {
                    total_size += try Element.tree.serializedSize((try it.next()), pool);
                }
                return total_size;
            }
        };

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            // start array token "["
            switch (try source.next()) {
                .array_begin => {},
                else => return error.InvalidJson,
            }

            for (0..limit + 1) |i| {
                switch (try source.peekNextTokenType()) {
                    .array_end => {
                        _ = try source.next();
                        return;
                    },
                    else => {},
                }

                _ = try out.addOne(allocator);
                out.items[i] = Element.default_value;
                try Element.deserializeFromJson(allocator, source, &out.items[i]);
            }
            return error.invalidLength;
        }
    };
}

test {
    _ = @import("list_test.zig");
}
