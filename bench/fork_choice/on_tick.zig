//! Fork choice `onTick` benchmark: the tick that starts a slot and applies the votes
//! queued during the previous one.
//!
//! Mainnet shape, as in `update_head.zig`: about 2.43M validator indices of which about
//! 838k vote, and about 25.3k of them attest per slot, in committee order. The votes are
//! queued outside the timed region; the `no queued votes` case shows what a tick costs
//! when nothing waits.
//!
//! Run with: zig build run:bench_fork_choice_on_tick -Doptimize=ReleaseFast

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const consensus_types = @import("consensus_types");
const preset = @import("preset").preset;
const util = @import("util.zig");

const AttestationData = consensus_types.phase0.AttestationData.Type;

const mainnet: util.Opts = .{ .initial_validator_count = 2_430_000, .active_validator_count = 838_000, .initial_block_count = 80 };
const VOTES_PER_SLOT: usize = 25_300;

const State = struct {
    bench: util.Bench,
    head_block: fork_choice.BlockIndex,
    /// Every voting validator, shuffled as committees are.
    voters: []u64,
    cursor: usize = 0,

    fn init(allocator: std.mem.Allocator) !State {
        var bench = try util.initStore(allocator, mainnet);
        errdefer bench.deinit(allocator);
        const head = try bench.store.getHead();

        var order: std.ArrayList(u32) = .empty;
        defer order.deinit(allocator);
        for (0..mainnet.initial_validator_count) |i| {
            if (util.isActive(i, mainnet.initial_validator_count, mainnet.active_validator_count)) try order.append(allocator, @intCast(i));
        }
        util.shuffle(order.items);
        const voters = try allocator.alloc(u64, order.items.len);
        for (voters, order.items) |*voter, index| voter.* = index;
        std.debug.assert(voters.len >= VOTES_PER_SLOT);
        return .{ .bench = bench, .head_block = head.block, .voters = voters };
    }

    fn deinit(self: *State, allocator: std.mem.Allocator) void {
        allocator.free(self.voters);
        self.bench.deinit(allocator);
    }

    /// One slot's attestations for the head, all at the current slot so they queue.
    fn queueSlotVotes(self: *State) void {
        const store = self.bench.store;
        const slot = store.currentSlot();
        const epoch = slot / preset.SLOTS_PER_EPOCH;
        const data: AttestationData = .{
            .slot = slot,
            .index = 0,
            .beacon_block_root = store.blockRoot(self.head_block),
            .source = .{ .epoch = 0, .root = @splat(0) },
            .target = .{ .epoch = epoch, .root = store.blockRoot(store.getCheckpointBlock(self.head_block, epoch)) },
        };
        if (self.cursor + VOTES_PER_SLOT > self.voters.len) self.cursor = 0;
        store.onAttestationData(&data, self.voters[self.cursor..][0..VOTES_PER_SLOT], false) catch unreachable;
        self.cursor += VOTES_PER_SLOT;
    }

    fn tick(self: *State) void {
        const store = self.bench.store;
        store.onTick(store.timing.timeAtSlotMs(store.currentSlot() + 1)) catch unreachable;
    }
};

/// zbench hooks take no context, so the benchmark states are globals.
var queued_state: State = undefined;
var idle_state: State = undefined;

const QueuedTick = struct {
    fn beforeEach() void {
        // Clears the changed-vote marks of the previous slot, as the slot's head update does.
        _ = queued_state.bench.store.getHead() catch unreachable;
        queued_state.queueSlotVotes();
    }

    pub fn run(_: *QueuedTick, _: std.mem.Allocator) void {
        queued_state.tick();
    }
};

const IdleTick = struct {
    pub fn run(_: *IdleTick, _: std.mem.Allocator) void {
        idle_state.tick();
    }
};

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };

    queued_state = try State.init(allocator);
    defer queued_state.deinit(allocator);
    idle_state = try State.init(allocator);
    defer idle_state.deinit(allocator);
    // Sizes the per-validator arrays, then leaves nothing queued.
    idle_state.queueSlotVotes();
    idle_state.tick();
    std.debug.assert(idle_state.bench.store.queuedVoteCount() == 0);

    var runner = zbench.Benchmark.init(allocator, .{});
    defer runner.deinit();
    try runner.addParam("mainnet: onTick, 25.3k queued votes", @as(*const QueuedTick, &.{}), .{ .hooks = .{ .before_each = QueuedTick.beforeEach } });
    try runner.addParam("mainnet: onTick, no queued votes", @as(*const IdleTick, &.{}), .{});
    try runner.run(init.io, std.Io.File.stdout());
}
