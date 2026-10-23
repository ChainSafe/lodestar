const std = @import("std");
const metrics = @import("../metrics.zig");
const time = @import("time");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const BeaconState = @import("fork_types").BeaconState;
const BlockType = @import("fork_types").BlockType;
const BeaconBlockBody = @import("fork_types").BeaconBlockBody;
const ForkTypes = @import("fork_types").ForkTypes;
const ct = @import("consensus_types");
const SlashingsCache = @import("../cache/slashings_cache.zig").SlashingsCache;
const preset = @import("preset").preset;
const processAttestations = @import("process_attestations.zig").processAttestations;
const processPayloadAttestation = @import("process_payload_attestation.zig").processPayloadAttestation;

const getEth1DepositCount = @import("../utils/deposit.zig").getEth1DepositCount;
const processAttesterSlashing = @import("./process_attester_slashing.zig").processAttesterSlashing;
const processBlsToExecutionChange = @import("./process_bls_to_execution_change.zig").processBlsToExecutionChange;
const processConsolidationRequest = @import("./process_consolidation_request.zig").processConsolidationRequest;
const processDeposit = @import("./process_deposit.zig").processDeposit;
const processDepositRequest = @import("./process_deposit_request.zig").processDepositRequest;
const processProposerSlashing = @import("./process_proposer_slashing.zig").processProposerSlashing;
const processVoluntaryExit = @import("./process_voluntary_exit.zig").processVoluntaryExit;
const processWithdrawalRequest = @import("./process_withdrawal_request.zig").processWithdrawalRequest;
const Node = @import("persistent_merkle_tree").Node;
const ProcessBlockOpts = @import("./process_block.zig").ProcessBlockOpts;

pub fn processOperations(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    proposer_rewards: *ProposerRewards,
    slashings_cache: *SlashingsCache,
    comptime block_type: BlockType,
    body: *const BeaconBlockBody(block_type, fork),
    opts: ProcessBlockOpts,
) !void {
    if (comptime fork.gte(.gloas)) {
        if (body.inner.proposer_slashings.items.len > preset.MAX_PROPOSER_SLASHINGS or
            body.inner.attester_slashings.items.len > preset.MAX_ATTESTER_SLASHINGS_ELECTRA or
            body.inner.attestations.items.len > preset.MAX_ATTESTATIONS_ELECTRA or
            body.inner.voluntary_exits.items.len > preset.MAX_VOLUNTARY_EXITS or
            body.inner.bls_to_execution_changes.items.len > preset.MAX_BLS_TO_EXECUTION_CHANGES or
            body.inner.payload_attestations.items.len > preset.MAX_PAYLOAD_ATTESTATIONS)
        {
            return error.TooManyBlockOperations;
        }
    }

    if (comptime fork.lt(.heze)) {
        const max_deposits: u64 = if (comptime fork.gte(.fulu)) 0 else try getEth1DepositCount(fork, state, null);
        if (body.inner.deposits.items.len != max_deposits) return error.InvalidDepositCount;
    }

    const current_epoch = epoch_cache.epoch;

    {
        const timer = time.start(io);
        for (body.inner.proposer_slashings.items) |*proposer_slashing| {
            try processProposerSlashing(fork, allocator, io, config, epoch_cache, state, proposer_rewards, slashings_cache, proposer_slashing, opts.verify_signature);
        }
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processProposerSlashing },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    {
        const timer = time.start(io);
        for (body.inner.attester_slashings.items) |*attester_slashing| {
            try processAttesterSlashing(
                fork,
                allocator,
                io,
                config,
                epoch_cache,
                state,
                proposer_rewards,
                slashings_cache,
                current_epoch,
                attester_slashing,
                opts.verify_signature,
            );
        }
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processAttesterSlashing },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    {
        const timer = time.start(io);
        try processAttestations(fork, allocator, io, config, epoch_cache, state, proposer_rewards, slashings_cache, body.inner.attestations.items, opts.parent_slot, opts.verify_signature);
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processAttestations },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    if (comptime fork.lt(.heze)) {
        const timer = time.start(io);
        for (body.inner.deposits.items) |*deposit| {
            try processDeposit(fork, io, config, epoch_cache, state, deposit);
        }
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processDeposit },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    {
        const timer = time.start(io);
        for (body.inner.voluntary_exits.items) |*voluntary_exit| {
            try processVoluntaryExit(fork, io, config, epoch_cache, state, voluntary_exit, opts.verify_signature);
        }
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processVoluntaryExit },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    if (comptime fork.gte(.capella)) {
        const timer = time.start(io);
        for (body.inner.bls_to_execution_changes.items) |*bls_to_execution_change| {
            try processBlsToExecutionChange(fork, config, state, bls_to_execution_change);
        }
        try metrics.state_transition.process_operations_step.observe(
            .{ .step = .processBlsToExecutionChange },
            time.durationSeconds(time.since(io, timer)),
        );
    }

    if (comptime fork.gte(.gloas)) {
        for (body.inner.payload_attestations.items) |*attestation| {
            try processPayloadAttestation(fork, io, config, epoch_cache, state, attestation, opts.verify_signature);
        }
    }

    // Gloas (ePBS): execution_requests moved to ExecutionPayloadEnvelope
    if (comptime fork.gte(.electra) and fork.lt(.gloas)) {
        const execution_requests = &body.inner.execution_requests;
        {
            const timer = time.start(io);
            for (execution_requests.deposits.items) |*deposit_request| {
                try processDepositRequest(fork, state, deposit_request);
            }
            try metrics.state_transition.process_operations_step.observe(
                .{ .step = .processDepositRequest },
                time.durationSeconds(time.since(io, timer)),
            );
        }

        {
            const timer = time.start(io);
            for (execution_requests.withdrawals.items) |*withdrawal_request| {
                try processWithdrawalRequest(fork, io, config, epoch_cache, state, withdrawal_request);
            }
            try metrics.state_transition.process_operations_step.observe(
                .{ .step = .processWithdrawalRequest },
                time.durationSeconds(time.since(io, timer)),
            );
        }

        {
            const timer = time.start(io);
            for (execution_requests.consolidations.items) |*consolidation_request| {
                try processConsolidationRequest(fork, io, config, epoch_cache, state, consolidation_request);
            }
            try metrics.state_transition.process_operations_step.observe(
                .{ .step = .processConsolidationRequest },
                time.durationSeconds(time.since(io, timer)),
            );
        }
    }
}

const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const AnyBeaconBlock = @import("fork_types").AnyBeaconBlock;

test "process operations" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var electra_block = ct.electra.BeaconBlock.default_value;
    const beacon_block = AnyBeaconBlock{ .full_electra = &electra_block };

    try processOperations(
        .electra,
        allocator,
        std.testing.io,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        try test_state.cached_state.state.tryCastToFork(.electra),
        &test_state.cached_state.proposer_rewards,
        &test_state.cached_state.slashings_cache,
        .full,
        beacon_block.beaconBlockBody().castToFork(.full, .electra),
        .{},
    );
}
