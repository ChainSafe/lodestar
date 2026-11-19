const std = @import("std");
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const types = @import("consensus_types");
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const SyncCommittee = types.altair.SyncCommittee.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const BLSPubkey = types.primitive.BLSPubkey.Type;

const SyncCommitteeIndices = std.ArrayList(u32);
const SyncComitteeValidatorIndexMap = std.AutoHashMap(ValidatorIndex, SyncCommitteeIndices);
const RefCount = @import("../utils/ref_count.zig").RefCount;

pub const SyncCommitteeCacheRc = RefCount(SyncCommitteeCache);

/// EpochCache is the only consumer of this cache but an instance of SyncCommitteeCacheAllForks is shared across EpochCache instances
/// no EpochCache instance takes the ownership of SyncCommitteeCacheAllForks instance
/// instead of that, we count on reference counting to deallocate the memory, see RefCount() utility
pub const SyncCommitteeCache = union(enum) {
    phase0: void,
    altair: *SyncCommitteeCacheAltair,

    pub const Error = error{SyncCommitteeNotAvailable};

    pub fn getValidatorIndices(self: *const SyncCommitteeCache) Error![]ValidatorIndex {
        return switch (self.*) {
            .phase0 => error.SyncCommitteeNotAvailable,
            .altair => |sync_committee| sync_committee.validator_indices,
        };
    }

    pub fn getValidatorIndexMap(self: *const SyncCommitteeCache) Error!*const SyncComitteeValidatorIndexMap {
        return switch (self.*) {
            .phase0 => error.SyncCommitteeNotAvailable,
            .altair => |sync_committee| sync_committee.validator_index_map,
        };
    }

    pub fn initEmpty() SyncCommitteeCache {
        return SyncCommitteeCache{ .phase0 = {} };
    }

    pub fn initSyncCommittee(allocator: Allocator, sync_committee: *const SyncCommittee, pubkey_cache: *const PubkeyCache, io: std.Io) !SyncCommitteeCache {
        const cache = try SyncCommitteeCacheAltair.initSyncCommittee(allocator, sync_committee, pubkey_cache, io);
        return SyncCommitteeCache{ .altair = cache };
    }

    pub fn initValidatorIndices(allocator: Allocator, indices: []const ValidatorIndex) !SyncCommitteeCache {
        const cloned_indices = try allocator.alloc(ValidatorIndex, indices.len);
        errdefer allocator.free(cloned_indices);

        std.mem.copyForwards(ValidatorIndex, cloned_indices, indices);
        const cache = try SyncCommitteeCacheAltair.initValidatorIndices(allocator, cloned_indices);
        return SyncCommitteeCache{ .altair = cache };
    }

    pub fn deinit(self: *SyncCommitteeCache) void {
        switch (self.*) {
            .phase0 => {},
            .altair => |sync_committee_cache| sync_committee_cache.deinit(),
        }
    }
};

/// this is for post-altair
const SyncCommitteeCacheAltair = struct {
    allocator: Allocator,

    // this takes ownership of validator_indices, consumer needs to transfer ownership to this cache
    validator_indices: []ValidatorIndex,

    validator_index_map: *SyncComitteeValidatorIndexMap,

    pub fn initSyncCommittee(allocator: Allocator, sync_committee: *const SyncCommittee, pubkey_cache: *const PubkeyCache, io: std.Io) !*SyncCommitteeCacheAltair {
        const validator_indices = try allocator.alloc(ValidatorIndex, sync_committee.pubkeys.len);
        errdefer allocator.free(validator_indices);
        try computeSyncCommitteeIndices(sync_committee, pubkey_cache, io, validator_indices);
        return SyncCommitteeCacheAltair.initValidatorIndices(allocator, validator_indices);
    }

    pub fn initValidatorIndices(allocator: Allocator, validator_indices: []ValidatorIndex) !*SyncCommitteeCacheAltair {
        const validator_index_map = try allocator.create(SyncComitteeValidatorIndexMap);
        errdefer allocator.destroy(validator_index_map);

        validator_index_map.* = SyncComitteeValidatorIndexMap.init(allocator);
        errdefer {
            var value_iterator = validator_index_map.valueIterator();
            while (value_iterator.next()) |value| {
                value.deinit(allocator);
            }
            validator_index_map.deinit();
        }

        try computeSyncCommitteeMap(allocator, validator_indices, validator_index_map);

        const cache_ptr = try allocator.create(SyncCommitteeCacheAltair);
        errdefer allocator.destroy(cache_ptr);

        cache_ptr.* = SyncCommitteeCacheAltair{
            .allocator = allocator,
            .validator_indices = validator_indices,
            .validator_index_map = validator_index_map,
        };
        return cache_ptr;
    }

    pub fn deinit(self: *SyncCommitteeCacheAltair) void {
        self.allocator.free(self.validator_indices);
        var value_iterator = self.validator_index_map.valueIterator();
        while (value_iterator.next()) |value| {
            value.deinit(self.allocator);
        }
        self.validator_index_map.deinit();
        self.allocator.destroy(self.validator_index_map);
        self.allocator.destroy(self);
    }
};

