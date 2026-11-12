//! Aggregate public keys of the beacon committees of one epoch shuffling.
//!
//! An attestation signature covers the participants of whole committees, and
//! on mainnet nearly every member participates. Starting from the committee
//! aggregate and subtracting the absent members takes far fewer point additions
//! than summing the participants. Each aggregate is computed once per shuffling.

const std = @import("std");
const bls = @import("bls");
const preset = @import("preset").preset;
const PubkeyCache = @import("pubkey_cache.zig").PubkeyCache;

pub const Participants = struct {
    public_key: bls.PublicKey,
    count: usize,
};

pub const CommitteePubkeys = struct {
    allocator: std.mem.Allocator,
    committees_per_slot: u32,
    /// Shuffled active validator indices. Committees split it as in the spec's
    /// `compute_committee`.
    shuffling: []const u32,
    /// One aggregate per committee, indexed by `slot * committees_per_slot + index`.
    aggregates: []bls.AggregatePublicKey,

    /// `aggregate_storage` must remain allocated and unmoved for the lifetime
    /// of the returned value. The value does not own that storage.
    /// Takes ownership of `shuffling` on success; on error the caller still owns it.
    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        pubkey_cache: *const PubkeyCache,
        shuffling: []const u32,
        committees_per_slot: u32,
        aggregate_storage: []bls.AggregatePublicKey,
    ) !CommitteePubkeys {
        if (committees_per_slot == 0 or committees_per_slot > preset.MAX_COMMITTEES_PER_SLOT) {
            return error.InvalidCommitteesPerSlot;
        }

        const aggregate_count = preset.SLOTS_PER_EPOCH * committees_per_slot;
        if (aggregate_storage.len < aggregate_count) return error.AggregateStorageTooSmall;
        const aggregates = aggregate_storage[0..aggregate_count];

        var self: CommitteePubkeys = .{
            .allocator = allocator,
            .committees_per_slot = committees_per_slot,
            .shuffling = shuffling,
            .aggregates = aggregates,
        };
        for (aggregates, 0..) |*aggregate, i| {
            aggregate.* = .{};
            try pubkey_cache.sumIndices(io, self.committee(i), aggregate);
        }
        return self;
    }

    pub fn deinit(self: *CommitteePubkeys) void {
        self.allocator.free(self.shuffling);
        self.* = undefined;
    }

    /// Members of the committee at `slot * committees_per_slot + index`.
    pub fn committee(self: *const CommitteePubkeys, global_index: usize) []const u32 {
        const count: u64 = self.aggregates.len;
        std.debug.assert(global_index < count);
        const len: u64 = self.shuffling.len;
        const start: usize = @intCast(len * global_index / count);
        const end: usize = @intCast(len * (global_index + 1) / count);
        return self.shuffling[start..end];
    }

    /// Aggregate the participants of an attestation in the committees
    /// `committee_indices` of `slot_in_epoch`. Their aggregation bits are
    /// concatenated in that order, as in an Electra attestation.
    pub fn aggregateParticipants(
        self: *const CommitteePubkeys,
        io: std.Io,
        pubkey_cache: *const PubkeyCache,
        slot_in_epoch: u64,
        committee_indices: []const u32,
        bits: []const u8,
        bit_len: usize,
    ) !Participants {
        if (slot_in_epoch >= preset.SLOTS_PER_EPOCH) return error.InvalidSlot;
        if (committee_indices.len == 0) return error.EmptyCommitteeIndices;
        if (bit_len > bits.len * 8) return error.InvalidBitLength;

        var sum: bls.AggregatePublicKey = .{};
        var participants: usize = 0;
        var bit_offset: usize = 0;
        for (committee_indices, 0..) |committee_index, i| {
            if (committee_index >= self.committees_per_slot) return error.InvalidCommitteeIndex;
            if (i > 0 and committee_index <= committee_indices[i - 1]) return error.UnsortedCommitteeIndices;

            const global_index: usize = @intCast(slot_in_epoch * self.committees_per_slot + committee_index);
            const members = self.committee(global_index);
            if (bit_offset + members.len > bit_len) return error.InvalidBitLength;

            const present = countSetBits(bits, bit_offset, members.len);
            const absent = members.len - present;
            // Subtracting costs the absent members plus two point additions.
            if (present > 0 and absent + 2 < present) {
                var absent_sum: bls.AggregatePublicKey = .{};
                try pubkey_cache.sumMembersByBit(io, members, bits, bit_offset, false, &absent_sum);
                sum.addAggregate(&self.aggregates[global_index]);
                sum.subtractAggregate(&absent_sum);
            } else if (present > 0) {
                try pubkey_cache.sumMembersByBit(io, members, bits, bit_offset, true, &sum);
            }

            participants += present;
            bit_offset += members.len;
        }
        if (bit_offset != bit_len) return error.InvalidBitLength;
        if (participants == 0) return error.EmptyIndices;

        return .{ .public_key = sum.toPublicKey(), .count = participants };
    }
};

fn countSetBits(bits: []const u8, bit_offset: usize, len: usize) usize {
    var count: usize = 0;
    for (bit_offset..bit_offset + len) |bit| {
        count += (bits[bit / 8] >> @intCast(bit % 8)) & 1;
    }
    return count;
}

test {
    _ = @import("committee_pubkeys_test.zig");
}
