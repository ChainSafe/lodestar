const std = @import("std");

pub const BYTES_PER_CHUNK: usize = 32;

/// Zero-pads at most one chunk of bytes.
pub fn fromBytes(bytes: []const u8) [BYTES_PER_CHUNK]u8 {
    std.debug.assert(bytes.len <= BYTES_PER_CHUNK);
    var out: [BYTES_PER_CHUNK]u8 = @splat(0);
    @memcpy(out[0..bytes.len], bytes);
    return out;
}

/// Returns the number of items of `ElementType` that fit in a single chunk.
pub inline fn itemsPerChunk(comptime ElementType: type) comptime_int {
    comptime {
        if (!@hasDecl(ElementType, "fixed_size")) {
            @compileError("itemsPerChunk requires a type with fixed_size");
        }
    }
    return BYTES_PER_CHUNK / ElementType.fixed_size;
}

/// Returns the number of chunks needed to hold `length` items of `ElementType`.
pub inline fn chunkCount(length: usize, comptime ElementType: type) usize {
    const per_chunk = itemsPerChunk(ElementType);
    if (length == 0) return 0;
    return (length + per_chunk - 1) / per_chunk;
}

/// Returns the chunk depth, accounting for the extra level used by SSZ lists when
/// mixing in their lengths.
pub inline fn chunkDepth(comptime DepthType: type, chunk_depth: DepthType, comptime ST: type) DepthType {
    return if (ST.kind == .list) chunk_depth + 1 else chunk_depth;
}
