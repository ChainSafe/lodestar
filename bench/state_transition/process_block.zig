//! Benchmark for fork-specific block processing.
//!
//! Uses a mainnet state at slot 13180928 and block at slot 13180929.
//! Run with: zig build run:bench_process_block -Doptimize=ReleaseSafe -Dcpu=baseline [-- /path/to/state.ssz /path/to/block.ssz]

const std = @import("std");
const builtin = @import("builtin");
const zbench = @import("zbench");
const Node = @import("persistent_merkle_tree").Node;
const state_transition = @import("state_transition");
const time = @import("time");
const types = @import("consensus_types");
const config = @import("config");
const fork_types = @import("fork_types");
const download_era_options = @import("download_era_options");
const era = @import("era");
const preset = state_transition.preset;
const ForkSeq = config.ForkSeq;
const CachedBeaconState = state_transition.CachedBeaconState;
const BeaconBlock = fork_types.BeaconBlock;
const BeaconBlockBody = fork_types.BeaconBlockBody;
const AnyBeaconState = fork_types.AnyBeaconState;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const Withdrawals = types.capella.Withdrawals.Type;
const WithdrawalsResult = state_transition.WithdrawalsResult;
const BlockExternalData = state_transition.BlockExternalData;
const slotFromStateBytes = @import("utils.zig").slotFromStateBytes;
const loadState = @import("utils.zig").loadState;
const loadBlock = @import("utils.zig").loadBlock;
const BenchState = @import("utils.zig").BenchState;

const BenchOpts = struct {
    verify_signature: bool,
};

fn ProcessBlockHeaderBench(comptime fork: ForkSeq) type {
    return struct {
        block: *const BeaconBlock(.full, fork),

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            state_transition.processBlockHeader(
                fork,
                allocator,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                .full,
                self.block,
            ) catch unreachable;
        }
    };
}

fn ProcessWithdrawalsBench(comptime fork: ForkSeq) type {
    return struct {
        body: *const BeaconBlockBody(.full, fork),

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]types.capella.Withdrawal.Type = undefined;
            var withdrawals_result = WithdrawalsResult{
                .withdrawals = Withdrawals.initBuffer(&withdrawals_buf),
            };

            var withdrawal_balances = std.AutoHashMap(ValidatorIndex, usize).init(allocator);
            defer withdrawal_balances.deinit();

            const state = BenchState.cloned_cached_state.state.castToFork(fork);
            state_transition.getExpectedWithdrawals(
                fork,
                BenchState.cloned_cached_state.epoch_cache,
                state,
                &withdrawals_result,
                &withdrawal_balances,
            ) catch unreachable;

            const actual_withdrawals = self.body.executionPayload().inner.withdrawals;
            var payload_withdrawals_root: [32]u8 = undefined;
            types.capella.Withdrawals.hashTreeRoot(allocator, &actual_withdrawals, &payload_withdrawals_root) catch unreachable;

            state_transition.processWithdrawals(
                fork,
                allocator,
                state,
                withdrawals_result,
                payload_withdrawals_root,
                null,
            ) catch unreachable;
        }
    };
}

fn ProcessExecutionPayloadBench(comptime fork: ForkSeq) type {
    return struct {
        body: *const BeaconBlockBody(.full, fork),

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const external_data = BlockExternalData{ .execution_payload_status = .valid, .data_availability_status = .available };
            state_transition.processExecutionPayload(
                fork,
                allocator,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.state.castToFork(fork),
                BenchState.cloned_cached_state.epoch_cache.epoch,
                .full,
                self.body,
                external_data,
            ) catch unreachable;
        }
    };
}

fn ProcessRandaoBench(comptime fork: ForkSeq, comptime opts: BenchOpts) type {
    return struct {
        block: *const BeaconBlock(.full, fork),
        body: *const BeaconBlockBody(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), _: std.mem.Allocator) void {
            state_transition.processRandao(
                fork,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                .full,
                self.body,
                self.block.proposerIndex(),
                opts.verify_signature,
            ) catch unreachable;
        }
    };
}

