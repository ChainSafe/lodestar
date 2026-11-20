//! Fork choice `onBlock` benchmark: one block per slot on the tip, as a syncing node or
//! one far behind finality imports them, followed by a read of the block's execution
//! status, which the native fork choice makes after every import.
//!
//! A `late` block arrives after the attestation deadline, so proposer boost cannot apply;
//! the `timely` block is the first of its slot, so the import also takes the head. The
//! Gloas case also delivers each block's payload as `.valid`, as a synced node does. The
//! tick to the next slot runs outside the timed region. Each run adds a block, so the
//! chain grows by up to `ITERATIONS` over its initial length.
//!
//! Run with: zig build run:bench_fork_choice_on_block -Doptimize=ReleaseFast

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const Store = fork_choice.Store;
const util = @import("util.zig");

const ITERATIONS = 256;

const Case = struct {
    name: []const u8,
    chain: u32,
    arrival_ms_into_slot: u64,
    gloas: bool = false,
};

const cases = [_]Case{
    .{ .name = "onBlock late, chain 64", .chain = 64, .arrival_ms_into_slot = 11_000 },
    .{ .name = "onBlock late, chain 1024", .chain = 1024, .arrival_ms_into_slot = 11_000 },
    .{ .name = "onBlock late, chain 4096", .chain = 4096, .arrival_ms_into_slot = 11_000 },
    .{ .name = "onBlock timely, chain 1024", .chain = 1024, .arrival_ms_into_slot = 0 },
    .{ .name = "onBlock + valid envelope, Gloas chain 4096", .chain = 4096, .arrival_ms_into_slot = 11_000, .gloas = true },
};

const ImportBench = struct {
    bench: util.Bench,
    case: Case,

    pub fn run(self: *ImportBench, _: std.mem.Allocator) void {
        const store = self.bench.store;
        var summary = util.chainBlock(store.currentSlot(), self.case.gloas);
        summary.arrival_ms_into_slot = self.case.arrival_ms_into_slot;
        store.onBlockSummary(summary) catch unreachable;
        const node = Store.pendingNode(store.blockIndex(summary.root).?);
        std.mem.doNotOptimizeAway(store.executionStatus(node) catch unreachable);
        if (self.case.gloas) store.onExecutionPayloadEnvelope(summary.root, .valid, null) catch unreachable;
    }

    /// Moves the clock past the slot the previous run filled.
    fn nextSlot(self: *ImportBench) void {
        const store = self.bench.store;
        const slot = store.currentSlot();
        if (store.hasBlock(util.rootFromSlot(slot))) store.onTick(store.timing.timeAtSlotMs(slot + 1)) catch unreachable;
    }
};

/// zbench hooks take no context, so the benchmark states are globals.
var benches: [cases.len]ImportBench = undefined;

fn Hooks(comptime i: usize) type {
    return struct {
        fn beforeEach() void {
            benches[i].nextSlot();
        }
    };
}

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };

    var initialized: usize = 0;
    defer for (benches[0..initialized]) |*bench| bench.bench.deinit(allocator);
    for (cases, &benches) |case, *bench| {
        bench.* = .{
            .bench = try util.initStore(allocator, .{ .initial_block_count = case.chain, .initial_validator_count = 1000, .gloas_boosted = case.gloas }),
            .case = case,
        };
        initialized += 1;
    }

    var runner = zbench.Benchmark.init(allocator, .{ .iterations = ITERATIONS });
    defer runner.deinit();
    inline for (cases, 0..) |case, i| {
        try runner.addParam(case.name, @as(*const ImportBench, &benches[i]), .{ .hooks = .{ .before_each = Hooks(i).beforeEach } });
    }
    try runner.run(init.io, std.Io.File.stdout());
}
