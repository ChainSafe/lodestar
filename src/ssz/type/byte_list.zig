const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const UintType = @import("uint.zig").UintType;
const hexToBytes = @import("hex").hexToBytes;
const hexByteLen = @import("hex").hexByteLen;
const hexLenFromBytes = @import("hex").hexLenFromBytes;
const bytesToHex = @import("hex").bytesToHex;
const mixInLength = @import("hashing").mixInLength;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const getZeroHash = @import("hashing").getZeroHash;
const Depth = @import("persistent_merkle_tree").Depth;
const Node = @import("persistent_merkle_tree").Node;
const ListBasicTreeView = @import("../tree_view/root.zig").ListBasicTreeView;

pub fn isByteListType(ST: type) bool {
    return ST.kind == .list and ST.Element.kind == .uint and ST.Element.fixed_size == 1 and ST == ByteListType(ST.limit);
}

pub fn ByteListType(comptime _limit: comptime_int) type {
    comptime {
        if (_limit <= 0) {
            @compileError("limit must be greater than 0");
        }
    }
    return struct {
        pub const kind = TypeKind.list;
        pub const Element: type = UintType(8);
        pub const limit: usize = _limit;
        pub const opts: @import("list.zig").TypeOpts = .{};
        pub const Type: type = std.ArrayList(Element.Type);
        pub const TreeView: type = ListBasicTreeView(@This());
        pub const min_size: usize = 0;
        pub const max_size: usize = Element.fixed_size * limit;
        pub const max_chunk_count: usize = std.math.divCeil(usize, max_size, 32) catch unreachable;
        pub const chunk_depth: Depth = maxChunksToDepth(max_chunk_count);
        const GenericList = @import("list.zig").FixedListType(Element, limit, .{});

        pub const default_value: Type = Type.empty;

        pub const default_root: [32]u8 = blk: {
            var buf = getZeroHash(chunk_depth).*;
            mixInLength(0, &buf);
            break :blk buf;
        };

        pub fn equals(a: *const Type, b: *const Type) bool {
            return std.mem.eql(u8, a.items, b.items);
        }

        pub fn deinit(allocator: std.mem.Allocator, value: *Type) void {
            value.deinit(allocator);
        }

        pub fn chunkCount(value: *const Type) usize {
            return (value.items.len + 31) / 32;
        }

        pub const hashTreeRoot = GenericList.hashTreeRoot;

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
            out.* = try value.clone(allocator);
        }

        pub fn serializedSize(value: *const Type) usize {
            return value.items.len * Element.fixed_size;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            @memcpy(out[0..value.items.len], value.items);
            return value.items.len;
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len > limit) {
                    return error.gtLimit;
                }
            }

            pub fn length(data: []const u8) !usize {
                if (data.len > limit) {
                    return error.gtLimit;
                }
                return data.len;
            }

            pub const hashTreeRoot = GenericList.serialized.hashTreeRoot;
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
                    return error.tooLarge;
                }
                const len_mixin = try pool.createLeafFromUint(len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(
                    @enumFromInt(chunk_depth),
                    len_mixin,
                );
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len > limit) {
                    return error.gtLimit;
                }

                const len: usize = data.len;
                const chunk_count = (len + 31) / 32;
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
                    const i = chunk_count - 1;
                    const remaining_bytes = len - i * 32;
                    @memcpy(chunk[0..remaining_bytes], data[i * 32 ..][0..remaining_bytes]);
                    try it.append(try pool.createLeaf(&chunk));
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

            pub const toValue = GenericList.tree.toValue;

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const chunk_count = chunkCount(value);
                if (chunk_count == 0) {
                    return try pool.createBranch(
                        @enumFromInt(chunk_depth),
                        @enumFromInt(0),
                    );
                }

                var it = Node.SubtreeBuilder.init(pool, chunk_depth);
                errdefer it.deinit();

                for (0..chunk_count) |i| {
                    var leaf_buf = [_]u8{0} ** 32;
                    const start_idx = i * 32;
                    const remaining_bytes = value.items.len - start_idx;

                    // Determine how many bytes to copy for this chunk
                    const bytes_to_copy = @min(remaining_bytes, 32);

                    // Copy data if there are bytes to copy
                    if (bytes_to_copy > 0) {
                        @memcpy(leaf_buf[0..bytes_to_copy], value.items[start_idx..][0..bytes_to_copy]);
                    }

                    try it.append(try pool.createLeaf(&leaf_buf));
                }

                const content_root = try it.finish();
                errdefer pool.unref(content_root);
                const len_mixin = try pool.createLeafFromUint(value.items.len);
                errdefer pool.unref(len_mixin);

                return try pool.createBranch(content_root, len_mixin);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const len = try length(node, pool);
                const chunk_count = (len + 31) / 32;
                if (chunk_count == 0) {
                    return 0;
                }

                var it = Node.DepthIterator.init(pool, node, chunk_depth + 1, 0);

                for (0..chunk_count) |i| {
                    const start_idx = i * 32;
                    const remaining_bytes = len - start_idx;
                    const bytes_to_copy = @min(remaining_bytes, 32);
                    if (bytes_to_copy > 0) {
                        @memcpy(out[start_idx..][0..bytes_to_copy], (try it.next()).getRoot(pool)[0..bytes_to_copy]);
                    }
                }
                return len;
            }

            pub fn serializedSize(node: Node.Id, pool: *Node.Pool) !usize {
                return try length(node, pool);
            }
        };

        pub fn deserializeFromBytes(allocator: std.mem.Allocator, data: []const u8, out: *Type) !void {
            if (data.len > limit) {
                return error.invalidLength;
            }

            try out.resize(allocator, data.len);
            @memcpy(out.items, data);
        }

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            const byte_str = try allocator.alloc(u8, hexLenFromBytes(in.*.items));
            defer allocator.free(byte_str);

            _ = try bytesToHex(byte_str, in.*.items);
            try writer.print("\"{s}\"", .{byte_str});
        }

        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            const hex_bytes = switch (try source.next()) {
                .string => |v| v,
                else => return error.InvalidJson,
            };

            const hex_bytes_len = hexByteLen(hex_bytes);
            if (hex_bytes_len > limit) {
                return error.InvalidJson;
            }

            try out.resize(allocator, hex_bytes_len);
            _ = try hexToBytes(out.items, hex_bytes);
        }
    };
}

test {
    _ = @import("byte_list_test.zig");
}
