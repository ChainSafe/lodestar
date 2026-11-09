const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const UintType = @import("uint.zig").UintType;
const hexToBytes = @import("hex").hexToBytes;
const hexByteLen = @import("hex").hexByteLen;
const bytesToHex = @import("hex").bytesToHex;
const merkleize = @import("hashing").merkleize;
const maxChunksToDepth = @import("hashing").maxChunksToDepth;
const getZeroHash = @import("hashing").getZeroHash;
const Depth = @import("persistent_merkle_tree").Depth;
const Node = @import("persistent_merkle_tree").Node;
const ArrayBasicTreeView = @import("../tree_view/root.zig").ArrayBasicTreeView;

pub fn isByteVectorType(ST: type) bool {
    return ST.kind == .vector and ST.Element.kind == .uint and ST.Element.fixed_size == 1 and ST == ByteVectorType(ST.length);
}

pub fn ByteVectorType(comptime _length: comptime_int) type {
    comptime {
        if (_length <= 0) {
            @compileError("length must be greater than 0");
        }
    }
    return struct {
        pub const kind = TypeKind.vector;
        pub const Element: type = UintType(8);
        pub const length: usize = _length;
        pub const opts: @import("list.zig").TypeOpts = .{};
        pub const Type: type = [length]Element.Type;
        pub const TreeView: type = ArrayBasicTreeView(@This());
        pub const fixed_size: usize = Element.fixed_size * length;
        pub const chunk_count: usize = std.math.divCeil(usize, fixed_size, 32) catch unreachable;
        pub const chunk_depth: Depth = maxChunksToDepth(chunk_count);

        pub const default_value: Type = [_]Element.Type{Element.default_value} ** length;

        pub const default_root: [32]u8 = getZeroHash(chunk_depth).*;

        pub fn equals(a: *const Type, b: *const Type) bool {
            return std.mem.eql(u8, a, b);
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
            _ = serializeIntoBytes(value, @ptrCast(&chunks));
            try merkleize(@ptrCast(&chunks), chunk_depth, out);
        }

        pub fn clone(value: *const Type, out: *Type) !void {
            out.* = value.*;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            @memcpy(out[0..fixed_size], value);
            return length;
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            if (data.len != fixed_size) {
                return error.InvalidSize;
            }

            @memcpy(out, data[0..fixed_size]);
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
            }

            pub fn hashTreeRoot(data: []const u8, out: *[32]u8) !void {
                var chunks = [_][32]u8{[_]u8{0} ** 32} ** ((chunk_count + 1) / 2 * 2);
                @memcpy(@as([]u8, @ptrCast(&chunks))[0..fixed_size], data);
                try merkleize(@ptrCast(&chunks), chunk_depth, out);
            }
        };

        pub const tree = struct {
            pub fn default(_: *Node.Pool) !Node.Id {
                return @enumFromInt(chunk_depth);
            }

            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }

                var chunks: [chunk_count][32]u8 = [_][32]u8{[_]u8{0} ** 32} ** chunk_count;
                const chunk_bytes: []u8 = @ptrCast(&chunks);
                @memcpy(chunk_bytes[0..length], data[0..length]);

                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                for (&chunks, 0..) |*chunk, i| {
                    nodes[i] = try pool.createLeaf(chunk);
                }

                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);
                for (0..chunk_count) |i| {
                    const start_idx = i * 32;
                    const remaining_bytes = length - start_idx;

                    // Determine how many bytes to copy for this chunk
                    const bytes_to_copy = @min(remaining_bytes, 32);

                    // Copy data if there are bytes to copy
                    if (bytes_to_copy > 0) {
                        @memcpy(out[start_idx..][0..bytes_to_copy], nodes[i].getRoot(pool)[0..bytes_to_copy]);
                    }
                }
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var nodes: [chunk_count]Node.Id = @splat(@as(Node.Id, @enumFromInt(0)));
                errdefer pool.free(&nodes);

                for (0..chunk_count) |i| {
                    var leaf_buf = [_]u8{0} ** 32;
                    const start_idx = i * 32;
                    const remaining_bytes = length - start_idx;

                    // Determine how many bytes to copy for this chunk
                    const bytes_to_copy = @min(remaining_bytes, 32);

                    // Copy data if there are bytes to copy
                    if (bytes_to_copy > 0) {
                        @memcpy(leaf_buf[0..bytes_to_copy], value[start_idx..][0..bytes_to_copy]);
                    }

                    nodes[i] = try pool.createLeaf(&leaf_buf);
                }
                return try Node.fillWithContents(pool, &nodes, chunk_depth);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                var nodes: [chunk_count]Node.Id = undefined;
                try node.getNodesAtDepth(pool, chunk_depth, 0, &nodes);
                for (0..chunk_count) |i| {
                    const start_idx = i * 32;
                    const remaining_bytes = length - start_idx;
                    const bytes_to_copy = @min(remaining_bytes, 32);
                    if (bytes_to_copy > 0) {
                        @memcpy(out[start_idx..][0..bytes_to_copy], nodes[i].getRoot(pool)[0..bytes_to_copy]);
                    }
                }
                return fixed_size;
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            var byte_str: [2 + 2 * fixed_size]u8 = undefined;

            _ = try bytesToHex(&byte_str, in);
            try writer.print("\"{s}\"", .{byte_str});
        }

        pub fn deserializeFromJson(source: *std.json.Scanner, out: *Type) !void {
            const hex_bytes = switch (try source.next()) {
                .string => |v| v,
                else => return error.InvalidJson,
            };

            if (hexByteLen(hex_bytes) != length) {
                return error.InvalidJson;
            }
            _ = try hexToBytes(out, hex_bytes);
        }
    };
}

test {
    _ = @import("byte_vector_test.zig");
}
