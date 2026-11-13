const std = @import("std");

const isBasicType = @import("type/type_kind.zig").isBasicType;
const isFixedType = @import("type/type_kind.zig").isFixedType;
const isBitListType = @import("type/bit_list.zig").isBitListType;
const h = @import("hashing");

pub fn Hasher(comptime ST: type) type {
    return struct {
        // pub fn hashTreeRoot(allocator: std.mem.Allocator, value: *const ST.Type, out: *[32]u8) !void {}

        pub fn init(allocator: std.mem.Allocator) !HasherData {
            switch (ST.kind) {
                .vector => {
                    const hasher_size = if (ST.chunk_count % 2 == 1) ST.chunk_count + 1 else ST.chunk_count;
                    if (comptime isBasicType(ST.Element)) {
                        return try HasherData.initCapacity(allocator, hasher_size, null);
                    } else {
                        var children = try allocator.alloc(HasherData, 1);
                        errdefer allocator.free(children);

                        children[0] = try Hasher(ST.Element).init(allocator);
                        errdefer children[0].deinit(allocator);

                        return try HasherData.initCapacity(allocator, hasher_size, children);
                    }
                },
                .container, .progressive_container => {
                    const hasher_size = if (ST.chunk_count % 2 == 1) ST.chunk_count + 1 else ST.chunk_count;
                    var children = try allocator.alloc(HasherData, ST.fields.len);
                    errdefer allocator.free(children);

                    var initialized_count: usize = 0;
                    errdefer for (children[0..initialized_count]) |child| {
                        child.deinit(allocator);
                    };

                    inline for (ST.fields, 0..) |field, i| {
                        if (comptime isBasicType(field.type)) {
                            children[i] = try HasherData.initCapacity(allocator, 0, null);
                        } else {
                            children[i] = try Hasher(field.type).init(allocator);
                        }
                        initialized_count += 1;
                    }
                    return try HasherData.initCapacity(allocator, hasher_size, children);
                },
                .list, .progressive_list, .progressive_bit_list => {
                    // we don't preallocate here since we need the length
                    const hasher_size = 0;
                    if (comptime isBasicType(ST.Element)) {
                        return try HasherData.initCapacity(allocator, hasher_size, null);
                    } else {
                        var children = try allocator.alloc(HasherData, 1);
                        errdefer allocator.free(children);

                        children[0] = try Hasher(ST.Element).init(allocator);
                        // Parent capacity is zero today; keep cleanup paired if that changes.
                        errdefer children[0].deinit(allocator);

                        return try HasherData.initCapacity(allocator, hasher_size, children);
                    }
                },
                .compatible_union => {
                    return try HasherData.initCapacity(allocator, 0, null);
                },
                else => unreachable,
            }
        }

        pub fn hash(scratch: *HasherData, value: *const ST.Type, out: *[32]u8) !void {
            if (comptime isBasicType(ST)) {
                @memset(out, 0);
                switch (ST.kind) {
                    .uint => {
                        std.mem.writeInt(ST.Type, out[0..ST.fixed_size], value.*, .little);
                    },
                    .bool => {
                        out[0] = @intFromBool(value.*);
                    },
                    else => unreachable,
                }
            } else {
                switch (ST.kind) {
                    .progressive_list, .progressive_bit_list => {
                        try ST.hashTreeRoot(scratch.allocator, value, out);
                    },
                    .list => {
                        const chunk_count = ST.chunkCount(value);
                        const hasher_size = if (chunk_count % 2 == 1) chunk_count + 1 else chunk_count;
                        try scratch.chunks.resize(scratch.allocator, hasher_size);
                        @memset(scratch.chunks.items, [_]u8{0} ** 32);
                        if (comptime isBitListType(ST)) {
                            const scratch_bytes: []u8 = @ptrCast(scratch.chunks.items[0..chunk_count]);
                            @memcpy(scratch_bytes[0..value.data.items.len], value.data.items);
                        } else if (comptime isBasicType(ST.Element)) {
                            _ = ST.serializeIntoBytes(value, @ptrCast(scratch.chunks.items));
                        } else {
                            for (value.items, 0..) |element, i| {
                                try Hasher(ST.Element).hash(&scratch.children.?[0], &element, &scratch.chunks.items[i]);
                            }
                        }
                        try h.merkleize(@ptrCast(scratch.chunks.items), ST.chunk_depth, out);
                        if (comptime isBitListType(ST)) {
                            h.mixInLength(value.bit_len, out);
                        } else {
                            h.mixInLength(value.items.len, out);
                        }
                    },
                    .vector => {
                        @memset(scratch.chunks.items, [_]u8{0} ** 32);
                        if (comptime isBasicType(ST.Element)) {
                            _ = ST.serializeIntoBytes(value, @ptrCast(scratch.chunks.items));
                        } else {
                            for (value, 0..) |element, i| {
                                try Hasher(ST.Element).hash(&scratch.children.?[0], &element, &scratch.chunks.items[i]);
                            }
                        }
                        try h.merkleize(@ptrCast(scratch.chunks.items), ST.chunk_depth, out);
                    },
                    .container => {
                        @memset(scratch.chunks.items, [_]u8{0} ** 32);
                        inline for (ST.fields, 0..) |field, i| {
                            const field_value_ptr = &@field(value, field.name);
                            try Hasher(field.type).hash(&scratch.children.?[i], field_value_ptr, &scratch.chunks.items[i]);
                        }
                        try h.merkleize(@ptrCast(scratch.chunks.items), ST.chunk_depth, out);
                    },
                    .progressive_container => {
                        if (comptime isFixedType(ST)) {
                            try ST.hashTreeRoot(value, out);
                        } else {
                            try ST.hashTreeRoot(scratch.allocator, value, out);
                        }
                    },
                    .compatible_union => {
                        try ST.hashTreeRoot(scratch.allocator, value, out);
                    },
                    else => unreachable,
                }
            }
        }
    };
}

pub const HasherData = struct {
    allocator: std.mem.Allocator,
    chunks: std.ArrayList([32]u8),
    children: ?[]HasherData,

    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize, children: ?[]HasherData) !HasherData {
        var chunks = try std.ArrayList([32]u8).initCapacity(allocator, capacity);
        chunks.appendNTimesAssumeCapacity([_]u8{0} ** 32, capacity);
        return HasherData{
            .allocator = allocator,
            .chunks = chunks,
            .children = children,
        };
    }

    pub fn deinit(self: HasherData, allocator: std.mem.Allocator) void {
        if (self.children) |children| {
            for (children) |child| {
                child.deinit(allocator);
            }
            allocator.free(children);
        }
        var chunks = self.chunks;
        chunks.deinit(allocator);
    }
};

test {
    _ = @import("hasher_test.zig");
}
