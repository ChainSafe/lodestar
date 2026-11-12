//! Tests for `process_attestation_phase0.zig`.

const std = @import("std");
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const validateAttestation = @import("process_attestation_phase0.zig").validateAttestation;

test "validateAttestation should require a set bit in every selected committee" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 500_000,
    });
    defer pool.deinit();

    // The smallest active set that splits every slot into two committees.
    const committee_size = preset.TARGET_COMMITTEE_SIZE;
    var test_state = try TestCachedBeaconState.init(
        allocator,
        &pool,
        2 * committee_size * preset.SLOTS_PER_EPOCH,
    );
    defer test_state.deinit();

    const cached = test_state.cached_state;
    const state = cached.state.castToFork(.electra);

    var attestation: ct.electra.Attestation.Type = .{
        .aggregation_bits = try .fromBitLen(allocator, 2 * committee_size),
        .data = std.mem.zeroes(ct.phase0.AttestationData.Type),
        .signature = std.mem.zeroes(ct.primitive.BLSSignature.Type),
        .committee_bits = .empty,
    };
    defer attestation.aggregation_bits.deinit(allocator);

    attestation.data.slot = cached.epoch_cache.epoch * preset.SLOTS_PER_EPOCH;
    attestation.data.target.epoch = cached.epoch_cache.epoch;
    try attestation.committee_bits.set(0, true);
    try attestation.committee_bits.set(1, true);

    const first = try cached.epoch_cache.getBeaconCommittee(attestation.data.slot, 0);
    const second = try cached.epoch_cache.getBeaconCommittee(attestation.data.slot, 1);
    try std.testing.expectEqual(@as(usize, committee_size), first.len);
    try std.testing.expectEqual(@as(usize, committee_size), second.len);

    try attestation.aggregation_bits.set(allocator, committee_size, true);
    try std.testing.expectError(
        error.InvalidAttestationCommitteeAggregationBitsAllFalse,
        validateAttestation(.electra, cached.epoch_cache, state, &attestation),
    );

    try attestation.aggregation_bits.set(allocator, committee_size, false);
    try attestation.aggregation_bits.set(allocator, 0, true);
    try std.testing.expectError(
        error.InvalidAttestationCommitteeAggregationBitsAllFalse,
        validateAttestation(.electra, cached.epoch_cache, state, &attestation),
    );

    try attestation.aggregation_bits.set(allocator, committee_size, true);
    try validateAttestation(.electra, cached.epoch_cache, state, &attestation);
}
