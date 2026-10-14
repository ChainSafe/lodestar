//! Benchmark for fork-specific epoch processing.
//!
//! Uses a mainnet state at slot 13180928.
//! Run with: zig build run:bench_process_epoch -Doptimize=ReleaseSafe -Dcpu=baseline

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const Node = @import("persistent_merkle_tree").Node;
const state_transition = @import("state_transition");
const time = @import("time");
const types = @import("consensus_types");
const config = @import("config");
const download_era_options = @import("download_era_options");
const era = @import("era");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const ForkSeq = config.ForkSeq;
const CachedBeaconState = state_transition.CachedBeaconState;
const EpochTransitionCache = state_transition.EpochTransitionCache;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const slotFromStateBytes = @import("utils.zig").slotFromStateBytes;
const loadState = @import("utils.zig").loadState;
const BenchState = @import("utils.zig").BenchState;
const preset = state_transition.preset;

fn ProcessJustificationAndFinalizationBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;

            const cache = self.epoch_transition_cache;

            state_transition.processJustificationAndFinalization(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessBeforeProcessEpochBench(comptime fork: ForkSeq) type {
    comptime _ = fork;
    return struct {
        io: std.Io,

        pub fn run(_: *@This(), allocator: std.mem.Allocator) void {
            BenchState.cloned_cached_state.state.commit() catch unreachable;

            var epoch_transition_cache = EpochTransitionCache.init(
                allocator,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state,
            ) catch unreachable;
            defer epoch_transition_cache.deinit();
        }
    };
}

fn ProcessInactivityUpdatesBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const cache = self.epoch_transition_cache;

            state_transition.processInactivityUpdates(
                fork,
                allocator,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessRewardsAndPenaltiesBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), _: std.mem.Allocator) void {
            const cache = self.epoch_transition_cache;

            state_transition.processRewardsAndPenalties(
                fork,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
                null,
            ) catch unreachable;
        }
    };
}

fn ProcessRegistryUpdatesBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            const cache = self.epoch_transition_cache;

            state_transition.processRegistryUpdates(
                fork,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessSlashingsBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            const cache = self.epoch_transition_cache;

            _ = state_transition.processSlashings(
                fork,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
                false,
            ) catch unreachable;
        }
    };
}

