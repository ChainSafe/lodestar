//! Fork choice `getHead` benchmark, the counterpart of
//! `packages/fork-choice/test/perf/forkChoice/updateHead.test.ts`.
//!
//! Every validator's vote flips between the tip and its parent before each timed
//! `getHead`, so each measurement recounts all votes. The flip swaps in a prepared
//! latest-message array, so it costs nothing measurable. The `changed=1/32` cases flip
//! one slot's share of validators instead, as `onAttestation` would, and time the writes.
//! The `mainnet` cases follow Lodestar's mainnet `computeDeltas` metrics: about 2.43M
//! indices of which about 838k vote, 2 to 3 head updates per slot, one of them after the
//! slot's ~25.3k new votes and the rest with none, and a full recount per epoch.
//!
//! Run with: zig build run:bench_fork_choice_update_head -Doptimize=ReleaseFast

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const TargetId = fork_choice.TargetId;
const NO_TARGET = fork_choice.vote_targets.NO_TARGET;
const util = @import("util.zig");

const UpdateHeadBench = struct {
    bench: util.Bench,
    votes: [2]std.ArrayList(TargetId),
    /// Heap-allocated because zbench copies this struct for every iteration.
    flip: *bool,
    /// Next validator to flip when only `changed_per_run` votes change.
    cursor: *usize,
    changed_per_run: ?u32,
    vote_ids: [2]TargetId,
    /// Validators flipped in turn when only `changed_per_run` votes change.
    order: []u32,
    recount: bool,

    pub fn run(self: *UpdateHeadBench, _: std.mem.Allocator) void {
        const store = self.bench.store;
        if (self.changed_per_run) |changed| {
            const votes = store.latest_votes.items;
            for (0..changed) |_| {
                const validator = self.order[self.cursor.*];
                votes[validator] = if (votes[validator] == self.vote_ids[0]) self.vote_ids[1] else self.vote_ids[0];
                store.head_cache.markVoteChanged(validator);
                self.cursor.* = (self.cursor.* + 1) % self.order.len;
            }
            if (self.recount) store.head_cache.rescan_votes = true;
        } else {
            store.latest_votes = self.votes[@intFromBool(self.flip.*)];
            store.head_cache.changed_votes.setAll();
            store.head_cache.changed_count = store.head_cache.changed_votes.bit_length;
            self.flip.* = !self.flip.*;
        }
        store.head_cache.dirty = true;
        _ = store.getHead() catch unreachable;
    }

    fn deinit(self: *UpdateHeadBench, allocator: std.mem.Allocator) void {
        self.bench.store.latest_votes = .empty;
        for (&self.votes) |*votes| votes.deinit(allocator);
        allocator.destroy(self.flip);
        allocator.destroy(self.cursor);
        allocator.free(self.order);
        self.bench.deinit(allocator);
    }
};

fn everyoneVotes(allocator: std.mem.Allocator, id: TargetId, opts: util.Opts) !std.ArrayList(TargetId) {
    var votes: std.ArrayList(TargetId) = .empty;
    errdefer votes.deinit(allocator);
    try votes.appendNTimes(allocator, id, opts.initial_validator_count);
    for (votes.items, 0..) |*vote, i| {
        if (!util.isActive(i, opts.initial_validator_count, opts.active_validator_count)) vote.* = NO_TARGET;
    }
    return votes;
}

/// Every voting validator, in index order or shuffled as committees are.
fn flipOrder(allocator: std.mem.Allocator, opts: util.Opts, shuffled: bool) ![]u32 {
    var order: std.ArrayList(u32) = .empty;
    errdefer order.deinit(allocator);
    for (0..opts.initial_validator_count) |i| {
        if (util.isActive(i, opts.initial_validator_count, opts.active_validator_count)) try order.append(allocator, @intCast(i));
    }
    if (shuffled) util.shuffle(order.items);
    return order.toOwnedSlice(allocator);
}

fn setupBench(allocator: std.mem.Allocator, case: Case) !UpdateHeadBench {
    const opts = case.opts;
    const changed_per_run = case.changed_per_run;
    var bench = try util.initStore(allocator, opts);
    errdefer bench.deinit(allocator);
    const head = try bench.store.getHead();
    const vote1 = head.block;
    const vote2 = bench.store.blocks.items(.parent)[vote1];
    if (vote2 == fork_choice.store.NO_BLOCK) {
        std.debug.print("head is the anchor: {any} blocks={d} justified={d} gloas={}\n", .{ head, bench.store.blockCount(), bench.store.justified_checkpoint.epoch, opts.gloas_boosted });
        return error.HeadIsAnchor;
    }
    const vote_ids = [2]TargetId{ try util.voteTarget(bench.store, vote1), try util.voteTarget(bench.store, vote2) };
    var votes_1 = try everyoneVotes(allocator, vote_ids[0], opts);
    errdefer votes_1.deinit(allocator);
    var votes_2 = try everyoneVotes(allocator, vote_ids[1], opts);
    errdefer votes_2.deinit(allocator);
    const flip = try allocator.create(bool);
    errdefer allocator.destroy(flip);
    flip.* = false;
    const cursor = try allocator.create(usize);
    errdefer allocator.destroy(cursor);
    cursor.* = 0;
    const order = try flipOrder(allocator, opts, case.shuffled);
    errdefer allocator.free(order);
    if (changed_per_run != null) {
        bench.store.latest_votes = votes_1;
        errdefer bench.store.latest_votes = .empty;
        _ = try bench.store.getHead();
    }
    return .{
        .bench = bench,
        .votes = .{ votes_1, votes_2 },
        .flip = flip,
        .cursor = cursor,
        .changed_per_run = changed_per_run,
        .vote_ids = vote_ids,
        .order = order,
        .recount = case.recount,
    };
}

const Case = struct {
    name: []const u8,
    opts: util.Opts,
    changed_per_run: ?u32 = null,
    shuffled: bool = false,
    recount: bool = false,
};

const mainnet: util.Opts = .{ .initial_validator_count = 2_430_000, .active_validator_count = 838_000, .initial_block_count = 80 };

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
    .{ .name = "getHead vc=600000 bc=64 eq=0 changed=1/32", .opts = .{}, .changed_per_run = 600_000 / 32 },
    .{ .name = "getHead vc=1000000 bc=64 eq=0 changed=1/32", .opts = .{ .initial_validator_count = 1_000_000 }, .changed_per_run = 1_000_000 / 32 },
    .{ .name = "getHead vc=600000 bc=7200 eq=0 changed=1/32", .opts = .{ .initial_block_count = 7200 }, .changed_per_run = 600_000 / 32 },
    .{ .name = "mainnet: slot start, 25.3k new votes", .opts = mainnet, .changed_per_run = 25_300, .shuffled = true },
    .{ .name = "mainnet: after block, 0 new votes", .opts = mainnet, .changed_per_run = 0, .shuffled = true },
    .{ .name = "mainnet: epoch, full recount", .opts = mainnet, .changed_per_run = 0, .shuffled = true, .recount = true },
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
        benches[i] = try setupBench(allocator, case);
        ready += 1;
        try runner.addParam(case.name, @as(*const UpdateHeadBench, &benches[i]), .{});
    }
    try runner.run(init.io, std.Io.File.stdout());
}
