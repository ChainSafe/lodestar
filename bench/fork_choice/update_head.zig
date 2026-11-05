//! Benchmark for fork-choice `updateHead` operation.
//!
//! Measures how fast the fork choice can recompute the head after vote changes.
//! Ported from the Lodestar TS `updateHead.test.ts` benchmark.

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const ForkChoice = fork_choice.ForkChoice;

const util = @import("util.zig");

/// Benchmark struct for updateHead.
///
/// Each iteration flips all validators' next vote indices between two targets
/// (head and head-parent) then calls `updateAndGetHead`, forcing a full delta
/// recomputation. A heap-allocated flip flag persists across zbench iterations
/// since zbench copies the struct by value into `run`.
const UpdateHeadBench = struct {
    fc: *ForkChoice,
    vote1: u32,
    vote2: u32,
    flip: *bool,
    io: std.Io,

    pub fn run(self: *UpdateHeadBench, allocator: std.mem.Allocator) void {
        const target = if (self.flip.*) self.vote2 else self.vote1;
        const vote_fields = self.fc.votes.fields();
        @memset(vote_fields.next_indices, target);
        self.flip.* = !self.flip.*;

        _ = self.fc.updateAndGetHead(allocator, self.io, .{ .get_canonical_head = {} }) catch unreachable;
    }
};

/// Helper: set up one benchmark instance from the given parameters.
fn setupBench(allocator: std.mem.Allocator, io: std.Io, opts: util.Opts) !UpdateHeadBench {
    const fc = try util.initializeForkChoice(allocator, opts);

    const vote1 = fc.proto_array.getDefaultNodeIndex(fc.head.block_root).?;
    const vote2 = fc.proto_array.getDefaultNodeIndex(fc.head.parent_root).?;

    // Set all validators' initial next_index to vote1 so the first iteration
    // that flips to vote2 produces a full set of deltas.
    const vote_fields = fc.votes.fields();
    @memset(vote_fields.next_indices, vote1);

    // Run one initial updateHead so internal caches are primed.
    _ = fc.updateAndGetHead(allocator, io, .{ .get_canonical_head = {} }) catch unreachable;

    const flip = try allocator.create(bool);
    flip.* = true;

    return .{
        .fc = fc,
        .vote1 = vote1,
        .vote2 = vote2,
        .flip = flip,
        .io = io,
    };
}

fn deinitBench(allocator: std.mem.Allocator, b: UpdateHeadBench) void {
    allocator.destroy(b.flip);
    util.deinitForkChoice(allocator, b.fc);
}

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };
    const io = init.io;
    var bench = zbench.Benchmark.init(allocator, .{});

    // ── Validator count sweep (block_count=64, equivocated=0) ──

    const vc_100k = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 100_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, vc_100k);
    try bench.addParam("updateHead vc=100000 bc=64 eq=0", &vc_100k, .{});

    const vc_600k = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, vc_600k);
    try bench.addParam("updateHead vc=600000 bc=64 eq=0", &vc_600k, .{});

    const vc_1m = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 1_000_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, vc_1m);
    try bench.addParam("updateHead vc=1000000 bc=64 eq=0", &vc_1m, .{});

    // ── Block count sweep (validators=600_000, equivocated=0) ──

    const bc_320 = try setupBench(allocator, io, .{
        .initial_block_count = 320,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, bc_320);
    try bench.addParam("updateHead vc=600000 bc=320 eq=0", &bc_320, .{});

    const bc_1200 = try setupBench(allocator, io, .{
        .initial_block_count = 1200,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, bc_1200);
    try bench.addParam("updateHead vc=600000 bc=1200 eq=0", &bc_1200, .{});

    const bc_7200 = try setupBench(allocator, io, .{
        .initial_block_count = 7200,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 0,
    });
    defer deinitBench(allocator, bc_7200);
    try bench.addParam("updateHead vc=600000 bc=7200 eq=0", &bc_7200, .{});

    // ── Equivocated count sweep (validators=600_000, blocks=64) ──

    const eq_1k = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 1_000,
    });
    defer deinitBench(allocator, eq_1k);
    try bench.addParam("updateHead vc=600000 bc=64 eq=1000", &eq_1k, .{});

    const eq_10k = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 10_000,
    });
    defer deinitBench(allocator, eq_10k);
    try bench.addParam("updateHead vc=600000 bc=64 eq=10000", &eq_10k, .{});

    const eq_300k = try setupBench(allocator, io, .{
        .initial_block_count = 64,
        .initial_validator_count = 600_000,
        .initial_equivocated_count = 300_000,
    });
    defer deinitBench(allocator, eq_300k);
    try bench.addParam("updateHead vc=600000 bc=64 eq=300000", &eq_300k, .{});

    defer bench.deinit();
    try bench.run(io, std.Io.File.stdout());
}
