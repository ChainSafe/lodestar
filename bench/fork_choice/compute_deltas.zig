//! Benchmark for `computeDeltas` — the core weight-propagation function used by fork choice.
//!
//! Ported from the TypeScript benchmark in `packages/fork-choice/test/perf/computeDeltas.test.ts`.
//! Measures performance across varying validator counts and inactive-validator percentages.

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");

const computeDeltas = fork_choice.computeDeltas;
const DeltasCache = fork_choice.DeltasCache;
const EquivocatingIndices = fork_choice.EquivocatingIndices;
const VoteIndex = fork_choice.VoteIndex;
const NULL_VOTE_INDEX = fork_choice.NULL_VOTE_INDEX;

const ComputeDeltasBench = struct {
    num_proto_nodes: u32,
    current_indices: []VoteIndex,
    next_indices: []VoteIndex,
    old_balances: []u16,
    new_balances: []u16,
    equivocating: *EquivocatingIndices,
    deltas_cache: *DeltasCache,
    /// Snapshot of initial current_indices for reset before each iteration.
    /// computeDeltas mutates current_indices (sets current = next after processing),
    /// so without reset, subsequent iterations hit the unchanged fast path (no-op).
    initial_current_indices: []const VoteIndex,

    pub fn run(self: *ComputeDeltasBench, allocator: std.mem.Allocator) void {
        // Reset current_indices to initial state (matching TS beforeEach).
        @memcpy(self.current_indices, self.initial_current_indices);

        const result = computeDeltas(
            allocator,
            self.deltas_cache,
            self.num_proto_nodes,
            self.current_indices,
            self.next_indices,
            self.old_balances,
            self.new_balances,
            self.equivocating,
        ) catch unreachable;
        _ = result;
    }

    pub fn deinit(self: *ComputeDeltasBench, allocator: std.mem.Allocator) void {
        allocator.free(self.current_indices);
        allocator.free(self.next_indices);
        allocator.free(self.old_balances);
        allocator.free(self.new_balances);
        allocator.free(self.initial_current_indices);
        self.deltas_cache.deinit(allocator);
    }
};

/// Build a `ComputeDeltasBench` for the given validator count and inactive percentage.
///
/// For active validators: current_index = num_proto_nodes / 2, next_index = num_proto_nodes / 2 + 1.
/// For inactive validators (determined by modulo on `inactive_pct`): both indices are NULL_VOTE_INDEX.
/// Balances are all set to 32 (one effective-balance increment).
fn setupBench(
    allocator: std.mem.Allocator,
    num_validators: u32,
    num_proto_nodes: u32,
    inactive_pct: u32,
    equivocating: *EquivocatingIndices,
    deltas_cache: *DeltasCache,
) !ComputeDeltasBench {
    const current_indices = try allocator.alloc(VoteIndex, num_validators);
    const next_indices = try allocator.alloc(VoteIndex, num_validators);
    const old_balances = try allocator.alloc(u16, num_validators);
    const new_balances = try allocator.alloc(u16, num_validators);

    const active_current: VoteIndex = num_proto_nodes / 2; // 150
    const active_next: VoteIndex = num_proto_nodes / 2 + 1; // 151

    // Divisor for modulo-based inactive selection. E.g. 10% -> every 10th, 50% -> every 2nd.
    const modulo: u32 = if (inactive_pct > 0) 100 / inactive_pct else 0;

    for (0..num_validators) |i| {
        const is_inactive = modulo > 0 and (i % modulo == 0);
        if (is_inactive) {
            current_indices[i] = NULL_VOTE_INDEX;
            next_indices[i] = NULL_VOTE_INDEX;
        } else {
            current_indices[i] = active_current;
            next_indices[i] = active_next;
        }
        old_balances[i] = 32;
        new_balances[i] = 32;
    }

    // Snapshot of initial current_indices for per-iteration reset.
    const initial_current_indices = try allocator.alloc(VoteIndex, num_validators);
    @memcpy(initial_current_indices, current_indices);

    return .{
        .num_proto_nodes = num_proto_nodes,
        .current_indices = current_indices,
        .next_indices = next_indices,
        .old_balances = old_balances,
        .new_balances = new_balances,
        .equivocating = equivocating,
        .deltas_cache = deltas_cache,
        .initial_current_indices = initial_current_indices,
    };
}

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };
    const io = init.io;

    var bench = zbench.Benchmark.init(allocator, .{});

    const num_proto_nodes: u32 = 300;
    const inactive_pcts = [_]u32{ 0, 10, 20, 50 };
    const validator_counts = [_]u32{ 1_400_000, 2_100_000 };

    // Shared equivocating indices: {1, 2, 3, 4, 5}
    const equivocating = try allocator.create(EquivocatingIndices);
    defer {
        equivocating.deinit(allocator);
        allocator.destroy(equivocating);
    }
    equivocating.* = .empty;
    for ([_]u64{ 1, 2, 3, 4, 5 }) |idx| {
        try equivocating.put(allocator, idx, {});
    }

    // Track benchmark instances for cleanup after bench.run().
    const BENCH_COUNT = validator_counts.len * inactive_pcts.len;
    var delta_caches: [BENCH_COUNT]*DeltasCache = undefined;
    var bench_instances: [BENCH_COUNT]*ComputeDeltasBench = undefined;
    var bench_idx: usize = 0;

    // Register each benchmark combination.
    inline for (validator_counts) |vc| {
        inline for (inactive_pcts) |pct| {
            const dc = try allocator.create(DeltasCache);
            dc.* = .empty;
            const b = try allocator.create(ComputeDeltasBench);
            b.* = try setupBench(allocator, vc, num_proto_nodes, pct, equivocating, dc);
            delta_caches[bench_idx] = dc;
            bench_instances[bench_idx] = b;
            bench_idx += 1;
            const b_const: *const ComputeDeltasBench = b;
            try bench.addParam(
                std.fmt.comptimePrint("deltas {d}k i{d}%", .{ vc / 1000, pct }),
                b_const,
                .{},
            );
        }
    }
    defer for (0..BENCH_COUNT) |i| {
        bench_instances[i].deinit(allocator);
        allocator.destroy(delta_caches[i]);
        allocator.destroy(bench_instances[i]);
    };

    defer bench.deinit();
    try bench.run(io, std.Io.File.stdout());
}