fn ProcessEth1DataResetBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            const cache = self.epoch_transition_cache;

            state_transition.processEth1DataReset(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessPendingDepositsBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const cache = self.epoch_transition_cache;

            state_transition.processPendingDeposits(
                fork,
                allocator,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessPendingConsolidationsBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            const cache = self.epoch_transition_cache;

            state_transition.processPendingConsolidations(
                fork,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessEffectiveBalanceUpdatesBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn beforeEach() void {
            BenchState.beforeEach();
            BenchState.cloned_cached_state.epoch_cache.beforeEpochTransition() catch unreachable;
        }

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const cache = self.epoch_transition_cache;

            _ = state_transition.processEffectiveBalanceUpdates(
                fork,
                allocator,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessSlashingsResetBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            const cache = self.epoch_transition_cache;

            state_transition.processSlashingsReset(
                fork,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessRandaoMixesResetBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;

            const cache = self.epoch_transition_cache;

            state_transition.processRandaoMixesReset(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessHistoricalSummariesUpdateBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;

            const cache = self.epoch_transition_cache;

            state_transition.processHistoricalSummariesUpdate(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
        }
    };
}

fn ProcessParticipationFlagUpdatesBench(comptime fork: ForkSeq) type {
    return struct {
        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = self;
            _ = allocator;

            state_transition.processParticipationFlagUpdates(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
            ) catch unreachable;
        }
    };
}

fn ProcessSyncCommitteeUpdatesBench(comptime fork: ForkSeq) type {
    return struct {
        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = self;

            state_transition.processSyncCommitteeUpdates(
                fork,
                allocator,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
            ) catch unreachable;
        }
    };
}

fn ProcessProposerLookaheadBench(comptime fork: ForkSeq) type {
    return struct {
        epoch_transition_cache: *EpochTransitionCache,
        var cache_to_release: ?*EpochTransitionCache = null;

        pub fn afterEach() void {
            const cache = cache_to_release orelse unreachable;
            const shuffling = cache.next_shuffling orelse unreachable;
            cache.next_shuffling = null;
            cache_to_release = null;
            shuffling.unref();
            BenchState.afterEach();
        }

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const cache = self.epoch_transition_cache;
            std.debug.assert(cache.next_shuffling == null);

            state_transition.processProposerLookahead(
                fork,
                allocator,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                cache,
            ) catch unreachable;
            cache_to_release = cache;
        }
    };
}

const Step = enum {
    epoch_total,
    before_process_epoch,
    start_shuffling,
    justification_finalization,
    inactivity_updates,
    rewards_and_penalties,
    registry_updates,
    slashings,
    eth1_data_reset,
    pending_deposits,
    pending_consolidations,
    effective_balance_updates,
    slashings_reset,
    randao_mixes_reset,
    historical_summaries,
    historical_roots,
    participation_flags,
    participation_record,
    sync_committee_updates,
    proposer_lookahead,
    state_root,
};

const step_count = std.enums.values(Step).len;
var step_durations_ns: [step_count]u128 = [_]u128{0} ** step_count;
var step_run_counts: [step_count]u64 = [_]u64{0} ** step_count;

fn resetSegmentStats() void {
    for (&step_durations_ns) |*v| v.* = 0;
    for (&step_run_counts) |*v| v.* = 0;
}

fn recordSegment(step: Step, duration_ns: u64) void {
    const idx = @intFromEnum(step);
    step_durations_ns[idx] += duration_ns;
    step_run_counts[idx] += 1;
}

fn printSegmentStats(stdout: *std.Io.Writer) !void {
    try stdout.print("\nSegmented epoch breakdown:\n", .{});
    try stdout.print("{s:<28} {s:<8} {s:<14} {s:<14}\n", .{ "step", "runs", "total time", "time/run (avg)" });
    try stdout.print("{s:-<66}\n", .{""});
    for (std.enums.values(Step)) |step| {
        const idx = @intFromEnum(step);
        const count = step_run_counts[idx];
        if (count == 0) continue;
        const total_ns = step_durations_ns[idx];
        const avg_ns: u128 = total_ns / count;
        const total_ms = @as(f64, @floatFromInt(total_ns)) / std.time.ns_per_ms;
        const avg_ms = @as(f64, @floatFromInt(avg_ns)) / std.time.ns_per_ms;
        const total_s = total_ms / std.time.ms_per_s;
        if (total_ms >= std.time.ms_per_s) {
            try stdout.print("{s:<28} {d:<8} {d:>10.3}s   {d:>10.3}ms\n", .{ @tagName(step), count, total_s, avg_ms });
        } else {
            try stdout.print("{s:<28} {d:<8} {d:>10.3}ms   {d:>10.3}ms\n", .{ @tagName(step), count, total_ms, avg_ms });
        }
    }
    try stdout.print("\n", .{});
}

fn ProcessEpochBench(comptime fork: ForkSeq) type {
    return struct {
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            var cache = EpochTransitionCache.init(
                allocator,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state,
            ) catch unreachable;
            defer cache.deinit();

            state_transition.processEpoch(
                fork,
                allocator,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                &cache,
            ) catch unreachable;
            // hashTreeRoot, not commit: the re-merkleization runs here — the
            // real per-epoch cost (state_root is verified each epoch).
            _ = BenchState.cloned_cached_state.state.hashTreeRoot() catch unreachable;
        }
    };
}

