const std = @import("std");
const BitList = @import("bit_array").BitList;
const unlimited = @import("bit_array").unlimited;
const expectEqualRootsAlloc = @import("test_utils.zig").expectEqualRootsAlloc;
const expectEqualSerializedAlloc = @import("test_utils.zig").expectEqualSerializedAlloc;
const TypeKind = @import("type_kind.zig").TypeKind;
const BoolType = @import("bool.zig").BoolType;
const hexToBytes = @import("hex").hexToBytes;
const bytesToHex = @import("hex").bytesToHex;
const hexByteLen = @import("hex").hexByteLen;
const hexLenFromBytes = @import("hex").hexLenFromBytes;
const mixInLength = @import("hashing").mixInLength;
const Node = @import("persistent_merkle_tree").Node;
const progressive = @import("progressive.zig");
const chunk_utils = @import("chunk.zig");

pub fn isProgressiveBitListType(ST: type) bool {
    return ST.kind == .progressive_bit_list;
}

pub fn ProgressiveBitListType() type {
    return struct {
        const Self = @This();
        pub const kind = TypeKind.progressive_bit_list;
        pub const Element: type = BoolType();
        pub const Type: type = BitList(.{ .limit = unlimited });
        pub const min_size: usize = 1;
        pub const max_size: usize = std.math.maxInt(usize);

        pub const default_value: Type = Type.empty;

        pub fn equals(a: *const Type, b: *const Type) bool {
            return a.equals(b);
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            value.data.deinit(allocator);
        }

        pub fn chunkCount(value: *const Type) usize {
            return chunkCountForLength(value.bit_len);
        }

        fn chunkCountForLength(bit_len: usize) usize {
            return bit_len / 256 + @intFromBool(bit_len % 256 != 0);
        }

        pub fn hashTreeRoot(_: std.mem.Allocator, value: *const Type, out: *[32]u8) !void {
            var accumulator = try progressive.MerkleAccumulator.init(chunkCount(value));
            var chunks = std.mem.window(u8, value.data.items, 32, 32);
            while (chunks.next()) |bytes| {
                const chunk = chunk_utils.fromBytes(bytes);
                try accumulator.append(&chunk);
            }
            try accumulator.finish(out);
            mixInLength(value.bit_len, out);
        }

        /// Clones the underlying `ArrayList` in `data`.
        ///
        /// Caller owns the memory.
        pub fn clone(allocator: std.mem.Allocator, value: *const Type, out: *Type) !void {
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

        const SerializedChunkIterator = struct {
            bytes: std.mem.WindowIterator(u8),
            bit_len: usize,

            fn init(data: []const u8) !SerializedChunkIterator {
                const bit_len = try serialized.length(data);
                const byte_len = bit_len / 8 + @intFromBool(bit_len % 8 != 0);
                return .{ .bytes = std.mem.window(u8, data[0..byte_len], 32, 32), .bit_len = bit_len };
            }

            /// Borrows full chunks from the input; uses `out` only for padding or delimiter removal.
            fn next(self: *SerializedChunkIterator, out: *[32]u8) ?*const [32]u8 {
                const bytes = self.bytes.next() orelse return null;
                const has_delimiter = self.bytes.index == null and self.bit_len % 8 != 0;
                if (bytes.len == 32 and !has_delimiter) return bytes[0..32];
                out.* = chunk_utils.fromBytes(bytes);
                if (has_delimiter) {
                    out[bytes.len - 1] &= ~(@as(u8, 1) << @intCast(self.bit_len % 8));
                }
                return out;
            }
        };

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
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
                _ = bit_len;
            }

            pub fn length(data: []const u8) !usize {
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
                return bit_len;
            }

            pub fn hashTreeRoot(_: std.mem.Allocator, data: []const u8, out: *[32]u8) !void {
                var chunks = try SerializedChunkIterator.init(data);
                var accumulator = try progressive.MerkleAccumulator.init(chunkCountForLength(chunks.bit_len));
                var scratch: [32]u8 = undefined;
                while (chunks.next(&scratch)) |chunk| try accumulator.append(chunk);
                try accumulator.finish(out);
                mixInLength(chunks.bit_len, out);
            }
        };

        pub const tree = struct {
            pub fn length(node: Node.Id, pool: *Node.Pool) !usize {
                const right = try node.getRight(pool);
                const hash = right.getRoot(pool);
                return std.mem.readInt(usize, hash[0..8], .little);
            }

            /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
            pub fn toValue(allocator: std.mem.Allocator, node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const bit_len = try length(node, pool);
                const chunk_count = bit_len / 256 + @intFromBool(bit_len % 256 != 0);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), chunk_count);
                var value = Self.default_value;
                errdefer Self.deinit(allocator, &value);
                try value.resize(allocator, bit_len);
                var offset: usize = 0;
                while (try it.next()) |chunk| {
                    const count = @min(32, value.data.items.len - offset);
                    @memcpy(value.data.items[offset..][0..count], chunk.getRoot(pool)[0..count]);
                    offset += count;
                }
                std.debug.assert(offset == value.data.items.len);
                out.* = value;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                return (try length(node, pool)) / 8 + 1;
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const bit_len = try length(node, pool);
                const size = bit_len / 8 + 1;
                if (out.len < size) return error.InvalidSize;
                const byte_len = bit_len / 8 + @intFromBool(bit_len % 8 != 0);
                const chunk_count = bit_len / 256 + @intFromBool(bit_len % 256 != 0);
                var it = try progressive.NodeIterator.init(pool, try node.getLeft(pool), chunk_count);
                var offset: usize = 0;
                while (try it.next()) |chunk| {
                    const count = @min(32, byte_len - offset);
                    @memcpy(out[offset..][0..count], chunk.getRoot(pool)[0..count]);
                    offset += count;
                }
                std.debug.assert(offset == byte_len);
                if (bit_len % 8 == 0) {
                    out[size - 1] = 1;
                } else {
                    out[size - 1] |= @as(u8, 1) << @intCast(bit_len % 8);
                }
                return size;
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                var chunks = try SerializedChunkIterator.init(data);
                var builder = try progressive.TreeBuilder.init(pool, chunkCountForLength(chunks.bit_len));
                defer builder.deinit();
                var scratch: [32]u8 = undefined;
                while (chunks.next(&scratch)) |chunk| try builder.appendOwned(try pool.createLeaf(chunk));
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(chunks.bit_len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var builder = try progressive.TreeBuilder.init(pool, chunkCount(value));
                defer builder.deinit();
                var chunks = std.mem.window(u8, value.data.items, 32, 32);
                while (chunks.next()) |bytes| {
                    const chunk = chunk_utils.fromBytes(bytes);
                    try builder.appendOwned(try pool.createLeaf(&chunk));
                }
                const contents = try builder.finish();
                errdefer pool.unref(contents);
                const length_leaf = try pool.createLeafFromUint(value.bit_len);
                errdefer pool.unref(length_leaf);
                return try pool.createBranch(contents, length_leaf);
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
            _ = try hexToBytes(bytes, hex_bytes);
            try deserializeFromBytes(allocator, bytes, out);
        }
    };
}

test {
    _ = @import("progressive_bit_list_test.zig");
}
