const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const Sha256 = std.crypto.hash.sha2.Sha256;
const Epoch = types.primitive.Epoch.Type;
const DomainType = types.primitive.DomainType.Type;
const c = @import("constants");
const EPOCHS_PER_HISTORICAL_VECTOR = preset.EPOCHS_PER_HISTORICAL_VECTOR;
const MIN_SEED_LOOKAHEAD = preset.MIN_SEED_LOOKAHEAD;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const EffectiveBalanceIncrements = @import("../cache/effective_balance_increments.zig").EffectiveBalanceIncrements;
const computeStartSlotAtEpoch = @import("./epoch.zig").computeStartSlotAtEpoch;
const ComputeIndexUtils = @import("./committee_indices.zig");
const computeProposerIndex = ComputeIndexUtils.computeProposerIndex;
const computeSyncCommitteeIndices = ComputeIndexUtils.computeSyncCommitteeIndices;
const computeEpochAtSlot = @import("./epoch.zig").computeEpochAtSlot;
const ByteCount = @import("./committee_indices.zig").ByteCount;
const EpochShuffling = @import("./epoch_shuffling.zig").EpochShuffling;
const computePtcIndicesInto = @import("swap_or_not_shuffle").computePtcIndicesInto;
const computeSyncCommitteeIndicesInto = @import("swap_or_not_shuffle").computeSyncCommitteeIndicesInto;

pub fn computeProposers(
    comptime fork_seq: ForkSeq,
    allocator: Allocator,
    epoch_seed: [32]u8,
    epoch: Epoch,
    active_indices: []const u32,
    effective_balance_increments: EffectiveBalanceIncrements,
    out: []ValidatorIndex,
) !void {
    const start_slot = computeStartSlotAtEpoch(epoch);
    for (start_slot..start_slot + preset.SLOTS_PER_EPOCH, 0..) |slot, i| {
        // epoch_seed is 32 bytes, slot is 8 bytes
        var buffer: [40]u8 = [_]u8{0} ** (32 + 8);
        @memcpy(buffer[0..32], epoch_seed[0..]);
        std.mem.writeInt(u64, buffer[32..][0..8], slot, .little);

        var seed: [32]u8 = undefined;
        Sha256.hash(buffer[0..], &seed, .{});

        const rand_byte_count: ByteCount = if (comptime fork_seq.gte(.electra)) ByteCount.Two else ByteCount.One;
        const max_effective_balance: u64 = if (comptime fork_seq.gte(.electra)) preset.MAX_EFFECTIVE_BALANCE_ELECTRA else preset.MAX_EFFECTIVE_BALANCE;
        out[i] = try computeProposerIndex(
            allocator,
            &seed,
            active_indices,
            effective_balance_increments.items,
            rand_byte_count,
            max_effective_balance,
            preset.EFFECTIVE_BALANCE_INCREMENT,
            preset.SHUFFLE_ROUND_COUNT,
        );
    }
}

test "computeProposers - sanity" {
    const allocator = std.testing.allocator;
    const epoch_seed: [32]u8 = [_]u8{0} ** 32;
    var active_indices: [5]u32 = .{ 0, 1, 2, 3, 4 };
    var effective_balance_increments: EffectiveBalanceIncrements = .empty;
    defer effective_balance_increments.deinit(allocator);
    for (0..active_indices.len) |_| {
        try effective_balance_increments.append(allocator, 32);
    }
    var out: [preset.SLOTS_PER_EPOCH]ValidatorIndex = undefined;

    try computeProposers(ForkSeq.phase0, allocator, epoch_seed, 0, active_indices[0..], effective_balance_increments, &out);
    try computeProposers(ForkSeq.electra, allocator, epoch_seed, 0, active_indices[0..], effective_balance_increments, &out);
}