fn ProcessEpochSegmentedBench(comptime fork: ForkSeq) type {
    return struct {
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const io = self.io;
            const epoch_start = time.start(io);

            const before_start = time.start(io);
            BenchState.cloned_cached_state.state.commit() catch unreachable;
            var cache_val = EpochTransitionCache.init(
                allocator,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state,
            ) catch unreachable;
            defer cache_val.deinit();
            const cache = &cache_val;
            recordSegment(.before_process_epoch, @as(u64, @intCast(time.since(io, before_start).nanoseconds)));

            if (comptime fork.gte(.fulu)) {
                const start_shuffling_timer = time.start(io);
                state_transition.startProposerLookaheadShuffling(
                    fork,
                    io,
                    BenchState.cloned_cached_state.epoch_cache,
                    BenchState.cloned_cached_state.state.castToFork(fork),
                    cache,
                ) catch unreachable;
                recordSegment(.start_shuffling, @as(u64, @intCast(time.since(io, start_shuffling_timer).nanoseconds)));
            }

            const fork_state = BenchState.cloned_cached_state.state.castToFork(fork);
            const epoch_cache = BenchState.cloned_cached_state.epoch_cache;

            const jf_start = time.start(io);
            state_transition.processJustificationAndFinalization(fork, fork_state, cache) catch unreachable;
            recordSegment(.justification_finalization, @as(u64, @intCast(time.since(io, jf_start).nanoseconds)));

            if (comptime fork.gte(.altair)) {
                const inactivity_start = time.start(io);
                state_transition.processInactivityUpdates(
                    fork,
                    allocator,
                    BenchState.cloned_cached_state.config,
                    epoch_cache,
                    fork_state,
                    cache,
                ) catch unreachable;
                recordSegment(.inactivity_updates, @as(u64, @intCast(time.since(io, inactivity_start).nanoseconds)));
            }

            const registry_start = time.start(io);
            state_transition.processRegistryUpdates(
                fork,
                BenchState.cloned_cached_state.config,
                epoch_cache,
                fork_state,
                cache,
            ) catch unreachable;
            recordSegment(.registry_updates, @as(u64, @intCast(time.since(io, registry_start).nanoseconds)));

            const slashings_start = time.start(io);
            const slashing_penalties = state_transition.processSlashings(
                fork,
                epoch_cache,
                fork_state,
                cache,
                false,
            ) catch unreachable;
            recordSegment(.slashings, @as(u64, @intCast(time.since(io, slashings_start).nanoseconds)));

            const rewards_start = time.start(io);
            state_transition.processRewardsAndPenalties(
                fork,
                BenchState.cloned_cached_state.config,
                epoch_cache,
                fork_state,
                cache,
                slashing_penalties,
            ) catch unreachable;
            recordSegment(.rewards_and_penalties, @as(u64, @intCast(time.since(io, rewards_start).nanoseconds)));

            const eth1_start = time.start(io);
            state_transition.processEth1DataReset(fork, fork_state, cache) catch unreachable;
            recordSegment(.eth1_data_reset, @as(u64, @intCast(time.since(io, eth1_start).nanoseconds)));

            if (comptime fork.gte(.electra)) {
                const pending_deposits_start = time.start(io);
                state_transition.processPendingDeposits(
                    fork,
                    allocator,
                    io,
                    BenchState.cloned_cached_state.config,
                    epoch_cache,
                    fork_state,
                    cache,
                ) catch unreachable;
                recordSegment(.pending_deposits, @as(u64, @intCast(time.since(io, pending_deposits_start).nanoseconds)));

                const pending_consolidations_start = time.start(io);
                state_transition.processPendingConsolidations(
                    fork,
                    epoch_cache,
                    fork_state,
                    cache,
                ) catch unreachable;
                recordSegment(.pending_consolidations, @as(u64, @intCast(time.since(io, pending_consolidations_start).nanoseconds)));
            }

            const eb_start = time.start(io);
            _ = state_transition.processEffectiveBalanceUpdates(
                fork,
                allocator,
                epoch_cache,
                fork_state,
                cache,
            ) catch unreachable;
            recordSegment(.effective_balance_updates, @as(u64, @intCast(time.since(io, eb_start).nanoseconds)));

            const slashings_reset_start = time.start(io);
            state_transition.processSlashingsReset(
                fork,
                epoch_cache,
                fork_state,
                cache,
            ) catch unreachable;
            recordSegment(.slashings_reset, @as(u64, @intCast(time.since(io, slashings_reset_start).nanoseconds)));

            const randao_reset_start = time.start(io);
            state_transition.processRandaoMixesReset(fork, fork_state, cache) catch unreachable;
            recordSegment(.randao_mixes_reset, @as(u64, @intCast(time.since(io, randao_reset_start).nanoseconds)));

            if (comptime fork.gte(.capella)) {
                const historical_summaries_start = time.start(io);
                state_transition.processHistoricalSummariesUpdate(fork, fork_state, cache) catch unreachable;
                recordSegment(.historical_summaries, @as(u64, @intCast(time.since(io, historical_summaries_start).nanoseconds)));
            } else {
                const historical_roots_start = time.start(io);
                state_transition.processHistoricalRootsUpdate(fork, fork_state, cache) catch unreachable;
                recordSegment(.historical_roots, @as(u64, @intCast(time.since(io, historical_roots_start).nanoseconds)));
            }

            if (comptime fork == .phase0) {
                const participation_record_start = time.start(io);
                state_transition.processParticipationRecordUpdates(fork, fork_state) catch unreachable;
                recordSegment(.participation_record, @as(u64, @intCast(time.since(io, participation_record_start).nanoseconds)));
            } else {
                const participation_flag_start = time.start(io);
                state_transition.processParticipationFlagUpdates(fork, fork_state) catch unreachable;
                recordSegment(.participation_flags, @as(u64, @intCast(time.since(io, participation_flag_start).nanoseconds)));
            }

            if (comptime fork.gte(.altair)) {
                const sync_updates_start = time.start(io);
                state_transition.processSyncCommitteeUpdates(
                    fork,
                    allocator,
                    epoch_cache,
                    fork_state,
                ) catch unreachable;
                recordSegment(.sync_committee_updates, @as(u64, @intCast(time.since(io, sync_updates_start).nanoseconds)));
            }

            if (comptime fork.gte(.fulu)) {
                const lookahead_start = time.start(io);
                state_transition.processProposerLookahead(
                    fork,
                    allocator,
                    epoch_cache,
                    fork_state,
                    cache,
                ) catch unreachable;
                recordSegment(.proposer_lookahead, @as(u64, @intCast(time.since(io, lookahead_start).nanoseconds)));
            }

            const state_root_start = time.start(io);
            _ = BenchState.cloned_cached_state.state.hashTreeRoot() catch unreachable;
            recordSegment(.state_root, @as(u64, @intCast(time.since(io, state_root_start).nanoseconds)));

            recordSegment(.epoch_total, @as(u64, @intCast(time.since(io, epoch_start).nanoseconds)));
        }
    };
}

