const std = @import("std");
const hexToBytes = @import("hex").hexToBytes;
const hexByteLen = @import("hex").hexByteLen;
const hexLenFromBytes = @import("hex").hexLenFromBytes;
const bytesToHex = @import("hex").bytesToHex;
const UintType = @import("uint.zig").UintType;
const progressive_list = @import("progressive_list.zig");
const TypeOpts = progressive_list.TypeOpts;

pub fn isProgressiveByteListType(comptime ST: type) bool {
    return ST.kind == .progressive_list and @hasDecl(ST, "is_progressive_byte_list");
}

/// `ProgressiveList[byte]` with hexadecimal JSON. SSZ bytes, roots and trees are those of the
/// progressive `uint8` list, whose declarations this type re-exports.
pub fn ProgressiveByteListType(comptime _opts: TypeOpts) type {
    const Bytes = progressive_list.FixedProgressiveListType(UintType(8), _opts);

    return struct {
        pub const is_progressive_byte_list = true;
        pub const kind = Bytes.kind;
        pub const Element = Bytes.Element;
        pub const opts = Bytes.opts;
        pub const limit = Bytes.limit;
        pub const Type = Bytes.Type;
        pub const TreeView = @import("../tree_view/progressive_list_basic.zig").ProgressiveListBasicTreeView(@This());
        pub const min_size = Bytes.min_size;
        pub const max_size = Bytes.max_size;
        pub const default_value = Bytes.default_value;
        pub const default_root = Bytes.default_root;

        pub const equals = Bytes.equals;
        pub const deinit = Bytes.deinit;
        pub const clone = Bytes.clone;
        pub const cloneInto = Bytes.cloneInto;
        pub const chunkCount = Bytes.chunkCount;
        pub const hashTreeRoot = Bytes.hashTreeRoot;
        pub const serializedSize = Bytes.serializedSize;
        pub const serializeIntoBytes = Bytes.serializeIntoBytes;
        pub const deserializeFromBytes = Bytes.deserializeFromBytes;
        pub const serialized = Bytes.serialized;
        pub const tree = Bytes.tree;

        pub fn serializeIntoJson(allocator: std.mem.Allocator, writer: anytype, in: *const Type) !void {
            const byte_str = try allocator.alloc(u8, hexLenFromBytes(in.items));
            defer allocator.free(byte_str);

            _ = try bytesToHex(byte_str, in.items);
            try writer.print("\"{s}\"", .{byte_str});
        }

        /// Initialize `out` with `default_value`; the caller deinitializes it after success or error.
        pub fn deserializeFromJson(allocator: std.mem.Allocator, source: *std.json.Scanner, out: *Type) !void {
            const hex_bytes = switch (try source.next()) {
                .string => |v| v,
                else => return error.InvalidJson,
            };
            const len = hexByteLen(hex_bytes);
            if (len > limit) return error.LengthOverLimit;

            try out.resize(allocator, len);
            _ = try hexToBytes(out.items, hex_bytes);
        }
    };
}

test {
    _ = @import("progressive_byte_list_test.zig");
}
