const std = @import("std");
const diagnostics = @import("../diagnostics.zig");
const Diagnostics = diagnostics.Diagnostics;
const Allocator = std.mem.Allocator;
const metrics = @import("../metrics.zig");
const time = @import("time");
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const SlashingsCache = @import("../cache/slashings_cache.zig").SlashingsCache;
const buildSlashingsCacheIfNeeded = @import("../cache/slashings_cache.zig").buildFromStateIfNeeded;
const BeaconState = @import("fork_types").BeaconState;
const BlockType = @import("fork_types").BlockType;
const BeaconBlock = @import("fork_types").BeaconBlock;
const ForkSeq = @import("config").ForkSeq;
const types = @import("consensus_types");
const Root = types.primitive.Root.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const preset = @import("preset").preset;
const BlockExternalData = @import("../state_transition.zig").BlockExternalData;
const Withdrawals = types.capella.Withdrawals.Type;
const WithdrawalsResult = @import("./process_withdrawals.zig").WithdrawalsResult;
const processBlobKzgCommitments = @import("./process_blob_kzg_commitments.zig").processBlobKzgCommitments;
const processBlockHeader = @import("./process_block_header.zig").processBlockHeader;
const processEth1Data = @import("./process_eth1_data.zig").processEth1Data;
const processExecutionPayload = @import("./process_execution_payload.zig").processExecutionPayload;
const processOperations = @import("./process_operations.zig").processOperations;
const processRandao = @import("./process_randao.zig").processRandao;
const processSyncAggregate = @import("./process_sync_committee.zig").processSyncAggregate;
const processWithdrawals = @import("./process_withdrawals.zig").processWithdrawals;
const getExpectedWithdrawals = @import("./process_withdrawals.zig").getExpectedWithdrawals;
const isExecutionEnabled = @import("../utils/execution.zig").isExecutionEnabled;
const processParentExecutionPayload = @import("process_parent_execution_payload.zig").processParentExecutionPayload;
const isParentBlockFull = @import("../utils/gloas.zig").isParentBlockFull;
const gloas_withdrawals = @import("process_withdrawals_gloas.zig");
const processExecutionPayloadBid = @import("process_execution_payload_bid.zig").processExecutionPayloadBid;

pub const ProcessBlockOpts = struct {
    diagnostics: ?*Diagnostics = null,
    verify_signature: bool = true,
    parent_slot: ?u64 = null,
};