fn ProcessEth1DataBench(comptime fork: ForkSeq) type {
    return struct {
        body: *const BeaconBlockBody(.full, fork),

        pub fn run(self: *@This(), _: std.mem.Allocator) void {
            state_transition.processEth1Data(
                fork,
                BenchState.cloned_cached_state.state.castToFork(fork),
                self.body.eth1Data(),
            ) catch unreachable;
        }
    };
}

fn ProcessOperationsBench(comptime fork: ForkSeq, comptime opts: BenchOpts) type {
    return struct {
        body: *const BeaconBlockBody(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            state_transition.processOperations(
                fork,
                allocator,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                &BenchState.cloned_cached_state.proposer_rewards,
                &BenchState.cloned_cached_state.slashings_cache,
                .full,
                self.body,
                .{ .verify_signature = opts.verify_signature },
            ) catch unreachable;
        }
    };
}

fn ProcessSyncAggregateBench(comptime fork: ForkSeq, comptime opts: BenchOpts) type {
    return struct {
        body: *const BeaconBlockBody(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            _ = allocator;
            state_transition.processSyncAggregate(
                fork,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                &BenchState.cloned_cached_state.proposer_rewards,
                self.body.syncAggregate(),
                opts.verify_signature,
            ) catch unreachable;
        }
    };
}

fn ProcessBlockBench(comptime fork: ForkSeq, comptime opts: BenchOpts) type {
    return struct {
        block: *const BeaconBlock(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const external_data = BlockExternalData{ .execution_payload_status = .valid, .data_availability_status = .available };
            state_transition.processBlock(
                fork,
                allocator,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                &BenchState.cloned_cached_state.proposer_rewards,
                &BenchState.cloned_cached_state.slashings_cache,
                .full,
                self.block,
                external_data,
                .{ .verify_signature = opts.verify_signature },
            ) catch unreachable;
        }
    };
}

/// processBlock + hashTreeRoot — the honest per-block cost: processBlock only
/// stages writes, the chunked_leaf re-merkleization happens in hashTreeRoot.
fn ProcessBlockRootBench(comptime fork: ForkSeq, comptime opts: BenchOpts) type {
    return struct {
        block: *const BeaconBlock(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const external_data = BlockExternalData{ .execution_payload_status = .valid, .data_availability_status = .available };
            state_transition.processBlock(
                fork,
                allocator,
                self.io,
                BenchState.cloned_cached_state.config,
                BenchState.cloned_cached_state.epoch_cache,
                BenchState.cloned_cached_state.state.castToFork(fork),
                &BenchState.cloned_cached_state.proposer_rewards,
                &BenchState.cloned_cached_state.slashings_cache,
                .full,
                self.block,
                external_data,
                .{ .verify_signature = opts.verify_signature },
            ) catch unreachable;
            _ = BenchState.cloned_cached_state.state.hashTreeRoot() catch unreachable;
        }
    };
}

/// We segregate block processing into `Step`s for more insight into the perf of each part of the process.
const Step = enum {
    block_total,
    block_header,
    withdrawals,
    execution_payload,
    randao,
    eth1_data,
    operations,
    sync_aggregate,
    commit,
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
    try stdout.print("\nSegmented block breakdown :\n", .{});
    try stdout.print("{s:<22} {s:<8} {s:<14} {s:<23}\n", .{ "step", "runs", "total time", "time/run (avg)" });
    try stdout.print("{s:-<69}\n", .{""});
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
            try stdout.print("{s:<22} {d:<8} {d:.3}s         {d:.3}ms\n", .{ @tagName(step), count, total_s, avg_ms });
        } else {
            try stdout.print("{s:<22} {d:<8} {d:.3}ms        {d:.3}ms\n", .{ @tagName(step), count, total_ms, avg_ms });
        }
    }
    try stdout.print("\n", .{});
}

