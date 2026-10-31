const std = @import("std");
const zh = @import("zero_hash.zig");
const hash = @import("sha256.zig").hash;
const hashOne = @import("sha256.zig").hashOne;
const Depth = @import("depth.zig").Depth;

pub fn merkleize(chunk_pairs: [][2][32]u8, chunk_depth: Depth, out: *[32]u8) !void {
    if (chunk_pairs.len == 0) {
        @memcpy(out, zh.getZeroHash(chunk_depth));
        return;
    }

    // hash into the same buffer
    var chunks: [][32]u8 = @ptrCast(chunk_pairs);
    for (0..chunk_depth) |i| {
        if (chunks.len % 2 == 1) {
            chunks.len += 1;
            @memcpy(&chunks[chunks.len - 1], zh.getZeroHash(@intCast(i)));
        }

        const buf_out = chunks[0 .. chunks.len / 2];
        try hash(buf_out, chunks);

        chunks = buf_out;
    }

    @memcpy(out, &chunks[0]);
}

/// Given maxChunkCount return the chunkDepth
/// ```
/// n: [0,1,2,3,4,5,6,7,8,9]
/// d: [0,0,1,2,2,3,3,3,3,4]
/// ```
pub fn maxChunksToDepth(n: usize) Depth {
    if (n == 0) return 0;
    return @intCast(std.math.log2_int_ceil(usize, n));
}

pub fn mixInLength(len: u256, out: *[32]u8) void {
    var tmp: [32]u8 = undefined;
    std.mem.writeInt(u256, &tmp, len, .little);
    hashOne(out, out, &tmp);
}

test {
    _ = @import("merkleize_test.zig");
}
