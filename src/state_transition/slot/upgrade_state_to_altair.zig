const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const getNextSyncCommittee = @import("../utils/sync_committee.zig").getNextSyncCommittee;
const SyncCommitteeInfo = @import("../utils/sync_committee.zig").SyncCommitteeInfo;
const sumTargetUnslashedBalanceIncrements = @import("../utils/target_unslashed_balance.zig").sumTargetUnslashedBalanceIncrements;
const computePreviousEpoch = @import("../utils/epoch.zig").computePreviousEpoch;
const types = @import("consensus_types");
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const RootCache = @import("../cache/root_cache.zig").RootCache;
const getAttestationParticipationStatus = @import("../block//process_attestation_altair.zig").getAttestationParticipationStatus;

pub fn upgradeStateToAltair(
    allocator: Allocator,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    phase0_state: *BeaconState(.phase0),
) !BeaconState(.altair) {
    var altair_state = try phase0_state.upgradeUnsafe();
    errdefer altair_state.deinit();

    const new_fork: types.altair.Fork.Type = .{
        .previous_version = try phase0_state.forkCurrentVersion(),
        .current_version = config.chain.ALTAIR_FORK_VERSION,
        .epoch = epoch_cache.epoch,
    };

    try altair_state.setFork(&new_fork);

    const validators_count = try altair_state.validatorsCount();
    var previous_epoch_participations = try altair_state.previousEpochParticipation();
    try previous_epoch_participations.growTo(validators_count);

    var current_epoch_participations = try altair_state.currentEpochParticipation();
    try current_epoch_participations.growTo(validators_count);

    var inactivity_scores = try altair_state.inactivityScores();
    try inactivity_scores.growTo(validators_count);

    const active_indices = epoch_cache.next_shuffling.get().active_indices;

    var sync_committee_info: SyncCommitteeInfo = undefined;
    try getNextSyncCommittee(.altair, allocator, &altair_state, active_indices, epoch_cache.getEffectiveBalanceIncrements(), &sync_committee_info);

    try altair_state.setCurrentSyncCommittee(&sync_committee_info.sync_committee);
    try altair_state.setNextSyncCommittee(&sync_committee_info.sync_committee);

    try epoch_cache.setSyncCommitteesIndexed(&sync_committee_info.indices);

    const root_cache = try RootCache(.phase0).init(allocator, phase0_state);
    defer root_cache.deinit();

    var previous_epoch_participation = try translateParticipation(
        allocator,
        epoch_cache,
        root_cache,
        validators_count,
        try phase0_state.previousEpochPendingAttestations(),
    );
    defer previous_epoch_participation.deinit(allocator);
    try altair_state.setPreviousEpochParticipation(&previous_epoch_participation);

    var current_epoch_participation = try translateParticipation(
        allocator,
        epoch_cache,
        root_cache,
        validators_count,
        try phase0_state.currentEpochPendingAttestations(),
    );
    defer current_epoch_participation.deinit(allocator);
    try altair_state.setCurrentEpochParticipation(&current_epoch_participation);

    const previous_epoch = computePreviousEpoch(epoch_cache.epoch);
    try altair_state.commit();
    const validators = try altair_state.validatorsPtrSlice(allocator);
    defer allocator.free(validators);
    epoch_cache.previous_target_unslashed_balance_increments = sumTargetUnslashedBalanceIncrements(previous_epoch_participation.items, previous_epoch, validators);
    epoch_cache.current_target_unslashed_balance_increments = sumTargetUnslashedBalanceIncrements(current_epoch_participation.items, epoch_cache.epoch, validators);

    phase0_state.deinit();
    return altair_state;
}

