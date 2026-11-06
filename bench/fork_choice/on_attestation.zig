//! Fork choice `onAttestation` benchmark, the counterpart of
//! `packages/fork-choice/test/perf/forkChoice/onAttestation.test.ts`.
//!
//! One slot's worth of gossip: 3 committees of 135 unaggregated attestations plus
//! 64 committees times 11 aggregates of 135 validators, 1109 indexed attestations,
//! all for the head at slot 63 while the store is at slot 64. Each iteration also
//! hashes every attestation's data, as the TS benchmark does inside its timed loop.
//!
//! Run with: zig build run:bench_fork_choice_on_attestation -Doptimize=ReleaseFast

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const fork_choice = @import("fork_choice");
const consensus_types = @import("consensus_types");
const fork_types = @import("fork_types");
const preset = @import("preset").preset;
const util = @import("util.zig");

const IndexedAttestation = consensus_types.phase0.IndexedAttestation.Type;
const AnyIndexedAttestation = fork_types.AnyIndexedAttestation;

const UNAGG_COMMITTEES: u32 = 3;
const VALIDATORS_PER_COMMITTEE: u32 = 135;
const AGG_COMMITTEES: u32 = 64;
const AGGREGATORS_PER_COMMITTEE: u32 = 11;
const TOTAL = UNAGG_COMMITTEES * VALIDATORS_PER_COMMITTEE + AGG_COMMITTEES * AGGREGATORS_PER_COMMITTEE;

const OnAttestationBench = struct {
    bench: util.Bench,
    attestations: []IndexedAttestation,

    pub fn run(self: *OnAttestationBench, _: std.mem.Allocator) void {
        for (self.attestations) |*attestation| {
            var data_root: [32]u8 = undefined;
            consensus_types.phase0.AttestationData.hashTreeRoot(&attestation.data, &data_root) catch unreachable;
            std.mem.doNotOptimizeAway(data_root);
            self.bench.store.onAttestation(.{ .phase0 = attestation }, false) catch unreachable;
        }
    }

    fn deinit(self: *OnAttestationBench, allocator: std.mem.Allocator) void {
        for (self.attestations) |*attestation| attestation.attesting_indices.deinit(allocator);
        allocator.free(self.attestations);
        self.bench.deinit(allocator);
    }
};

fn setupBench(allocator: std.mem.Allocator) !OnAttestationBench {
    const block_count = 64;
    var bench = try util.initStore(allocator, .{ .initial_block_count = block_count, .initial_validator_count = 600_000 });
    errdefer bench.deinit(allocator);
    const head = try bench.store.getHead();
    const att_slot: u64 = block_count - 1;
    const target_epoch = att_slot / preset.SLOTS_PER_EPOCH;
    const target_root = bench.store.blockRoot(bench.store.getCheckpointBlock(head.block, target_epoch));
    const data: consensus_types.phase0.AttestationData.Type = .{
        .slot = att_slot,
        .index = 0,
        .beacon_block_root = bench.store.blockRoot(head.block),
        .source = .{ .epoch = 0, .root = @splat(0) },
        .target = .{ .epoch = target_epoch, .root = target_root },
    };

    const attestations = try allocator.alloc(IndexedAttestation, TOTAL);
    errdefer allocator.free(attestations);
    var count: usize = 0;
    errdefer for (attestations[0..count]) |*attestation| attestation.attesting_indices.deinit(allocator);

    for (0..UNAGG_COMMITTEES) |committee| {
        for (0..VALIDATORS_PER_COMMITTEE) |i| {
            var attestation: IndexedAttestation = .{ .attesting_indices = .empty, .data = data, .signature = @splat(0) };
            attestation.data.index = committee;
            try attestation.attesting_indices.append(allocator, committee * VALIDATORS_PER_COMMITTEE + i);
            attestations[count] = attestation;
            count += 1;
        }
    }
    for (0..AGG_COMMITTEES) |committee| {
        for (0..AGGREGATORS_PER_COMMITTEE) |aggregator| {
            var attestation: IndexedAttestation = .{ .attesting_indices = .empty, .data = data, .signature = @splat(0) };
            attestation.data.index = committee;
            const start = committee * VALIDATORS_PER_COMMITTEE * AGGREGATORS_PER_COMMITTEE + aggregator * VALIDATORS_PER_COMMITTEE;
            for (0..VALIDATORS_PER_COMMITTEE) |i| try attestation.attesting_indices.append(allocator, start + i);
            attestations[count] = attestation;
            count += 1;
        }
    }
    std.debug.assert(count == TOTAL);
    return .{ .bench = bench, .attestations = attestations };
}

pub fn main(init: std.process.Init) !void {
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator = if (builtin.mode == .Debug) debug_allocator.allocator() else std.heap.c_allocator;
    defer if (builtin.mode == .Debug) {
        std.debug.assert(debug_allocator.deinit() == .ok);
    };

    var bench = try setupBench(allocator);
    defer bench.deinit(allocator);
    var runner = zbench.Benchmark.init(allocator, .{});
    defer runner.deinit();
    try runner.addParam("onAttestation 1109 attestations (vc=600000 bc=64)", @as(*const OnAttestationBench, &bench), .{});
    try runner.run(init.io, std.Io.File.stdout());
}
