//! Splits a per-validator loop of an epoch step into chunks that run in parallel.
//!
//! A task must write only state owned by its chunk: its own index range of shared slices, and its
//! own slot (`Chunk.index`) of a per-chunk result array the caller sizes with `count`. Work that is
//! not thread-safe, such as tree view reads and writes, is recorded by index and done afterwards.

const std = @import("std");
const builtin = @import("builtin");

/// Small in tests so that unit and spec test states, which have far fewer validators than
/// mainnet, still span several chunks and exercise the per-chunk offsets and merges.
pub const validators_per_task: usize = if (builtin.is_test) 32 else 1 << 16;

pub const Chunk = struct {
    index: usize,
    start: usize,
    end: usize,
};

pub fn count(len: usize) usize {
    return (len + validators_per_task - 1) / validators_per_task;
}

pub fn at(len: usize, index: usize) Chunk {
    std.debug.assert(index < count(len));
    const start = index * validators_per_task;
    return .{ .index = index, .start = start, .end = @min(start + validators_per_task, len) };
}

/// Calls `task(context, chunk)` for every chunk of `[0, len)`, concurrently on `io` when there is
/// more than one chunk.
pub fn run(
    io: std.Io,
    len: usize,
    context: anytype,
    comptime task: fn (@TypeOf(context), Chunk) void,
) std.Io.Cancelable!void {
    const chunk_count = count(len);
    if (chunk_count <= 1) {
        if (chunk_count == 1) task(context, at(len, 0));
        return;
    }
    var group: std.Io.Group = .init;
    for (0..chunk_count) |index| group.async(io, task, .{ context, at(len, index) });
    try group.await(io);
}

test run {
    const len = 3 * validators_per_task + 5;
    const Context = struct {
        visits: []u8,

        fn visit(context: *const @This(), chunk: Chunk) void {
            for (context.visits[chunk.start..chunk.end]) |*visits| visits.* += 1;
        }
    };

    var visits = [_]u8{0} ** len;
    const context: Context = .{ .visits = &visits };
    try run(std.testing.io, len, &context, Context.visit);
    for (visits) |visit_count| try std.testing.expectEqual(1, visit_count);
}