pub fn getNextSyncCommitteeIndices(comptime fork: ForkSeq, allocator: Allocator, state: *BeaconState(fork), active_indices: []const u32, effective_balance_increments: EffectiveBalanceIncrements, out: *[preset.SYNC_COMMITTEE_SIZE]ValidatorIndex) !void {
    const epoch = computeEpochAtSlot(try state.slot()) + 1;
    var seed: [32]u8 = undefined;
    try getSeed(fork, state, epoch, c.DOMAIN_SYNC_COMMITTEE, &seed);
    if (comptime fork.gte(.electra)) {
        var indices: [preset.SYNC_COMMITTEE_SIZE]u32 = undefined;
        try computeSyncCommitteeIndicesInto(
            allocator,
            &seed,
            active_indices,
            effective_balance_increments.items,
            .two,
            preset.MAX_EFFECTIVE_BALANCE_ELECTRA,
            preset.EFFECTIVE_BALANCE_INCREMENT,
            preset.SHUFFLE_ROUND_COUNT,
            &indices,
        );
        for (indices, out) |index, *dest| dest.* = index;
    } else {
        try computeSyncCommitteeIndices(
            allocator,
            &seed,
            active_indices,
            effective_balance_increments.items,
            ByteCount.One,
            preset.MAX_EFFECTIVE_BALANCE,
            preset.EFFECTIVE_BALANCE_INCREMENT,
            preset.SHUFFLE_ROUND_COUNT,
            out,
        );
    }
}

pub fn getRandaoMix(comptime fork: ForkSeq, state: *BeaconState(fork), epoch: Epoch) !*const [32]u8 {
    var randao_mixes = try state.randaoMixes();
    return try randao_mixes.getFieldRoot(epoch % EPOCHS_PER_HISTORICAL_VECTOR);
}

pub fn getSeed(comptime fork: ForkSeq, state: *BeaconState(fork), epoch: Epoch, domain_type: DomainType, out: *[32]u8) !void {
    const mix = try getRandaoMix(fork, state, epoch + EPOCHS_PER_HISTORICAL_VECTOR - MIN_SEED_LOOKAHEAD - 1);
    var epoch_buf: [8]u8 = undefined;
    std.mem.writeInt(u64, &epoch_buf, epoch, .little);
    var buffer = [_]u8{0} ** (types.primitive.DomainType.length + 8 + types.primitive.Bytes32.length);
    std.mem.copyForwards(u8, buffer[0..domain_type.len], domain_type[0..]);
    std.mem.copyForwards(u8, buffer[domain_type.len..(domain_type.len + 8)], epoch_buf[0..]);
    std.mem.copyForwards(u8, buffer[(domain_type.len + 8)..], mix[0..]);
    Sha256.hash(buffer[0..], out, .{});
}

pub fn computePayloadTimelinessCommitteesForEpoch(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    epoch: Epoch,
    shuffling: *const EpochShuffling,
    effective_balance_increments: []const u16,
) ![preset.SLOTS_PER_EPOCH][preset.PTC_SIZE]ValidatorIndex {
    var epoch_seed: [32]u8 = undefined;
    try getSeed(fork, state, epoch, c.DOMAIN_PTC_ATTESTER, &epoch_seed);
    const start_slot = computeStartSlotAtEpoch(epoch);
    var seed_input: [40]u8 = undefined;
    @memcpy(seed_input[0..32], &epoch_seed);
    var result: [preset.SLOTS_PER_EPOCH][preset.PTC_SIZE]ValidatorIndex = undefined;
    for (0..preset.SLOTS_PER_EPOCH) |slot_offset| {
        std.mem.writeInt(u64, seed_input[32..][0..8], start_slot + slot_offset, .little);
        var seed: [32]u8 = undefined;
        Sha256.hash(&seed_input, &seed, .{});
        // EpochShuffling partitions one contiguous array, so the slot slice needs no copy.
        const start = shuffling.shuffling.len * slot_offset / preset.SLOTS_PER_EPOCH;
        const end = shuffling.shuffling.len * (slot_offset + 1) / preset.SLOTS_PER_EPOCH;
        var committee: [preset.PTC_SIZE]u32 = undefined;
        try computePtcIndicesInto(
            &seed,
            shuffling.shuffling[start..end],
            effective_balance_increments,
            preset.MAX_EFFECTIVE_BALANCE_ELECTRA,
            preset.EFFECTIVE_BALANCE_INCREMENT,
            &committee,
        );
        for (committee, &result[slot_offset]) |index, *dest| dest.* = index;
    }
    return result;
}
