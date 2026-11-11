//! Tests for `process_attestation_altair.zig`.

const std = @import("std");
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
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
