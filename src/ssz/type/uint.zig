const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const Node = @import("persistent_merkle_tree").Node;

pub fn UintType(comptime bits: comptime_int) type {
    const NativeType = switch (bits) {
        8 => u8,
        16 => u16,
        32 => u32,
        64 => u64,
        128 => u128,
        256 => u256,
        else => @compileError("bits must be 8, 16, 32, 64, 128, 256"),
    };
    const bytes = bits / 8;
    return struct {
        pub const kind = TypeKind.uint;
        pub const Type: type = NativeType;
        pub const fixed_size: usize = bytes;

        pub const default_value: Type = 0;

        pub const default_root: [32]u8 = [_]u8{0} ** 32;

        pub fn equals(a: *const Type, b: *const Type) bool {
            return a.* == b.*;
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            @memset(out, 0);
            std.mem.writeInt(Type, out[0..fixed_size], value.*, .little);
        }

        pub fn clone(value: *const Type, out: *Type) !void {
            out.* = value.*;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            std.mem.writeInt(Type, out[0..bytes], value.*, .little);
            return bytes;
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            if (data.len != fixed_size) {
                return error.InvalidSize;
            }

            out.* = std.mem.readInt(Type, data[0..bytes], .little);
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
            }

            pub fn hashTreeRoot(data: []const u8, out: *[32]u8) !void {
                @memset(out, 0);
                @memcpy(out[0..fixed_size], data);
            }
        };

        pub const tree = struct {
            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                if (data.len != fixed_size) {
                    return error.InvalidSize;
                }
                var leaf: [32]u8 = [_]u8{0} ** 32;
                @memcpy(leaf[0..fixed_size], data);
                return try pool.createLeaf(&leaf);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const hash = node.getRoot(pool);
                out.* = std.mem.readInt(Type, hash[0..bytes], .little);
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                var new_leaf: [32]u8 = [_]u8{0} ** 32;
                std.mem.writeInt(Type, new_leaf[0..bytes], value.*, .little);
                return try pool.createLeaf(&new_leaf);
            }

            pub fn toValuePacked(node: Node.Id, pool: *Node.Pool, index: usize, out: *Type) !void {
                const hash = node.getRoot(pool);
                const offset = index * fixed_size % 32;
                out.* = std.mem.readInt(Type, hash[offset..][0..fixed_size], .little);
            }

            pub fn fromValuePacked(node: Node.Id, pool: *Node.Pool, index: usize, value: *const Type) !Node.Id {
                const hash = node.getRoot(pool);
                var new_leaf: [32]u8 = hash.*;
                const offset = (index * bytes) % 32;
                std.mem.writeInt(Type, new_leaf[offset..][0..bytes], value.*, .little);
                return try pool.createLeaf(&new_leaf);
            }

            /// Decode a packed item directly from chunk bytes. Used by chunked_leaf-backed
            /// containers where the chunk is already in hand and a Node.Id is unavailable.
            pub fn toValuePackedFromBytes(chunk: *const [32]u8, index: usize, out: *Type) void {
                const offset = index * fixed_size % 32;
                out.* = std.mem.readInt(Type, chunk[offset..][0..fixed_size], .little);
            }

            /// Encode a packed item directly into chunk bytes (mutates `chunk` in place).
            /// Used by chunked_leaf-backed containers; the caller is responsible for any CoW
            /// of the chunk before calling.
            pub fn fromValuePackedIntoChunk(chunk: *[32]u8, index: usize, value: *const Type) void {
                const offset = (index * bytes) % 32;
                std.mem.writeInt(Type, chunk[offset..][0..bytes], value.*, .little);
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const hash = node.getRoot(pool);
                @memcpy(out[0..fixed_size], hash[0..fixed_size]);
                return fixed_size;
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            try writer.print("\"{d}\"", .{in.*});
        }

        pub fn deserializeFromJson(scanner: *std.json.Scanner, out: *Type) !void {
            try switch (try scanner.next()) {
                .string => |v| {
                    out.* = try std.fmt.parseInt(Type, v, 10);
                },
                else => error.invalidJson,
            };
        }
    };
}

test {
    _ = @import("uint_test.zig");
}
