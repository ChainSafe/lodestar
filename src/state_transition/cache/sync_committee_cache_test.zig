//! Tests for `sync_committee_cache.zig`.

const std = @import("std");
const ValidatorIndex = @import("consensus_types").primitive.ValidatorIndex.Type;
const SyncCommitteeCache = @import("sync_committee_cache.zig").SyncCommitteeCache;

test "memory_safety: initValidatorIndices should release cloned indices on init failure" {
    const indices = [_]ValidatorIndex{ 0, 1, 2 };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, input: []const ValidatorIndex) !void {
            var cache = try SyncCommitteeCache.initValidatorIndices(allocator, input);
            defer cache.deinit();
            try std.testing.expectEqualSlices(ValidatorIndex, input, try cache.getValidatorIndices());
        }
    }.run, .{&indices});
}

test "phase0 sync-committee lookups return an error instead of aborting" {
    var cache = SyncCommitteeCache.initEmpty();
    try std.testing.expectError(
        error.SyncCommitteeNotAvailable,
        cache.getValidatorIndices(),
    );
    try std.testing.expectError(
        error.SyncCommitteeNotAvailable,
        cache.getValidatorIndexMap(),
    );
}