/// Translate_participation in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/fork.md
/// Caller must free returned value
fn translateParticipation(
    allocator: Allocator,
    epoch_cache: *const EpochCache,
    root_cache: *RootCache(.phase0),
    validators_count: usize,
    pending_attestations_tree: *types.phase0.EpochAttestations.TreeView,
) !types.altair.EpochParticipation.Type {
    const pending_attestations = try pending_attestations_tree.getAllReadonlyValues(allocator);
    defer {
        for (pending_attestations) |*attestation| {
            types.phase0.PendingAttestation.deinit(allocator, attestation);
        }
        allocator.free(pending_attestations);
    }

    // translate all participations into a flat array, then convert to tree view the end
    var epoch_participation = types.altair.EpochParticipation.default_value;
    errdefer epoch_participation.deinit(allocator);

    try epoch_participation.resize(allocator, validators_count);
    @memset(epoch_participation.items, 0);

    for (pending_attestations) |*attestation| {
        const data = &attestation.data;
        const attestation_flag = try getAttestationParticipationStatus(.phase0, data, attestation.inclusion_delay, epoch_cache.epoch, root_cache, null);
        const committee_indices = try epoch_cache.getBeaconCommittee(data.slot, data.index);
        var attesting_indices = try attestation.aggregation_bits.intersectValues(ValidatorIndex, u32, allocator, committee_indices);
        defer attesting_indices.deinit(allocator);
        for (attesting_indices.items) |validator_index| {
            epoch_participation.items[validator_index] |= attestation_flag;
        }
    }

    return epoch_participation;
}

test "memory_safety: translateParticipation should release participation on allocation failure" {
    const allocator = std.testing.allocator;
    const preset = @import("preset").preset;
    const constants = @import("constants");
    const Node = @import("persistent_merkle_tree").Node;
    const AnyBeaconState = @import("fork_types").AnyBeaconState;
    const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
    const validator_count = 2 * preset.SLOTS_PER_EPOCH;

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var state: AnyBeaconState = .{ .phase0 = try types.phase0.BeaconState.TreeView.fromValue(allocator, &pool, &types.phase0.BeaconState.default_value) };
    defer state.deinit();
    try state.setSlot(preset.SLOTS_PER_EPOCH);
    var validators = try state.validators();
    var validator = types.phase0.Validator.default_value;
    validator.effective_balance = preset.MAX_EFFECTIVE_BALANCE;
    validator.exit_epoch = constants.FAR_FUTURE_EPOCH;
    validator.withdrawable_epoch = constants.FAR_FUTURE_EPOCH;
    for (0..validator_count) |_| try validators.pushValue(&validator);

    var pubkeys = try PubkeyCache.initCapacity(allocator, std.testing.io, 0);
    defer pubkeys.deinit();
    const chain_config = if (@import("preset").active_preset == .mainnet) @import("config").mainnet.chain_config else @import("config").minimal.chain_config;
    var config = BeaconConfig.init(chain_config, .{0} ** 32);
    const epoch_cache = try EpochCache.createFromState(allocator, std.testing.io, &state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer epoch_cache.deinit();

    var attestation = types.phase0.PendingAttestation.default_value;
    defer types.phase0.PendingAttestation.deinit(allocator, &attestation);
    attestation.inclusion_delay = preset.MIN_ATTESTATION_INCLUSION_DELAY;
    const committee = try epoch_cache.getBeaconCommittee(0, 0);
    try attestation.aggregation_bits.resize(allocator, committee.len);
    for (0..committee.len) |i| try attestation.aggregation_bits.set(allocator, i, true);
    var pending = try state.previousEpochPendingAttestations();
    try pending.pushValue(&attestation);
    try state.commit();

    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(failing_allocator: Allocator, cache: *EpochCache, source: *AnyBeaconState, count: usize, participants: []const u32) !void {
            const roots = try RootCache(.phase0).init(failing_allocator, source.castToFork(.phase0));
            defer roots.deinit();

            var participation = try translateParticipation(failing_allocator, cache, roots, count, try source.previousEpochPendingAttestations());
            defer participation.deinit(failing_allocator);

            try std.testing.expectEqual(count, participation.items.len);
            for (participation.items, 0..) |flags, i| {
                const expected: u8 = if (std.mem.findScalar(u32, participants, @intCast(i)) != null)
                    (1 << constants.TIMELY_SOURCE_FLAG_INDEX) | (1 << constants.TIMELY_TARGET_FLAG_INDEX) | (1 << constants.TIMELY_HEAD_FLAG_INDEX)
                else
                    0;
                try std.testing.expectEqual(expected, flags);
            }
        }
    }.run, .{ epoch_cache, &state, validator_count, committee });
}
