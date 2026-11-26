const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;
const processSlashings = @import("./process_slashings.zig").processSlashings;

test "processSlashings stores a high-index penalty compactly" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    const validator_count = 256;
    const slashed_index = validator_count - 1;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();

    const epoch_cache = test_state.cached_state.epoch_cache;
    const state = test_state.cached_state.state.castToFork(.electra);
    var validators = try state.validators();
    var validator = try validators.get(slashed_index);
    try validator.set("slashed", true);
    try validator.set(
        "withdrawable_epoch",
        epoch_cache.epoch + @divFloor(preset.EPOCHS_PER_SLASHINGS_VECTOR, 2),
    );

    test_state.epoch_transition_cache.deinit();
    test_state.epoch_transition_cache.* = try EpochTransitionCache.init(
        allocator,
        std.testing.io,
        test_state.cached_state.config,
        epoch_cache,
        test_state.cached_state.state,
    );
    epoch_cache.total_slashings_by_increment = 32;

    const penalties = try processSlashings(
        .electra,
        epoch_cache,
        state,
        test_state.epoch_transition_cache,
        false,
    );

    try std.testing.expectEqual(@as(usize, 1), penalties.len);
    try std.testing.expect(penalties[0] > 0);
}
