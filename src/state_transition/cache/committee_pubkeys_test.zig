const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const bls = @import("bls");
const Validator = types.phase0.Validator.Type;
const PubkeyCache = @import("pubkey_cache.zig").PubkeyCache;
const CommitteePubkeys = @import("committee_pubkeys.zig").CommitteePubkeys;
const testing = std.testing;
const interop = @import("../test_utils/interop_pubkeys.zig");

const committees_per_slot = 2;
const members_per_committee = 12;
const validator_count = preset.SLOTS_PER_EPOCH * committees_per_slot * members_per_committee;

const Fixture = struct {
    cache: PubkeyCache,
    committees: CommitteePubkeys,
    aggregate_storage: []bls.AggregatePublicKey,

    fn init() !Fixture {
        var pubkeys: [validator_count]types.primitive.BLSPubkey.Type = undefined;
        try interop.interopPubkeysCached(validator_count, &pubkeys);

        var validators: [validator_count]Validator = undefined;
        var validator_ptrs: [validator_count]*const Validator = undefined;
        for (pubkeys, &validators, &validator_ptrs) |pubkey, *validator, *validator_ptr| {
            validator.* = std.mem.zeroes(Validator);
            validator.pubkey = pubkey;
            validator_ptr.* = validator;
        }

        var cache = PubkeyCache.init(testing.allocator, testing.io);
        errdefer cache.deinit();
        try cache.syncPubkeys(testing.io, &validator_ptrs);

        // Any permutation works; reversing keeps committee members away from their index order.
        const shuffling = try testing.allocator.alloc(u32, validator_count);
        errdefer testing.allocator.free(shuffling);
        for (shuffling, 0..) |*index, i| index.* = @intCast(validator_count - 1 - i);

        const aggregate_storage = try testing.allocator.alloc(
            bls.AggregatePublicKey,
            preset.SLOTS_PER_EPOCH * preset.MAX_COMMITTEES_PER_SLOT,
        );
        errdefer testing.allocator.free(aggregate_storage);
        const committees = try CommitteePubkeys.init(
            testing.allocator,
            testing.io,
            &cache,
            shuffling,
            committees_per_slot,
            aggregate_storage,
        );
        return .{ .cache = cache, .committees = committees, .aggregate_storage = aggregate_storage };
    }

    fn deinit(self: *Fixture) void {
        self.committees.deinit();
        testing.allocator.free(self.aggregate_storage);
        self.cache.deinit();
    }

    /// Reference result: sum the participants one by one.
    fn expectMatchesParticipants(
        self: *const Fixture,
        slot: u64,
        committee_indices: []const u32,
        bits: []const u8,
        bit_len: usize,
    ) !void {
        var participants: std.ArrayList(u32) = .empty;
        defer participants.deinit(testing.allocator);
        var bit: usize = 0;
        for (committee_indices) |committee_index| {
            const members = self.committees.committee(@intCast(slot * committees_per_slot + committee_index));
            for (members) |member| {
                if ((bits[bit / 8] >> @intCast(bit % 8)) & 1 == 1) try participants.append(testing.allocator, member);
                bit += 1;
            }
        }

        const result = try self.committees.aggregateParticipants(
            testing.io,
            &self.cache,
            slot,
            committee_indices,
            bits,
            bit_len,
        );
        const expected = try self.cache.aggregateIndices(testing.io, u32, participants.items);
        try testing.expectEqual(participants.items.len, result.count);
        try testing.expect(expected.isEqual(&result.public_key));
    }
};

fn setBits(bits: []u8, random: std.Random, bit_len: usize, participation_percent: u8) void {
    @memset(bits, 0);
    for (0..bit_len) |bit| {
        if (random.uintLessThan(u8, 100) < participation_percent) bits[bit / 8] |= @as(u8, 1) << @intCast(bit % 8);
    }
}

test "committees split the shuffling like compute_committee" {
    var fixture = try Fixture.init();
    defer fixture.deinit();

    var next: u32 = validator_count;
    for (0..preset.SLOTS_PER_EPOCH * committees_per_slot) |i| {
        const members = fixture.committees.committee(i);
        try testing.expectEqual(@as(usize, members_per_committee), members.len);
        for (members) |member| {
            next -= 1;
            try testing.expectEqual(next, member);
        }
    }
}

test "aggregateParticipants matches summing the participants" {
    var fixture = try Fixture.init();
    defer fixture.deinit();

    var prng = std.Random.DefaultPrng.init(0x5eed);
    const random = prng.random();
    var bits: [(committees_per_slot * members_per_committee + 7) / 8]u8 = undefined;

    // Full and high participation take the subtraction path, low participation adds members.
    for ([_]u8{ 100, 95, 75, 50, 10 }) |participation_percent| {
        for (0..preset.SLOTS_PER_EPOCH) |slot| {
            for ([_][]const u32{ &.{0}, &.{1}, &.{ 0, 1 } }) |committee_indices| {
                const bit_len = committee_indices.len * members_per_committee;
                setBits(&bits, random, bit_len, participation_percent);
                if (std.mem.allEqual(u8, &bits, 0)) bits[0] = 1;
                try fixture.expectMatchesParticipants(slot, committee_indices, &bits, bit_len);
            }
        }
    }
}

test "aggregateParticipants rejects inconsistent input" {
    var fixture = try Fixture.init();
    defer fixture.deinit();

    const bits = [_]u8{0xff} ** 3;
    const f = &fixture.committees;
    const cache = &fixture.cache;
    const io = testing.io;
    const one = members_per_committee;

    try testing.expectError(error.InvalidSlot, f.aggregateParticipants(io, cache, preset.SLOTS_PER_EPOCH, &.{0}, &bits, one));
    try testing.expectError(error.EmptyCommitteeIndices, f.aggregateParticipants(io, cache, 0, &.{}, &bits, 0));
    try testing.expectError(error.InvalidCommitteeIndex, f.aggregateParticipants(io, cache, 0, &.{committees_per_slot}, &bits, one));
    try testing.expectError(error.UnsortedCommitteeIndices, f.aggregateParticipants(io, cache, 0, &.{ 1, 0 }, &bits, 2 * one));
    try testing.expectError(error.InvalidBitLength, f.aggregateParticipants(io, cache, 0, &.{0}, &bits, one - 1));
    try testing.expectError(error.InvalidBitLength, f.aggregateParticipants(io, cache, 0, &.{0}, &bits, one + 1));
    try testing.expectError(error.InvalidBitLength, f.aggregateParticipants(io, cache, 0, &.{0}, bits[0..1], one));

    const no_bits = [_]u8{0} ** 3;
    try testing.expectError(error.EmptyIndices, f.aggregateParticipants(io, cache, 0, &.{0}, &no_bits, one));
}

test "init rejects invalid committee counts and undersized aggregate storage" {
    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();

    const shuffling = [_]u32{};
    try testing.expectError(
        error.AggregateStorageTooSmall,
        CommitteePubkeys.init(testing.allocator, testing.io, &cache, &shuffling, 1, &.{}),
    );
    try testing.expectError(
        error.InvalidCommitteesPerSlot,
        CommitteePubkeys.init(testing.allocator, testing.io, &cache, &shuffling, 0, &.{}),
    );
    try testing.expectError(
        error.InvalidCommitteesPerSlot,
        CommitteePubkeys.init(
            testing.allocator,
            testing.io,
            &cache,
            &shuffling,
            preset.MAX_COMMITTEES_PER_SLOT + 1,
            &.{},
        ),
    );
}