test "initSyncCommittee - sanity" {
    const allocator = std.testing.allocator;
    var pubkeys: [1]BLSPubkey = undefined;
    try @import("../test_utils/interop_pubkeys.zig").interopPubkeysCached(1, &pubkeys);
    var sync_committee = SyncCommittee{
        .pubkeys = [_]BLSPubkey{pubkeys[0]} ** preset.SYNC_COMMITTEE_SIZE,
        .aggregate_pubkey = [_]u8{2} ** 48,
    };

    var pubkey_cache = try PubkeyCache.initCapacity(allocator, std.testing.io, 1);
    defer pubkey_cache.deinit();
    try pubkey_cache.append(std.testing.io, pubkeys[0], 0);

    var cache = try SyncCommitteeCache.initSyncCommittee(allocator, &sync_committee, &pubkey_cache, std.testing.io);
    defer cache.deinit();

    try std.testing.expectEqualSlices(
        ValidatorIndex,
        &[_]ValidatorIndex{0} ** preset.SYNC_COMMITTEE_SIZE,
        try cache.getValidatorIndices(),
    );
}

fn computeSyncCommitteeMap(allocator: Allocator, sync_committee_indices: []const ValidatorIndex, out: *SyncComitteeValidatorIndexMap) !void {
    for (sync_committee_indices, 0..) |validator_index, i| {
        var indices = out.getPtr(validator_index);
        if (indices == null) {
            try out.put(validator_index, .empty);
            indices = out.getPtr(validator_index) orelse unreachable;
        }

        try indices.?.append(allocator, @intCast(i));
    }
}

test computeSyncCommitteeMap {
    const allocator = std.testing.allocator;
    var map = try allocator.create(SyncComitteeValidatorIndexMap);
    map.* = SyncComitteeValidatorIndexMap.init(allocator);
    const indices = [_]ValidatorIndex{ 0, 0, 2, 2, 4, 5 };
    try computeSyncCommitteeMap(allocator, &indices, map);

    try std.testing.expectEqual(@as(u32, 4), map.count());
    try std.testing.expectEqualSlices(u32, &[_]u32{ 0, 1 }, map.get(0).?.items);
    try std.testing.expectEqualSlices(u32, &[_]u32{ 2, 3 }, map.get(2).?.items);
    try std.testing.expectEqualSlices(u32, &[_]u32{4}, map.get(4).?.items);
    try std.testing.expectEqualSlices(u32, &[_]u32{5}, map.get(5).?.items);

    defer {
        //deinit the map
        var value_iterator = map.valueIterator();
        while (value_iterator.next()) |value| {
            value.deinit(allocator);
        }
        map.deinit();
        allocator.destroy(map);
    }
}

fn computeSyncCommitteeIndices(sync_committee: *const SyncCommittee, pubkey_cache: *const PubkeyCache, io: std.Io, out: []ValidatorIndex) !void {
    try pubkey_cache.getValidatorIndices(io, &sync_committee.pubkeys, out);
}

test computeSyncCommitteeIndices {
    var pubkeys: [1]BLSPubkey = undefined;
    try @import("../test_utils/interop_pubkeys.zig").interopPubkeysCached(1, &pubkeys);
    var sync_committee = SyncCommittee{
        .pubkeys = [_]BLSPubkey{pubkeys[0]} ** preset.SYNC_COMMITTEE_SIZE,
        .aggregate_pubkey = [_]u8{2} ** 48,
    };

    const allocator = std.testing.allocator;
    var pubkey_cache = try PubkeyCache.initCapacity(allocator, std.testing.io, 1);
    defer pubkey_cache.deinit();
    try pubkey_cache.append(std.testing.io, pubkeys[0], 0);

    var out: [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex = undefined;
    try computeSyncCommitteeIndices(&sync_committee, &pubkey_cache, std.testing.io, &out);
    try std.testing.expectEqualSlices(
        ValidatorIndex,
        &[_]ValidatorIndex{0} ** preset.SYNC_COMMITTEE_SIZE,
        &out,
    );
}

test {
    _ = @import("sync_committee_cache_test.zig");
}