/// Process a block and update the state following Ethereum Consensus specifications.
pub fn processBlock(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    proposer_rewards: *ProposerRewards,
    slashings_cache: *SlashingsCache,
    comptime block_type: BlockType,
    block: *const BeaconBlock(block_type, fork),
    external_data: BlockExternalData,
    opts: ProcessBlockOpts,
) !void {
    var operation_opts = opts;
    if (comptime fork.gte(.gloas)) {
        operation_opts.parent_slot = try state.latestBlockHeaderSlot();
        try processParentExecutionPayload(fork, allocator, io, config, epoch_cache, state, block);
    }

    // Build slashings cache against the *current* latest_block_header slot (pre-header update).
    try buildSlashingsCacheIfNeeded(allocator, state, slashings_cache);
    var timer = time.start(io);
    try processBlockHeader(fork, allocator, epoch_cache, state, block_type, block);
    try metrics.state_transition.process_block_step.observe(
        .{ .step = .processBlockHeader },
        time.durationSeconds(time.since(io, timer)),
    );
    // Keep cache slot in sync with latest_block_header without forcing a rebuild.
    slashings_cache.updateLatestBlockSlot(block.slot());
    const body = block.body();
    const current_epoch = epoch_cache.epoch;

    // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
    // on the randao_mix computed with the reveal of the previous block.
    // Gloas (ePBS): execution payload is decoupled from the block, processed via ExecutionPayloadEnvelope
    if (comptime fork.gte(.bellatrix) and fork.lt(.gloas)) {
        if (isExecutionEnabled(fork, state, block_type, block)) {
            // TODO Deneb: Allow to disable withdrawals for interop testing
            // https://github.com/ethereum/consensus-specs/blob/b62c9e877990242d63aa17a2a59a49bc649a2f2e/specs/eip4844/beacon-chain.md#disabling-withdrawals
            if (comptime fork.gte(.capella)) {
                timer = time.start(io);
                var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]types.capella.Withdrawal.Type = undefined;
                var withdrawals_result = WithdrawalsResult{ .withdrawals = Withdrawals.initBuffer(&withdrawals_buf) };
                var withdrawal_balances = std.AutoHashMap(ValidatorIndex, usize).init(allocator);
                defer withdrawal_balances.deinit();

                try getExpectedWithdrawals(
                    fork,
                    epoch_cache,
                    state,
                    &withdrawals_result,
                    &withdrawal_balances,
                );

                const payload_withdrawals_root = switch (block_type) {
                    .full => blk: {
                        const actual_withdrawals = block.body().executionPayload().inner.withdrawals;
                        if (withdrawals_result.withdrawals.items.len != actual_withdrawals.items.len) {
                            return diagnostics.withdrawalsLengthMismatch(
                                opts.diagnostics,
                                withdrawals_result.withdrawals.items.len,
                                actual_withdrawals.items.len,
                            );
                        }
                        var root: Root = undefined;
                        try types.capella.Withdrawals.hashTreeRoot(allocator, &actual_withdrawals, &root);
                        break :blk root;
                    },
                    .blinded => block.body().executionPayloadHeader().inner.withdrawals_root,
                };
                try processWithdrawals(fork, allocator, state, withdrawals_result, payload_withdrawals_root, opts.diagnostics);
                try metrics.state_transition.process_block_step.observe(
                    .{ .step = .processWithdrawals },
                    time.durationSeconds(time.since(io, timer)),
                );
            }

            timer = time.start(io);
            try processExecutionPayload(
                fork,
                allocator,
                config,
                state,
                current_epoch,
                block_type,
                body,
                external_data,
            );
            try metrics.state_transition.process_block_step.observe(
                .{ .step = .processExecutionPayload },
                time.durationSeconds(time.since(io, timer)),
            );
        }
    }

    if (comptime fork.gte(.gloas)) {
        if (try isParentBlockFull(fork, state)) {
            var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]types.capella.Withdrawal.Type = undefined;
            var result = WithdrawalsResult{ .withdrawals = Withdrawals.initBuffer(&withdrawals_buf) };
            try gloas_withdrawals.getExpectedWithdrawals(fork, epoch_cache, state, &result);
            try gloas_withdrawals.processWithdrawals(fork, state, &result);
        }
        try processExecutionPayloadBid(fork, allocator, config, epoch_cache, state, &body.inner.signed_execution_payload_bid);
    }

    timer = time.start(io);
    try processRandao(fork, io, config, epoch_cache, state, block_type, body, block.proposerIndex(), opts.verify_signature);
    try metrics.state_transition.process_block_step.observe(
        .{ .step = .processRandao },
        time.durationSeconds(time.since(io, timer)),
    );
    timer = time.start(io);
    if (comptime fork.lt(.heze)) try processEth1Data(fork, state, body.eth1Data());
    try metrics.state_transition.process_block_step.observe(
        .{ .step = .processEth1Data },
        time.durationSeconds(time.since(io, timer)),
    );
    timer = time.start(io);
    try processOperations(fork, allocator, io, config, epoch_cache, state, proposer_rewards, slashings_cache, block_type, body, operation_opts);
    try metrics.state_transition.process_block_step.observe(
        .{ .step = .processOperations },
        time.durationSeconds(time.since(io, timer)),
    );
    if (comptime fork.gte(.altair)) {
        timer = time.start(io);
        try processSyncAggregate(
            fork,
            io,
            config,
            epoch_cache,
            state,
            proposer_rewards,
            body.syncAggregate(),
            opts.verify_signature,
        );
        try metrics.state_transition.process_block_step.observe(
            .{ .step = .processSyncAggregate },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    if (comptime fork.gte(.deneb)) {
        timer = time.start(io);
        try processBlobKzgCommitments(external_data);
        try metrics.state_transition.process_block_step.observe(
            .{ .step = .processBlobKzgCommitments },
            time.durationSeconds(time.since(io, timer)),
        );
        // Only throw PreData so beacon can also sync/process blocks optimistically
        // and let forkChoice handle it
        if (external_data.data_availability_status == .pre_data) {
            return error.DataAvailabilityPreData;
        }
    }
}
