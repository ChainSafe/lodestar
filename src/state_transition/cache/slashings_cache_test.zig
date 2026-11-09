//! Tests for `slashings_cache.zig`.

const std = @import("std");
const types = @import("consensus_types");
const Slot = types.primitive.Slot.Type;
const Validator = types.phase0.Validator.Type;
const SlashingsCache = @import("slashings_cache.zig").SlashingsCache;

test "SlashingsCache - initEmpty creates empty cache" {
    const allocator = std.testing.allocator;
    var cache = try SlashingsCache.initEmpty(allocator);
    defer cache.deinit();

    try std.testing.expect(cache.latest_block_slot == null);
    try std.testing.expect(!cache.isSlashed(0));
    try std.testing.expect(!cache.isSlashed(100));
}

test "SlashingsCache - initFromValidators populates slashed bits" {
    const allocator = std.testing.allocator;
    var validators: [5]Validator = undefined;
    @memset(std.mem.asBytes(&validators), 0);

    // Mark validators 1 and 3 as slashed
    validators[1].slashed = true;
    validators[3].slashed = true;

    var validator_ptrs: [5]*const Validator = undefined;
    for (0..5) |i| validator_ptrs[i] = &validators[i];

    var cache = try SlashingsCache.initFromValidators(allocator, 42, &validator_ptrs);
    defer cache.deinit();

    try std.testing.expectEqual(@as(?Slot, 42), cache.latest_block_slot);
    try std.testing.expect(!cache.isSlashed(0));
    try std.testing.expect(cache.isSlashed(1));
    try std.testing.expect(!cache.isSlashed(2));
    try std.testing.expect(cache.isSlashed(3));
    try std.testing.expect(!cache.isSlashed(4));
}

test "SlashingsCache - isInitialized checks slot" {
    const allocator = std.testing.allocator;
    var cache = try SlashingsCache.initEmpty(allocator);
    defer cache.deinit();

    try std.testing.expect(!cache.isInitialized(0));
    try std.testing.expect(!cache.isInitialized(42));

    cache.updateLatestBlockSlot(42);
    try std.testing.expect(cache.isInitialized(42));
    try std.testing.expect(!cache.isInitialized(43));
}

test "SlashingsCache - recordValidatorSlashing requires initialization" {
    const allocator = std.testing.allocator;
    var cache = try SlashingsCache.initEmpty(allocator);
    defer cache.deinit();

    // Should fail when not initialized
    try std.testing.expectError(error.SlashingsCacheUninitialized, cache.recordValidatorSlashing(10, 5));

    // Initialize and try again
    cache.updateLatestBlockSlot(10);
    try cache.recordValidatorSlashing(10, 5);
    try std.testing.expect(cache.isSlashed(5));

    // Wrong slot should fail
    try std.testing.expectError(error.SlashingsCacheUninitialized, cache.recordValidatorSlashing(11, 6));
}

test "SlashingsCache - recordValidatorSlashing grows capacity" {
    const allocator = std.testing.allocator;
    var cache = try SlashingsCache.initEmpty(allocator);
    defer cache.deinit();

    cache.updateLatestBlockSlot(0);

    // Record slashing for a high index — should grow the bitset
    try cache.recordValidatorSlashing(0, 1000);
    try std.testing.expect(cache.isSlashed(1000));
    try std.testing.expect(!cache.isSlashed(999));
}

test "SlashingsCache - clone creates independent copy" {
    const allocator = std.testing.allocator;
    var validators: [3]Validator = undefined;
    @memset(std.mem.asBytes(&validators), 0);
    validators[1].slashed = true;

    var validator_ptrs: [3]*const Validator = undefined;
    for (0..3) |i| validator_ptrs[i] = &validators[i];

    var original = try SlashingsCache.initFromValidators(allocator, 10, &validator_ptrs);
    defer original.deinit();

    var cloned = try original.clone(allocator);
    defer cloned.deinit();

    // Both should see validator 1 as slashed
    try std.testing.expect(cloned.isSlashed(1));
    try std.testing.expectEqual(@as(?Slot, 10), cloned.latest_block_slot);

    // Modify original — clone should be unaffected
    original.updateLatestBlockSlot(20);
    try original.recordValidatorSlashing(20, 2);

    try std.testing.expectEqual(@as(?Slot, 10), cloned.latest_block_slot);
    try std.testing.expect(!cloned.isSlashed(2));
}
