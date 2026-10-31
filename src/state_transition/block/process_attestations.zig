const std = @import("std");
const Allocator = std.mem.Allocator;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const types = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const SlashingsCache = @import("../cache/slashings_cache.zig").SlashingsCache;
const buildSlashingsCacheIfNeeded = @import("../cache/slashings_cache.zig").buildFromStateIfNeeded;
const processAttestationPhase0 = @import("./process_attestation_phase0.zig").processAttestationPhase0;
const Node = @import("persistent_merkle_tree").Node;
const preset = @import("preset").preset;
const processAttestationsAltair = @import("./process_attestation_altair.zig").processAttestationsAltair;

pub fn processAttestations(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    proposer_rewards: *ProposerRewards,
    slashings_cache: *SlashingsCache,
    attestations: []const ForkTypes(fork).Attestation.Type,
    parent_slot: ?u64,
    verify_signatures: bool,
) !void {
    if (comptime fork.gte(.gloas)) {
        if (attestations.len > preset.MAX_ATTESTATIONS_ELECTRA) return error.TooManyBlockOperations;
    }
    try buildSlashingsCacheIfNeeded(allocator, state, slashings_cache);
    if (comptime fork == .phase0) {
        for (attestations) |attestation| {
            try processAttestationPhase0(
                allocator,
                io,
                config,
                epoch_cache,
                state,
                &attestation,
                verify_signatures,
            );
        }
    } else {
        try processAttestationsAltair(
            fork,
            allocator,
            io,
            config,
            epoch_cache,
            state,
            proposer_rewards,
            slashings_cache,
            attestations,
            parent_slot,
            verify_signatures,
        );
    }
}

test "process attestations - sanity" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 16);
    defer test_state.deinit();

    var electra: std.ArrayList(types.electra.Attestation.Type) = .empty;
    const attestation = types.electra.Attestation.default_value;
    try electra.append(allocator, attestation);
    try std.testing.expectError(
        error.EpochShufflingNotFound,
        processAttestations(
            .electra,
            allocator,
            std.testing.io,
            test_state.cached_state.config,
            test_state.cached_state.epoch_cache,
            test_state.cached_state.state.castToFork(.electra),
            &test_state.cached_state.proposer_rewards,
            &test_state.cached_state.slashings_cache,
            electra.items,
            null,
            true,
        ),
    );
    electra.deinit(allocator);
}