fn loadStateBytesFromConfiguredEraFiles(allocator: std.mem.Allocator, io: std.Io, stdout: *std.Io.Writer) ![]const u8 {
    if (download_era_options.era_files.len == 0) return error.NoEraFilesConfigured;

    var last_err: ?anyerror = null;

    for (download_era_options.era_files) |era_file| {
        const era_path = try std.fs.path.join(
            allocator,
            &[_][]const u8{ download_era_options.era_out_dir, era_file },
        );
        defer allocator.free(era_path);

        var era_reader = era.Reader.open(allocator, io, config.mainnet.config, era_path) catch |err| {
            last_err = err;
            try stdout.print("Skipping ERA file {s}: {s}\n", .{ era_path, @errorName(err) });
            continue;
        };
        defer era_reader.close(allocator);

        const state_bytes = era_reader.readSerializedState(allocator, null) catch |err| {
            last_err = err;
            try stdout.print("Skipping ERA file {s}: {s}\n", .{ era_path, @errorName(err) });
            continue;
        };

        try stdout.print("State file loaded from {s}: {} bytes\n", .{ era_path, state_bytes.len });
        return state_bytes;
    }

    if (last_err) |err| return err;
    return error.NoUsableEraStateFound;
}

var gpa: std.heap.DebugAllocator(.{}) = .init;

pub fn main(init: std.process.Init) !void {
    defer if (builtin.mode == .Debug) std.debug.assert(gpa.deinit() == .ok);

    const allocator = if (builtin.mode == .Debug)
        gpa.allocator()
    else
        std.heap.c_allocator;
    const io = init.io;
    var stdout_buf: [4096]u8 = undefined;
    var stdout_file_writer = std.Io.File.stdout().writer(io, &stdout_buf);
    var stdout = &stdout_file_writer.interface;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 10_000_000 });
    defer pool.deinit();

    const state_bytes = try loadStateBytesFromConfiguredEraFiles(allocator, io, stdout);
    defer allocator.free(state_bytes);

    // Detect fork from state SSZ bytes
    const chain_config = config.mainnet.chain_config;
    const slot = slotFromStateBytes(state_bytes);
    const detected_fork = config.mainnet.config.forkSeq(slot);
    try stdout.print("Benchmarking processEpoch with state at fork: {s} (slot {})\n", .{ @tagName(detected_fork), slot });

    // Dispatch to fork-specific loading
    inline for (comptime std.enums.values(ForkSeq)) |fork| {
        if (detected_fork == fork) {
            return runBenchmark(fork, allocator, &pool, io, stdout, state_bytes, chain_config);
        }
    }
    return error.NoBenchmarkRan;
}