fn ProcessBlockSegmentedBench(comptime fork: ForkSeq) type {
    return struct {
        block: *const BeaconBlock(.full, fork),
        body: *const BeaconBlockBody(.full, fork),
        io: std.Io,

        pub fn run(self: *@This(), allocator: std.mem.Allocator) void {
            const io = self.io;
            const state = BenchState.cloned_cached_state.state.castToFork(fork);
            const epoch_cache = BenchState.cloned_cached_state.epoch_cache;
            const block_start = time.start(io);

            const header_start = time.start(io);
            state_transition.processBlockHeader(
                fork,
                allocator,
                epoch_cache,
                state,
                .full,
                self.block,
            ) catch unreachable;
            recordSegment(.block_header, @as(u64, @intCast(time.since(io, header_start).nanoseconds)));

            if (comptime fork.gte(.capella) and fork.lt(.gloas)) {
                const withdrawals_start = time.start(io);

                var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]types.capella.Withdrawal.Type = undefined;
                var withdrawals_result = WithdrawalsResult{
                    .withdrawals = Withdrawals.initBuffer(&withdrawals_buf),
                };
                var withdrawal_balances = std.AutoHashMap(ValidatorIndex, usize).init(allocator);
                defer withdrawal_balances.deinit();
                state_transition.getExpectedWithdrawals(
                    fork,
                    epoch_cache,
                    state,
                    &withdrawals_result,
                    &withdrawal_balances,
                ) catch unreachable;
                const actual_withdrawals = self.body.executionPayload().inner.withdrawals;
                var payload_withdrawals_root: [32]u8 = undefined;
                types.capella.Withdrawals.hashTreeRoot(allocator, &actual_withdrawals, &payload_withdrawals_root) catch unreachable;
                state_transition.processWithdrawals(
                    fork,
                    allocator,
                    state,
                    withdrawals_result,
                    payload_withdrawals_root,
                    null,
                ) catch unreachable;
                recordSegment(.withdrawals, @as(u64, @intCast(time.since(io, withdrawals_start).nanoseconds)));
            }

            if (comptime fork.gte(.bellatrix) and fork.lt(.gloas)) {
                const exec_start = time.start(io);
                const external_data = BlockExternalData{ .execution_payload_status = .valid, .data_availability_status = .available };
                state_transition.processExecutionPayload(
                    fork,
                    allocator,
                    BenchState.cloned_cached_state.config,
                    state,
                    epoch_cache.epoch,
                    .full,
                    self.body,
                    external_data,
                ) catch unreachable;
                recordSegment(.execution_payload, @as(u64, @intCast(time.since(io, exec_start).nanoseconds)));
            }

            const randao_start = time.start(io);
            state_transition.processRandao(
                fork,
                io,
                BenchState.cloned_cached_state.config,
                epoch_cache,
                state,
                .full,
                self.body,
                self.block.proposerIndex(),
                true,
            ) catch unreachable;
            recordSegment(.randao, @as(u64, @intCast(time.since(io, randao_start).nanoseconds)));

            const eth1_start = time.start(io);
            state_transition.processEth1Data(
                fork,
                state,
                self.body.eth1Data(),
            ) catch unreachable;
            recordSegment(.eth1_data, @as(u64, @intCast(time.since(io, eth1_start).nanoseconds)));

            const ops_start = time.start(io);
            state_transition.processOperations(
                fork,
                allocator,
                io,
                BenchState.cloned_cached_state.config,
                epoch_cache,
                state,
                &BenchState.cloned_cached_state.proposer_rewards,
                &BenchState.cloned_cached_state.slashings_cache,
                .full,
                self.body,
                .{ .verify_signature = true },
            ) catch unreachable;
            recordSegment(.operations, @as(u64, @intCast(time.since(io, ops_start).nanoseconds)));

            if (comptime fork.gte(.altair)) {
                const sync_start = time.start(io);
                state_transition.processSyncAggregate(
                    fork,
                    io,
                    BenchState.cloned_cached_state.config,
                    epoch_cache,
                    state,
                    &BenchState.cloned_cached_state.proposer_rewards,
                    self.body.syncAggregate(),
                    true,
                ) catch unreachable;
                recordSegment(.sync_aggregate, @as(u64, @intCast(time.since(io, sync_start).nanoseconds)));
            }

            const commit_start = time.start(io);
            BenchState.cloned_cached_state.state.commit() catch unreachable;
            recordSegment(.commit, @as(u64, @intCast(time.since(io, commit_start).nanoseconds)));

            const root_start = time.start(io);
            _ = BenchState.cloned_cached_state.state.hashTreeRoot() catch unreachable;
            recordSegment(.state_root, @as(u64, @intCast(time.since(io, root_start).nanoseconds)));

            recordSegment(.block_total, @as(u64, @intCast(time.since(io, block_start).nanoseconds)));
        }
    };
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

    // Use download_era_options.era_files[0] for state

    const era_path_0 = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[0] },
    );
    defer allocator.free(era_path_0);

    var era_reader_0 = try era.Reader.open(allocator, io, config.mainnet.config, era_path_0);
    defer era_reader_0.close(allocator);

    const state_bytes = try era_reader_0.readSerializedState(allocator, null);
    defer allocator.free(state_bytes);

    const chain_config = config.mainnet.chain_config;
    const slot = slotFromStateBytes(state_bytes);
    const detected_fork = config.mainnet.config.forkSeq(slot);
    try stdout.print("Benchmarking processBlock with state at fork: {s} (slot {})\n", .{ @tagName(detected_fork), slot });

    // Use download_era_options.era_files[1] for state

    const era_path_1 = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[1] },
    );
    defer allocator.free(era_path_1);

    var era_reader_1 = try era.Reader.open(allocator, io, config.mainnet.config, era_path_1);
    defer era_reader_1.close(allocator);

    const block_slot = try era.era.computeStartBlockSlotFromEraNumber(era_reader_1.era_number) + 1;

    const block_bytes = try era_reader_1.readSerializedBlock(allocator, block_slot) orelse return error.InvalidEraFile;
    defer allocator.free(block_bytes);

    inline for (comptime std.enums.values(ForkSeq)) |fork| {
        if (detected_fork == fork) return runBenchmark(fork, allocator, &pool, io, stdout, state_bytes, block_bytes, chain_config);
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
    block_bytes: []const u8,
    chain_config: config.ChainConfig,
) !void {
    var signed_beacon_block = try loadBlock(fork, allocator, block_bytes);
    defer signed_beacon_block.deinit(allocator);

    const any_block = signed_beacon_block.beaconBlock();
    const block = any_block.castToFork(.full, fork);
    const body = block.body();
    const block_slot = block.slot();
    try stdout.print("Block: slot: {}\n", .{block_slot});

    var beacon_state: ?*AnyBeaconState = try loadState(fork, allocator, pool, state_bytes);
    defer if (beacon_state) |state| {
        state.deinit();
        allocator.destroy(state);
    };

    const beacon_config = config.BeaconConfig.init(chain_config, (try beacon_state.?.genesisValidatorsRoot()).*);

    var pubkey_cache = try state_transition.PubkeyCache.initCapacity(
        allocator,
        io,
        try std.math.add(
            usize,
            try beacon_state.?.validatorsCount(),
            preset.MAX_DEPOSITS,
        ),
    );
    defer pubkey_cache.deinit();

    const cached_state = try CachedBeaconState.createCachedBeaconState(allocator, io, beacon_state.?, .{
        .config = &beacon_config,
        .pubkey_cache = &pubkey_cache,
    }, .{ .skip_sync_committee_cache = !comptime fork.gte(.altair), .skip_sync_pubkeys = false });
    BenchState.init(allocator, cached_state);
    beacon_state = null;
    defer {
        cached_state.deinit();
        allocator.destroy(cached_state);
    }

    try state_transition.state_transition.processSlots(
        allocator,
        io,
        cached_state,
        block_slot,
        null,
    );
    try cached_state.state.commit();
    try state_transition.buildSlashingsCacheFromStateIfNeeded(allocator, cached_state.state, &cached_state.slashings_cache);
    try stdout.print("State: slot={}, validators={}\n", .{ try cached_state.state.slot(), try cached_state.state.validatorsCount() });

    const hooks: zbench.Hooks = .{ .before_each = BenchState.beforeEach, .after_each = BenchState.afterEach };

    var bench = zbench.Benchmark.init(allocator, .{
        .iterations = 50,
    });
    defer bench.deinit();

    try bench.addParam("block_header", &ProcessBlockHeaderBench(fork){ .block = block }, .{ .hooks = hooks });

    if (comptime fork.gte(.capella) and fork.lt(.gloas)) {
        try bench.addParam("withdrawals", &ProcessWithdrawalsBench(fork){ .body = body }, .{ .hooks = hooks });
    }
    if (comptime fork.gte(.bellatrix) and fork.lt(.gloas)) {
        try bench.addParam("execution_payload", &ProcessExecutionPayloadBench(fork){ .body = body }, .{ .hooks = hooks });
    }

    try bench.addParam("randao", &ProcessRandaoBench(fork, .{ .verify_signature = true }){ .block = block, .body = body, .io = io }, .{ .hooks = hooks });
    try bench.addParam("randao_no_sig", &ProcessRandaoBench(fork, .{ .verify_signature = false }){ .block = block, .body = body, .io = io }, .{ .hooks = hooks });
    try bench.addParam("eth1_data", &ProcessEth1DataBench(fork){ .body = body }, .{ .hooks = hooks });
    try bench.addParam("operations", &ProcessOperationsBench(fork, .{ .verify_signature = true }){ .body = body, .io = io }, .{ .hooks = hooks });
    try bench.addParam("operations_no_sig", &ProcessOperationsBench(fork, .{ .verify_signature = false }){ .body = body, .io = io }, .{ .hooks = hooks });

    if (comptime fork.gte(.altair)) {
        try bench.addParam("sync_aggregate", &ProcessSyncAggregateBench(fork, .{ .verify_signature = true }){ .body = body, .io = io }, .{ .hooks = hooks });
        try bench.addParam("sync_aggregate_no_sig", &ProcessSyncAggregateBench(fork, .{ .verify_signature = false }){ .body = body, .io = io }, .{ .hooks = hooks });
    }

    try bench.addParam("process_block", &ProcessBlockBench(fork, .{ .verify_signature = true }){ .block = block, .io = io }, .{ .hooks = hooks });
    try bench.addParam("process_block_no_sig", &ProcessBlockBench(fork, .{ .verify_signature = false }){ .block = block, .io = io }, .{ .hooks = hooks });

    try bench.addParam("process_block+root", &ProcessBlockRootBench(fork, .{ .verify_signature = true }){ .block = block, .io = io }, .{ .hooks = hooks });
    try bench.addParam("process_block+root_no_sig", &ProcessBlockRootBench(fork, .{ .verify_signature = false }){ .block = block, .io = io }, .{ .hooks = hooks });

    // // Segmented benchmark (step-by-step timing)
    resetSegmentStats();

    try bench.addParam("block(segments)", &ProcessBlockSegmentedBench(fork){ .block = block, .body = body, .io = io }, .{ .hooks = hooks });

    try bench.run(io, std.Io.File.stdout());
    try printSegmentStats(stdout);
    try stdout.flush();
}
