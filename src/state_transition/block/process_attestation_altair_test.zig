//! Tests for `process_attestation_altair.zig`.

const std = @import("std");
const ct = @import("consensus_types");
const c = @import("constants");
const config = @import("config");
const preset = @import("preset").preset;
const active_preset = @import("preset").active_preset;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const generateElectraState = @import("../test_utils/generate_state.zig").generateElectraState;
const state_transition = @import("../root.zig");
const getBlockRootAtSlot = state_transition.getBlockRootAtSlot;
const altair = @import("process_attestation_altair.zig");
const MAX_AGGREGATION_BITS = @import("process_attestation_phase0.zig").MAX_AGGREGATION_BITS;

test "memory_safety: processAttestationsAltair should cap its buffer for oversized Gloas bits" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 850_000,
    });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const cached = test_state.cached_state;

    // No generated Gloas fixture; the path to the length check reads only slot and checkpoints.
    var any_state = try AnyBeaconState.fromValue(
        allocator,
        &pool,
        .gloas,
        &ct.gloas.BeaconState.default_value,
    );
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    const attestation_slot = cached.epoch_cache.epoch * preset.SLOTS_PER_EPOCH;
    try state.setSlot(attestation_slot + preset.MIN_ATTESTATION_INCLUSION_DELAY);

    const bit_len = 16 * MAX_AGGREGATION_BITS;
    var attestation: ct.gloas.Attestation.Type = .{
        .aggregation_bits = try .fromBitLen(allocator, bit_len),
        .data = std.mem.zeroes(ct.gloas.AttestationData.Type),
        .signature = std.mem.zeroes(ct.primitive.BLSSignature.Type),
        .committee_bits = .empty,
    };
    defer attestation.aggregation_bits.deinit(allocator);
    attestation.data.slot = attestation_slot;
    attestation.data.target.epoch = cached.epoch_cache.epoch;
    try attestation.committee_bits.set(0, true);

    var counting = std.testing.FailingAllocator.init(allocator, .{});
    const result = altair.processAttestationsAltair(
        .gloas,
        counting.allocator(),
        std.testing.io,
        cached.config,
        cached.epoch_cache,
        state,
        &cached.proposer_rewards,
        &cached.slashings_cache,
        &.{attestation},
        null,
        false,
    );
    try std.testing.expectError(error.InvalidAttestationAggregationBitsTooLong, result);
    const byte_limit = 2 * MAX_AGGREGATION_BITS * @sizeOf(ct.primitive.ValidatorIndex.Type);
    try std.testing.expect(counting.allocated_bytes < byte_limit);
}

test "processAttestationsAltair should set Gloas participation past the unfolded chunks" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 850_000,
    });
    defer pool.deinit();

    // Gloas participation keeps its first 21 chunks (672 validators) unfolded, and each chunked
    // leaf after them holds 64 chunks (2048 validators), so 4096 validators reach the second leaf.
    const validator_count = 4096;
    const second_leaf_start = (21 + 64) * 32;
    const chain_config = if (active_preset == .mainnet)
        config.mainnet.chain_config
    else
        config.minimal.chain_config;
    const electra_state = try generateElectraState(allocator, &pool, chain_config, validator_count);
    var test_state = blk: {
        errdefer {
            electra_state.deinit();
            allocator.destroy(electra_state);
        }
        var fork_view = try electra_state.fork();
        const next_epoch = (try electra_state.slot()) / preset.SLOTS_PER_EPOCH + 1;
        break :blk try TestCachedBeaconState.initFromStateWithConfig(
            allocator,
            &pool,
            electra_state,
            .electra,
            try fork_view.get("epoch"),
            .{ .FULU_FORK_EPOCH = next_epoch, .GLOAS_FORK_EPOCH = next_epoch },
        );
    };
    defer test_state.deinit();
    const cached = test_state.cached_state;

    const gloas_epoch = cached.config.chain.GLOAS_FORK_EPOCH;
    const epoch_start_slot = gloas_epoch * preset.SLOTS_PER_EPOCH;
    const attestation_slot = epoch_start_slot + 1;
    try state_transition.processSlots(
        allocator,
        std.testing.io,
        cached,
        attestation_slot + preset.MIN_ATTESTATION_INCLUSION_DELAY,
        null,
    );
    const state = try cached.state.tryCastToFork(.gloas);

    var source: ct.phase0.Checkpoint.Type = undefined;
    try cached.state.currentJustifiedCheckpoint(&source);
    var attestation: ct.gloas.Attestation.Type = .{
        .aggregation_bits = .empty,
        .data = .{
            .slot = attestation_slot,
            .index = 0,
            .beacon_block_root = (try getBlockRootAtSlot(.gloas, state, attestation_slot)).*,
            .source = source,
            .target = .{
                .epoch = gloas_epoch,
                .root = (try getBlockRootAtSlot(.gloas, state, epoch_start_slot)).*,
            },
        },
        .signature = std.mem.zeroes(ct.primitive.BLSSignature.Type),
        .committee_bits = .empty,
    };
    defer attestation.aggregation_bits.deinit(allocator);
    var is_attester: [validator_count]bool = @splat(false);
    const epoch_cache = cached.epoch_cache;
    for (0..try epoch_cache.getCommitteeCountPerSlot(gloas_epoch)) |committee_index| {
        try attestation.committee_bits.set(committee_index, true);
        const committee = try epoch_cache.getBeaconCommittee(attestation_slot, committee_index);
        for (committee) |validator_index| {
            const bit_len = attestation.aggregation_bits.bit_len;
            try attestation.aggregation_bits.set(allocator, bit_len, true);
            is_attester[validator_index] = true;
        }
    }
    const late_attester = std.mem.indexOfScalar(bool, is_attester[second_leaf_start..], true);
    try std.testing.expect(late_attester != null);

    // A clone shares participation nodes, so editing the state must leave the clone unchanged.
    var original = try cached.state.clone(.{ .transfer_cache = false });
    defer original.deinit();

    try altair.processAttestationsAltair(
        .gloas,
        allocator,
        std.testing.io,
        cached.config,
        cached.epoch_cache,
        state,
        &cached.proposer_rewards,
        &cached.slashings_cache,
        &.{attestation},
        null,
        false,
    );
    try cached.state.commit();

    const participation = try state.currentEpochParticipation();
    const values = try participation.getAll(allocator);
    defer allocator.free(values);
    const first_attester = std.mem.indexOfScalar(bool, &is_attester, true).?;
    const flags = values[first_attester];
    const source_and_target = (1 << c.TIMELY_SOURCE_FLAG_INDEX) | (1 << c.TIMELY_TARGET_FLAG_INDEX);
    try std.testing.expectEqual(source_and_target, flags & source_and_target);
    var expected: ct.gloas.EpochParticipation.Type = .empty;
    defer expected.deinit(allocator);
    for (is_attester) |attester| try expected.append(allocator, if (attester) flags else 0);
    try std.testing.expectEqualSlices(u8, expected.items, values);
    var expected_root: [32]u8 = undefined;
    try ct.gloas.EpochParticipation.hashTreeRoot(allocator, &expected, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, try participation.hashTreeRoot());

    const original_participation = try original.castToFork(.gloas).currentEpochParticipation();
    const original_values = try original_participation.getAll(allocator);
    defer allocator.free(original_values);
    for (original_values) |value| try std.testing.expectEqual(@as(u8, 0), value);
}
