const std = @import("std");
const TypeKind = @import("type_kind.zig").TypeKind;
const Node = @import("persistent_merkle_tree").Node;

pub fn BoolType() type {
    return struct {
        pub const kind = TypeKind.bool;
        pub const Type: type = bool;
        pub const fixed_size: usize = 1;

        pub const default_value: Type = false;

        pub const default_root: [32]u8 = [_]u8{0} ** 32;

        pub fn equals(a: *const Type, b: *const Type) bool {
            return a.* == b.*;
        }

        pub fn clone(value: *const Type, out: *Type) !void {
            out.* = value.*;
        }

        pub fn hashTreeRoot(value: *const Type, out: *[32]u8) !void {
            @memset(out, 0);
            out[0] = if (value.*) 1 else 0;
        }

        pub fn serializeIntoBytes(value: *const Type, out: []u8) usize {
            const byte: u8 = if (value.*) 1 else 0;
            out[0] = byte;
            return 1;
        }

        pub fn deserializeFromBytes(data: []const u8, out: *Type) !void {
            if (data.len != 1) {
                return error.InvalidSize;
            }
            const byte = data[0];
            switch (byte) {
                0 => out.* = false,
                1 => out.* = true,
                else => return error.invalidBoolean,
            }
        }

        pub const serialized = struct {
            pub fn validate(data: []const u8) !void {
                if (data.len != 1) {
                    return error.InvalidSize;
                }
                switch (data[0]) {
                    0, 1 => {},
                    else => return error.invalidBoolean,
                }
            }

            pub fn hashTreeRoot(data: []const u8, out: *[32]u8) !void {
                @memset(out, 0);
                @memcpy(out[0..fixed_size], data);
            }
        };

        pub const tree = struct {
            pub fn deserializeFromBytes(pool: *Node.Pool, data: []const u8) !Node.Id {
                try serialized.validate(data);
                var leaf: [32]u8 = [_]u8{0} ** 32;
                leaf[0] = data[0];
                return try pool.createLeaf(&leaf);
            }

            pub fn toValue(node: Node.Id, pool: *Node.Pool, out: *Type) !void {
                const hash = node.getRoot(pool);
                out.* = if (hash[0] == 0) false else true;
            }

            pub fn fromValue(pool: *Node.Pool, value: *const Type) !Node.Id {
                const byte: u8 = if (value.*) 1 else 0;
                return try pool.createLeafFromUint(byte);
            }

            pub fn toValuePacked(node: Node.Id, pool: *Node.Pool, index: usize, out: *Type) !void {
                const offset = index % 32;
                const hash = node.getRoot(pool);
                out.* = if (hash[offset] == 0) false else true;
            }

            pub fn fromValuePacked(node: Node.Id, pool: *Node.Pool, index: usize, value: *const Type) !Node.Id {
                const hash = node.getRoot(pool);
                var new_leaf: [32]u8 = hash.*;
                const offset = index % 32;
                new_leaf[offset] = if (value.*) 1 else 0;
                return try pool.createLeaf(&new_leaf);
            }

            /// Decode a packed item directly from chunk bytes. Used by chunked_leaf-backed
            /// containers where the chunk is already in hand and a Node.Id is unavailable.
            pub fn toValuePackedFromBytes(chunk: *const [32]u8, index: usize, out: *Type) void {
                const offset = index % 32;
                out.* = if (chunk[offset] == 0) false else true;
            }

            /// Encode a packed item directly into chunk bytes (mutates `chunk` in place).
            /// Used by chunked_leaf-backed containers; the caller is responsible for any CoW
            /// of the chunk before calling.
            pub fn fromValuePackedIntoChunk(chunk: *[32]u8, index: usize, value: *const Type) void {
                const offset = index % 32;
                chunk[offset] = if (value.*) 1 else 0;
            }

            pub fn serializeIntoBytes(node: Node.Id, pool: *Node.Pool, out: []u8) !usize {
                const hash = node.getRoot(pool);
                out[0] = hash[0];
                return fixed_size;
            }

            pub fn serializedSize(_: Node.Id, _: *Node.Pool) usize {
                return fixed_size;
            }
        };

        pub fn serializeIntoJson(writer: anytype, in: *const Type) !void {
            try writer.write(in.*);
        }

        pub fn deserializeFromJson(scanner: *std.json.Scanner, out: *Type) !void {
            switch (try scanner.next()) {
                .true => out.* = true,
                .false => out.* = false,
                else => return error.invalidJson,
            }
        }
    };
}

test {
    _ = @import("bool_test.zig");
}