fn runBenchmark(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    pool: *Node.Pool,
    io: std.Io,
    stdout: *std.Io.Writer,
    state_bytes: []const u8,
    chain_config: config.ChainConfig,
) !void {
    defer state_transition.deinitReusedEpochTransitionCache();

    var beacon_state: ?*AnyBeaconState = try loadState(fork, allocator, pool, state_bytes);
    defer if (beacon_state) |state| {
        state.deinit();
        allocator.destroy(state);
    };

    try stdout.print("State deserialized: slot={}, validators={}\n", .{
        try beacon_state.?.slot(),
        try beacon_state.?.validatorsCount(),
    });

    const beacon_config = config.BeaconConfig.init(chain_config, (try beacon_state.?.genesisValidatorsRoot()).*);

    var pubkey_cache = try state_transition.PubkeyCache.initCapacity(
        allocator,
        io,
        try std.math.add(
            usize,
            try beacon_state.?.validatorsCount(),
            preset.MAX_PENDING_DEPOSITS_PER_EPOCH,
        ),
    );
    defer pubkey_cache.deinit();

    const immutable_data = state_transition.EpochCacheImmutableData{
        .config = &beacon_config,
        .pubkey_cache = &pubkey_cache,
    };

    const cached_state = try CachedBeaconState.createCachedBeaconState(allocator, io, beacon_state.?, immutable_data, .{
        .skip_sync_committee_cache = !comptime fork.gte(.altair),
        .skip_sync_pubkeys = false,
    });
    BenchState.init(allocator, cached_state);
    beacon_state = null;
    defer {
        cached_state.deinit();
        allocator.destroy(cached_state);
    }

    var epoch_transition_cache = try EpochTransitionCache.init(
        allocator,
        cached_state.config,
        cached_state.epoch_cache,
        cached_state.state,
    );
    defer epoch_transition_cache.deinit();

    try stdout.print("Cached state created at slot {}\n", .{try cached_state.state.slot()});
    try stdout.print("\nStarting process_epoch benchmarks for {s} fork...\n\n", .{@tagName(fork)});

    const hooks: zbench.Hooks = .{ .before_each = BenchState.beforeEach, .after_each = BenchState.afterEach };
    const effective_balance_hooks: zbench.Hooks = .{
        .before_each = ProcessEffectiveBalanceUpdatesBench(fork).beforeEach,
        .after_each = BenchState.afterEach,
    };

    var bench = zbench.Benchmark.init(allocator, .{ .iterations = 50 });
    defer bench.deinit();

    try bench.addParam("before_process_epoch", &ProcessBeforeProcessEpochBench(fork){ .io = io }, .{ .hooks = hooks });

    try bench.addParam("justification_finalization", &ProcessJustificationAndFinalizationBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    if (comptime fork.gte(.altair)) {
        try bench.addParam("inactivity_updates", &ProcessInactivityUpdatesBench(fork){
            .epoch_transition_cache = &epoch_transition_cache,
        }, .{ .hooks = hooks });
    }

    try bench.addParam("rewards_and_penalties", &ProcessRewardsAndPenaltiesBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    try bench.addParam("registry_updates", &ProcessRegistryUpdatesBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    try bench.addParam("slashings", &ProcessSlashingsBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    try bench.addParam("eth1_data_reset", &ProcessEth1DataResetBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    if (comptime fork.gte(.electra)) {
        try bench.addParam("pending_deposits", &ProcessPendingDepositsBench(fork){
            .epoch_transition_cache = &epoch_transition_cache,
            .io = io,
        }, .{ .hooks = hooks });

        try bench.addParam("pending_consolidations", &ProcessPendingConsolidationsBench(fork){
            .epoch_transition_cache = &epoch_transition_cache,
        }, .{ .hooks = hooks });
    }

    try bench.addParam("effective_balance_updates", &ProcessEffectiveBalanceUpdatesBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = effective_balance_hooks });

    try bench.addParam("slashings_reset", &ProcessSlashingsResetBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    try bench.addParam("randao_mixes_reset", &ProcessRandaoMixesResetBench(fork){
        .epoch_transition_cache = &epoch_transition_cache,
    }, .{ .hooks = hooks });

    if (comptime fork.gte(.capella)) {
        try bench.addParam("historical_summaries", &ProcessHistoricalSummariesUpdateBench(fork){
            .epoch_transition_cache = &epoch_transition_cache,
        }, .{ .hooks = hooks });
    }

    if (comptime fork.gte(.altair)) {
        try bench.addParam("participation_flags", &ProcessParticipationFlagUpdatesBench(fork){}, .{ .hooks = hooks });

        try bench.addParam("sync_committee_updates", &ProcessSyncCommitteeUpdatesBench(fork){}, .{ .hooks = hooks });
    }

    if (comptime fork.gte(.fulu)) {
        try bench.addParam("proposer_lookahead(sync)", &ProcessProposerLookaheadBench(fork){
            .epoch_transition_cache = &epoch_transition_cache,
        }, .{ .hooks = .{
            .before_each = BenchState.beforeEach,
            .after_each = ProcessProposerLookaheadBench(fork).afterEach,
        } });
    }

    // Non-segmented
    try bench.addParam("epoch(non-segmented)", &ProcessEpochBench(fork){ .io = io }, .{ .hooks = hooks });

    // Segmented (step-by-step timing)
    resetSegmentStats();
    try bench.addParam("epoch(segmented)", &ProcessEpochSegmentedBench(fork){ .io = io }, .{ .hooks = hooks });

    try bench.run(io, std.Io.File.stdout());
    try printSegmentStats(stdout);
    try stdout.flush();
}
