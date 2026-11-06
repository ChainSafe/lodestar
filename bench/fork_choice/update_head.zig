//! Fork choice `getHead` benchmark, the counterpart of
//! `packages/fork-choice/test/perf/forkChoice/updateHead.test.ts`.
//!
//! Every validator's vote flips between the tip and its parent before each timed
//! `getHead`, so each measurement is a full recomputation over all votes and blocks.
//! The flip swaps in a prepared latest-message array, so it costs nothing measurable.
//!
//! Run with: zig build run:bench_fork_choice_update_head -Doptimize=ReleaseFast

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const LatestMessage = fork_choice.LatestMessage;
const util = @import("util.zig");

const UpdateHeadBench = struct {
    bench: util.Bench,
    votes: [2]std.ArrayList(LatestMessage),
    /// Heap-allocated because zbench copies this struct for every iteration.
    flip: *bool,

    pub fn run(self: *UpdateHeadBench, _: std.mem.Allocator) void {
        const store = self.bench.store;
        store.latest_messages = self.votes[@intFromBool(self.flip.*)];
        store.head_cache.dirty = true;
        self.flip.* = !self.flip.*;
        _ = store.getHead() catch unreachable;
    }

    fn deinit(self: *UpdateHeadBench, allocator: std.mem.Allocator) void {
        self.bench.store.latest_messages = .empty;
        for (&self.votes) |*votes| votes.deinit(allocator);
        allocator.destroy(self.flip);
        self.bench.deinit(allocator);
    }
};

fn everyoneVotes(allocator: std.mem.Allocator, store: *fork_choice.Store, block: fork_choice.BlockIndex, validator_count: u32) !std.ArrayList(LatestMessage) {
    var votes: std.ArrayList(LatestMessage) = .empty;
    errdefer votes.deinit(allocator);
    try votes.appendNTimes(allocator, .{ .slot = store.blockSlot(block), .block = block, .payload_present = false }, validator_count);
    return votes;
}

fn setupBench(allocator: std.mem.Allocator, opts: util.Opts) !UpdateHeadBench {
    var bench = try util.initStore(allocator, opts);
    errdefer bench.deinit(allocator);
    const head = try bench.store.getHead();
    const vote1 = head.block;
    const vote2 = bench.store.blocks.items(.parent)[vote1];
    if (vote2 == fork_choice.store.NO_BLOCK) {
        std.debug.print("head is the anchor: {any} blocks={d} justified={d} gloas={}\n", .{ head, bench.store.blockCount(), bench.store.justified_checkpoint.epoch, opts.gloas_boosted });
        return error.HeadIsAnchor;
    }
    var votes_1 = try everyoneVotes(allocator, bench.store, vote1, opts.initial_validator_count);
    errdefer votes_1.deinit(allocator);
    var votes_2 = try everyoneVotes(allocator, bench.store, vote2, opts.initial_validator_count);
    errdefer votes_2.deinit(allocator);
    const flip = try allocator.create(bool);
    flip.* = false;
    return .{ .bench = bench, .votes = .{ votes_1, votes_2 }, .flip = flip };
}

const Case = struct { name: []const u8, opts: util.Opts };

const cases = [_]Case{
    .{ .name = "getHead vc=100000 bc=64 eq=0", .opts = .{ .initial_validator_count = 100_000 } },
    .{ .name = "getHead vc=600000 bc=64 eq=0", .opts = .{ .initial_validator_count = 600_000 } },
    .{ .name = "getHead vc=1000000 bc=64 eq=0", .opts = .{ .initial_validator_count = 1_000_000 } },
    .{ .name = "getHead vc=600000 bc=320 eq=0", .opts = .{ .initial_block_count = 320 } },
    .{ .name = "getHead vc=600000 bc=1200 eq=0", .opts = .{ .initial_block_count = 1200 } },
    .{ .name = "getHead vc=600000 bc=7200 eq=0", .opts = .{ .initial_block_count = 7200 } },
    .{ .name = "getHead vc=600000 bc=64 eq=1000", .opts = .{ .initial_equivocated_count = 1_000 } },
    .{ .name = "getHead vc=600000 bc=64 eq=10000", .opts = .{ .initial_equivocated_count = 10_000 } },
    .{ .name = "getHead vc=600000 bc=64 eq=300000", .opts = .{ .initial_equivocated_count = 300_000 } },
    .{ .name = "getHead vc=600000 bc=64 eq=0 gloas boosted", .opts = .{ .gloas_boosted = true } },
};

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };

    var runner = zbench.Benchmark.init(allocator, .{});
    defer runner.deinit();
    var benches: [cases.len]UpdateHeadBench = undefined;
    var ready: usize = 0;
    defer for (benches[0..ready]) |*bench| bench.deinit(allocator);
    inline for (cases, 0..) |case, i| {
        benches[i] = try setupBench(allocator, case.opts);
        ready += 1;
        try runner.addParam(case.name, @as(*const UpdateHeadBench, &benches[i]), .{});
    }
    try runner.run(init.io, std.Io.File.stdout());
}
