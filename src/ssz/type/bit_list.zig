const std = @import("std");
const BitList = @import("bit_array").BitList;
const TypeKind = @import("type_kind.zig").TypeKind;
const BoolType = @import("bool.zig").BoolType;
const hexToBytes = @import("hex").hexToBytes;
const bytesToHex = @import("hex").bytesToHex;
const hexByteLen = @import("hex").hexByteLen;
const hexLenFromBytes = @import("hex").hexLenFromBytes;
const MerkleAccumulator = @import("hashing").MerkleAccumulator;
const mixInLength = @import("hashing").mixInLength;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const getZeroHash = @import("hashing").getZeroHash;
const Node = @import("persistent_merkle_tree").Node;
const BitListTreeView = @import("../tree_view/root.zig").BitListTreeView;

pub fn isBitListType(ST: type) bool {
    return ST.kind == .list and ST.Element.kind == .bool and ST.Type == BitList(.{ .limit = ST.limit });
}

pub fn BitListType(comptime _limit: comptime_int) type {
    comptime {
        if (_limit <= 0) {
            @compileError("limit must be greater than 0");
        }
    }
    return struct {
        pub const kind = TypeKind.list;
        pub const Element: type = BoolType();
        pub const limit: usize = _limit;
        pub const Type: type = BitList(.{ .limit = limit });
        pub const TreeView: type = BitListTreeView(@This());
        pub const min_size: usize = 1;
        pub const max_size: usize = std.math.divCeil(usize, limit + 1, 8) catch unreachable;
        pub const max_chunk_count: usize = std.math.divCeil(usize, limit, 256) catch unreachable;
        pub const chunk_depth: u8 = maxChunksToDepth(max_chunk_count);

        pub const default_value: Type = Type.empty;

        pub const default_root: [32]u8 = blk: {
            var buf = getZeroHash(chunk_depth).*;
            mixInLength(0, &buf);
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            return a.equals(b);
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            value.data.deinit(allocator);
        }

        pub fn chunkCount(value: *const Type) usize {
            return (value.bit_len + 255) / 256;
        }

        pub fn hashTreeRoot(_: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            const data = value.data.items;
            std.debug.assert(value.bit_len <= limit);
            std.debug.assert(data.len == (std.math.divCeil(usize, value.bit_len, 8) catch unreachable));

            const full_chunk_count = data.len / 32;
            var accumulator = MerkleAccumulator.init(chunk_depth);
            for (0..full_chunk_count) |i| {
                try accumulator.append(data[i * 32 ..][0..32]);
            }
            const tail = data[full_chunk_count * 32 ..];
            if (tail.len != 0) {
                var chunk: [32]u8 = @splat(0);
                @memcpy(chunk[0..tail.len], tail);
                try accumulator.append(&chunk);
            }
            try accumulator.finish(out);
            mixInLength(value.bit_len, out);
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
            out.data = try value.data.clone(allocator);
            out.bit_len = value.bit_len;
        }

        pub fn serializedSize(value: *const Type) usize {
            return std.math.divCeil(usize, value.bit_len + 1, 8) catch unreachable;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            const bit_len = value.bit_len + 1; // + 1 for padding bit
            const byte_len = std.math.divCeil(usize, bit_len, 8) catch unreachable;
            if (value.bit_len % 8 == 0) {
                @memcpy(out[0 .. byte_len - 1], value.data.items);
                // setting the byte in its entirety here
                // ensures that a possibly uninitialized byte gets overridden entirely
                out[byte_len - 1] = 1;
            } else {
                @memcpy(out[0..byte_len], value.data.items);
                out[byte_len - 1] |= @as(u8, 1) << @intCast((bit_len - 1) % 8);
            }
            return byte_len;
        }

        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            if (data.len == 0) {
                return error.InvalidSize;
            }

            // ensure padding bit and trailing zeros in last byte
            const last_byte = data[data.len - 1];

            const last_byte_clz = @clz(last_byte);
            if (last_byte_clz == 8) {
                return error.noPaddingBit;
            }
            const last_1_index: u3 = @intCast(7 - last_byte_clz);
            const bit_len = (data.len - 1) * 8 + last_1_index;
            if (bit_len > limit) {
                return error.tooLarge;
            }

            try out.resize(allocator, bit_len);
            if (bit_len == 0) {
                return;
            }

            // if the bit_len is a multiple of 8, we just copy one byte less
            // and avoid removing the padding bit after
            if (bit_len % 8 == 0) {
                @memcpy(out.data.items, data[0 .. data.len - 1]);
            } else {
                @memcpy(out.data.items, data);

                // remove padding bit
                out.data.items[out.data.items.len - 1] ^= @as(u8, 1) << last_1_index;
            }
        }

        pub const serialized = struct {
            const Parsed = struct {
                bit_len: usize,
                padding_bit_index: u3,
            };

            inline fn parse(data: []const u8) !Parsed {
                if (data.len == 0) {
                    return error.InvalidSize;
                }

                // ensure 1 bit and trailing zeros in last byte
                const last_byte = data[data.len - 1];

                const last_byte_clz = @clz(last_byte);
                if (last_byte_clz == 8) {
                    return error.noPaddingBit;
                }
                const last_1_index: u3 = @intCast(7 - last_byte_clz);
                const bit_len = (data.len - 1) * 8 + last_1_index;
                if (bit_len > limit) {
                    return error.tooLarge;
                }
                return .{
                    .bit_len = bit_len,
                    .padding_bit_index = last_1_index,
                };
            }

            pub fn validate(data: []const u8) !void {
                _ = try parse(data);
            }

            pub fn length(data: []const u8) !usize {
                return (try parse(data)).bit_len;
            }

            pub fn hashTreeRoot(_: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                const parsed = try parse(data);
                // A 32-byte final chunk can still contain the delimiter.
                const full_chunk_count = parsed.bit_len / 256;
                var accumulator = MerkleAccumulator.init(chunk_depth);
                for (0..full_chunk_count) |i| {
                    try accumulator.append(data[i * 32 ..][0..32]);
                }
                const tail_bit_len = parsed.bit_len % 256;
                if (tail_bit_len != 0) {
                    var chunk: [32]u8 = @splat(0);
                    const tail_byte_len = (tail_bit_len + 7) / 8;
                    @memcpy(chunk[0..tail_byte_len], data[full_chunk_count * 32 ..][0..tail_byte_len]);
                    if (tail_bit_len % 8 != 0) {
                        chunk[tail_byte_len - 1] ^= @as(u8, 1) << parsed.padding_bit_index;
                    }
                    try accumulator.append(&chunk);
                }
                try accumulator.finish(out);
                mixInLength(parsed.bit_len, out);
            }
        };

        pub const tree = struct {
            pub fn default(pool: *Node.Pool) !Node.Id {
                return try pool.createBranch(
                    @enumFromInt(chunk_depth),
                    @enumFromInt(0),
                );
            }

            pub fn zeros(pool: *Node.Pool, bit_len: usize) !Node.Id {
                if (bit_len > limit) {
                    return error.tooLarge;
                }
                const len_mixin = try pool.createLeafFromUint(bit_len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(
                    @enumFromInt(chunk_depth),
                    len_mixin,
                );
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                const bit_len = try serialized.length(data);
                const chunk_count = (bit_len + 255) / 256;

                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                for (0..chunk_count - 1) |i| {
                    var chunk: [32]u8 = undefined;
                    @memcpy(chunk[0..32], data[i * 32 ..][0..32]);
                    try it.append(try pool.createLeaf(&chunk));
                }
                {
                    // last chunk may be partial
                    var chunk = [_]u8{0} ** 32;
                    const raw_byte_length = (bit_len + 7) / 8;
                    const i = chunk_count - 1;
                    const remaining_bytes = raw_byte_length - i * 32;
                    @memcpy(chunk[0..remaining_bytes], data[i * 32 ..][0..remaining_bytes]);
                    // remove padding bit
                    if (bit_len % 8 != 0) {
                        const last_1_index: u3 = @intCast(bit_len % 8);
                        chunk[remaining_bytes - 1] ^= @as(u8, 1) << last_1_index;
                    }
                    try it.append(try pool.createLeaf(&chunk));
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);
                const len_mixin = try pool.createLeafFromUint(bit_len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);
                return std.mem.readInt(usize, hash[0..8], .little);
            }

            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const bit_len = try length(node, pool);
                try out.resize(allocator, bit_len);
                const chunk_count = (bit_len + 255) / 256;
                const byte_length = out.data.items.len;
                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);
                for (0..chunk_count) |i| {
                    const start = i * 32;
                    const len = @min(32, byte_length - start);
                    const chunk = try it.next();
                    @memcpy(out.data.items[start..][0..len], chunk.getRoot(pool)[0..len]);
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const chunk_count = chunkCount(value);
                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }
                const byte_length = (value.bit_len + 7) / 8;

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                for (0..chunk_count) |i| {
                    var leaf_buf = [_]u8{0} ** 32;
                    const start_idx = i * 32;
                    const remaining_bytes = byte_length - start_idx;

                    // Determine how many bytes to copy for this chunk
                    const bytes_to_copy = @min(remaining_bytes, 32);

                    // Copy data if there are bytes to copy
                    if (bytes_to_copy > 0) {
                        @memcpy(leaf_buf[0..bytes_to_copy], value.data.items[start_idx..][0..bytes_to_copy]);
                    }

                    try it.append(try pool.createLeaf(&leaf_buf));
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);
                const len_mixin = try pool.createLeafFromUint(value.bit_len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            /// Serialize BitList to bytes.
            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const bit_len = try length(node, pool);
                const serialized_bit_len = bit_len + 1; // + 1 for padding bit
                const byte_len = std.math.divCeil(usize, serialized_bit_len, 8) catch unreachable;
                const chunk_count = (bit_len + 255) / 256;

                if (chunk_count == 0) {
                    // Empty list - just set padding bit
                    out[0] = 1;
                    return 1;
                }

                const raw_byte_length = (bit_len + 7) / 8;

                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                for (0..chunk_count) |i| {
                    const start_idx = i * 32;
                    const remaining_bytes = raw_byte_length - start_idx;
                    const bytes_to_copy = @min(remaining_bytes, 32);
                    if (bytes_to_copy > 0) {
                        @memcpy(out[start_idx..][0..bytes_to_copy], (try it.next()).getRoot(pool)[0..bytes_to_copy]);
                    }
                }

                if (bit_len % 8 == 0) {
                    out[byte_len - 1] = 1;
                } else {
                    out[byte_len - 1] |= @as(u8, 1) << @intCast((serialized_bit_len - 1) % 8);
                }
                return byte_len;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                const bit_len = try length(node, pool);
                return std.math.divCeil(usize, bit_len + 1, 8) catch unreachable;
            }
        };

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            const bytes = try allocator.alloc(u8, serializedSize(in));
            defer allocator.free(bytes);
            _ = serializeIntoBytes(in, bytes);

            const byte_str = try allocator.alloc(u8, hexLenFromBytes(bytes));
            defer allocator.free(byte_str);

            _ = try bytesToHex(byte_str, bytes);
            try writer.print("\"{s}\"", .{byte_str});
        }

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            const hex_bytes = switch (try source.next()) {
                .string => |v| v,
                else => return error.InvalidJson,
            };
            const bytes = try allocator.alloc(u8, hexByteLen(hex_bytes));
            defer allocator.free(bytes);
            const written = try hexToBytes(bytes, hex_bytes);
            if (written.len > max_size) {
                return error.invalidLength;
            }
            try deserializeFromBytes(allocator, bytes, out);
        }
    };
}

test {
    _ = @import("bit_list_test.zig");
}
