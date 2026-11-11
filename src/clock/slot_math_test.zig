//! Tests for `slot_math.zig`.

const std = @import("std");
const config = @import("config.zig");
const ClockConfig = config.ClockConfig;
const DurationTransitions = config.DurationTransitions;
const forkTransitions = config.forkTransitions;
const testing = std.testing;
const slot_math = @import("slot_math.zig");
const Epoch = slot_math.Epoch;
const Slot = slot_math.Slot;
const epochAtSlot = slot_math.epochAtSlot;
const isCurrentSlotGivenGossipDisparity = slot_math.isCurrentSlotGivenGossipDisparity;
const msFromSlot = slot_math.msFromSlot;
const msUntilNextSlot = slot_math.msUntilNextSlot;
const secFromSlot = slot_math.secFromSlot;
const slotAtMs = slot_math.slotAtMs;
const slotAtSec = slot_math.slotAtSec;
const slotDurationMsAt = slot_math.slotDurationMsAt;
const slotStartMs = slot_math.slotStartMs;
const slotStartSec = slot_math.slotStartSec;
const slotWithFutureToleranceMs = slot_math.slotWithFutureToleranceMs;
const slotWithGossipDisparity = slot_math.slotWithGossipDisparity;
const slotWithPastToleranceMs = slot_math.slotWithPastToleranceMs;

const mainnet: ClockConfig = .{
    .genesis_time_sec = 1_606_824_023,
    .slot_duration_ms = 12_000,
    .slots_per_epoch = 32,
};

const eip7782: ClockConfig = .{
    .genesis_time_sec = 1_000_000,
    .slot_duration_ms = 12_000,
    .duration_transitions = forkTransitions(&.{.{ .from_slot = 1024, .new_duration_ms = 6_000 }}),
    .slots_per_epoch = 32,
};

const two_fork: ClockConfig = .{
    .genesis_time_sec = 1_000_000,
    .slot_duration_ms = 12_000,
    .duration_transitions = forkTransitions(&.{
        .{ .from_slot = 1024, .new_duration_ms = 6_000 },
        .{ .from_slot = 8192, .new_duration_ms = 4_000 },
    }),
    .slots_per_epoch = 32,
};

const test_cfg: ClockConfig = .{
    .genesis_time_sec = 100,
    .slot_duration_ms = 12_000,
    .slots_per_epoch = 32,
    .maximum_gossip_clock_disparity_ms = 500,
};

const test_genesis_ms: u64 = test_cfg.genesis_time_sec * 1000;

const test_disparity_ms: u64 = test_cfg.maximum_gossip_clock_disparity_ms;

const test_slot_1_start_ms: u64 = test_genesis_ms + test_cfg.slot_duration_ms;

test "basic slot math anchors slot 0 at genesis" {
    // Genesis starts slot 0, every 12 s step is one slot, and 32 slots make
    // an epoch; slot starts convert back to the same instants.
    try testing.expectEqual(@as(?Slot, 0), slotAtSec(mainnet, mainnet.genesis_time_sec));
    try testing.expectEqual(@as(?Slot, 1), slotAtSec(mainnet, mainnet.genesis_time_sec + 12));
    try testing.expectEqual(@as(?Slot, 2), slotAtSec(mainnet, mainnet.genesis_time_sec + 24));

    const genesis_ms = mainnet.genesis_time_sec * 1000;
    try testing.expectEqual(@as(?Slot, 0), slotAtMs(mainnet, genesis_ms));
    try testing.expectEqual(@as(?Slot, 1), slotAtMs(mainnet, genesis_ms + 12_000));

    try testing.expectEqual(@as(Epoch, 0), epochAtSlot(mainnet, 0));
    try testing.expectEqual(@as(Epoch, 0), epochAtSlot(mainnet, 31));
    try testing.expectEqual(@as(Epoch, 1), epochAtSlot(mainnet, 32));
    try testing.expectEqual(@as(Epoch, 1), epochAtSlot(mainnet, 63));
    try testing.expectEqual(@as(Epoch, 2), epochAtSlot(mainnet, 64));

    try testing.expectEqual(@as(u64, mainnet.genesis_time_sec), slotStartSec(mainnet, 0));
    try testing.expectEqual(@as(u64, mainnet.genesis_time_sec + 12), slotStartSec(mainnet, 1));
    try testing.expectEqual(@as(u64, mainnet.genesis_time_sec + 24), slotStartSec(mainnet, 2));

    try testing.expectEqual(@as(u64, mainnet.genesis_time_sec * 1000), slotStartMs(mainnet, 0));
    try testing.expectEqual(
        @as(u64, (mainnet.genesis_time_sec + 12) * 1000),
        slotStartMs(mainnet, 1),
    );

    try testing.expectEqual(@as(u64, 12_000), slotDurationMsAt(mainnet, 0));
    try testing.expectEqual(@as(u64, 12_000), slotDurationMsAt(mainnet, 1_000_000));
}

test "within-slot times floor to the slot's start" {
    // Every instant inside [start, start + 12 s) is the same slot; the exact
    // boundary begins the next one.
    try testing.expectEqual(@as(?Slot, 0), slotAtSec(mainnet, mainnet.genesis_time_sec + 0));
    try testing.expectEqual(@as(?Slot, 0), slotAtSec(mainnet, mainnet.genesis_time_sec + 6));
    try testing.expectEqual(@as(?Slot, 0), slotAtSec(mainnet, mainnet.genesis_time_sec + 11));
    try testing.expectEqual(@as(?Slot, 1), slotAtSec(mainnet, mainnet.genesis_time_sec + 12));

    const genesis_ms = mainnet.genesis_time_sec * 1000;
    try testing.expectEqual(@as(?Slot, 0), slotAtMs(mainnet, genesis_ms + 1));
    try testing.expectEqual(@as(?Slot, 0), slotAtMs(mainnet, genesis_ms + 6_000));
    try testing.expectEqual(@as(?Slot, 0), slotAtMs(mainnet, genesis_ms + 11_999));
    try testing.expectEqual(@as(?Slot, 1), slotAtMs(mainnet, genesis_ms + 12_000));
    try testing.expectEqual(@as(?Slot, 1), slotAtMs(mainnet, genesis_ms + 18_000));
    try testing.expectEqual(@as(?Slot, 1), slotAtMs(mainnet, genesis_ms + 23_999));
    try testing.expectEqual(@as(?Slot, 2), slotAtMs(mainnet, genesis_ms + 24_000));
}

test "pre-genesis returns null" {
    try testing.expectEqual(@as(?Slot, null), slotAtSec(mainnet, mainnet.genesis_time_sec - 1));
    try testing.expectEqual(@as(?Slot, null), slotAtSec(mainnet, 0));
    try testing.expectEqual(@as(?Slot, null), slotAtMs(mainnet, 0));
}

test "msUntilNextSlot counts down to the next boundary" {
    // A full slot remains at a boundary, the remainder mid-slot, and
    // pre-genesis it is the time until genesis itself.
    const genesis_ms = mainnet.genesis_time_sec * 1000;
    const slot_ms: u64 = 12_000;

    try testing.expectEqual(@as(u64, slot_ms), msUntilNextSlot(mainnet, genesis_ms));
    try testing.expectEqual(@as(u64, slot_ms - 1), msUntilNextSlot(mainnet, genesis_ms + 1));
    try testing.expectEqual(
        @as(u64, slot_ms - 6_000),
        msUntilNextSlot(mainnet, genesis_ms + 6_000),
    );
    try testing.expectEqual(@as(u64, 1), msUntilNextSlot(mainnet, genesis_ms + slot_ms - 1));
    try testing.expectEqual(@as(u64, slot_ms), msUntilNextSlot(mainnet, genesis_ms + slot_ms));
    try testing.expectEqual(@as(u64, 1_000), msUntilNextSlot(mainnet, genesis_ms - 1_000));
    try testing.expectEqual(@as(u64, genesis_ms), msUntilNextSlot(mainnet, 0));
}

test "config validate" {
    try mainnet.validate();

    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = 0,
        .slot_duration_ms = 0,
        .slots_per_epoch = 32,
    }).validate());

    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = 0,
        .slot_duration_ms = 12_000,
        .slots_per_epoch = 0,
    }).validate());

    try testing.expectEqual(@as(u64, 500), mainnet.maximum_gossip_clock_disparity_ms);

    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = std.math.maxInt(u64),
        .slot_duration_ms = 12_000,
        .slots_per_epoch = 32,
    }).validate());

    // Zero new_duration_ms in any transition is invalid
    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = 0,
        .slot_duration_ms = 12_000,
        .duration_transitions = forkTransitions(&.{.{ .from_slot = 1024, .new_duration_ms = 0 }}),
        .slots_per_epoch = 32,
    }).validate());

    // Transitions must be sorted strictly ascending
    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = 0,
        .slot_duration_ms = 12_000,
        .duration_transitions = forkTransitions(&.{
            .{ .from_slot = 2048, .new_duration_ms = 6_000 },
            .{ .from_slot = 1024, .new_duration_ms = 4_000 },
        }),
        .slots_per_epoch = 32,
    }).validate());

    // from_slot == 0 is invalid (a transition at genesis is redundant with slot_duration_ms).
    var bad_zero: DurationTransitions = .{};
    bad_zero.push(.{ .from_slot = 0, .new_duration_ms = 6_000 });
    try testing.expectError(error.InvalidConfig, (ClockConfig{
        .genesis_time_sec = 0,
        .slot_duration_ms = 12_000,
        .duration_transitions = bad_zero,
        .slots_per_epoch = 32,
    }).validate());
}

test "fork-aware: slotDurationMsAt selects the duration in force at the slot" {
    // 12 s slots before the fork at slot 1024, 6 s slots from it onward.
    try testing.expectEqual(@as(u64, 12_000), slotDurationMsAt(eip7782, 0));
    try testing.expectEqual(@as(u64, 12_000), slotDurationMsAt(eip7782, 1023));
    try testing.expectEqual(@as(u64, 6_000), slotDurationMsAt(eip7782, 1024));
    try testing.expectEqual(@as(u64, 6_000), slotDurationMsAt(eip7782, 2048));
}

test "fork-aware: slotStartMs at and across the boundary" {
    const genesis_ms = eip7782.genesis_time_sec * 1000;

    try testing.expectEqual(@as(u64, genesis_ms), slotStartMs(eip7782, 0));
    try testing.expectEqual(@as(u64, genesis_ms + 12_000), slotStartMs(eip7782, 1));

    const fork_ms = genesis_ms + 1024 * 12_000;
    try testing.expectEqual(@as(u64, fork_ms), slotStartMs(eip7782, 1024));

    try testing.expectEqual(@as(u64, fork_ms + 6_000), slotStartMs(eip7782, 1025));
    try testing.expectEqual(@as(u64, fork_ms + 6_000 * 100), slotStartMs(eip7782, 1124));
}

test "fork-aware: slotAtMs across boundary" {
    const genesis_ms = eip7782.genesis_time_sec * 1000;
    const fork_ms = genesis_ms + 1024 * 12_000;

    try testing.expectEqual(@as(?Slot, 1023), slotAtMs(eip7782, fork_ms - 12_000));
    try testing.expectEqual(@as(?Slot, 1023), slotAtMs(eip7782, fork_ms - 1));
    try testing.expectEqual(@as(?Slot, 1024), slotAtMs(eip7782, fork_ms));
    try testing.expectEqual(@as(?Slot, 1024), slotAtMs(eip7782, fork_ms + 5_999));
    try testing.expectEqual(@as(?Slot, 1025), slotAtMs(eip7782, fork_ms + 6_000));
    try testing.expectEqual(@as(?Slot, 1026), slotAtMs(eip7782, fork_ms + 12_000));
}

test "fork-aware: msUntilNextSlot across boundary" {
    const genesis_ms = eip7782.genesis_time_sec * 1000;
    const fork_ms = genesis_ms + 1024 * 12_000;

    try testing.expectEqual(@as(u64, 1), msUntilNextSlot(eip7782, fork_ms - 1));
    try testing.expectEqual(@as(u64, 6_000), msUntilNextSlot(eip7782, fork_ms));
    try testing.expectEqual(@as(u64, 3_000), msUntilNextSlot(eip7782, fork_ms + 3_000));
}

test "fork-aware: two transitions" {
    const genesis_ms = two_fork.genesis_time_sec * 1000;
    const f1_ms = genesis_ms + 1024 * 12_000; // first fork boundary
    // Slots 1024..8191 are 6s each -> 7168 slots x 6_000 ms
    const f2_ms = f1_ms + (8192 - 1024) * 6_000; // second fork boundary

    try testing.expectEqual(@as(u64, 12_000), slotDurationMsAt(two_fork, 0));
    try testing.expectEqual(@as(u64, 6_000), slotDurationMsAt(two_fork, 1024));
    try testing.expectEqual(@as(u64, 4_000), slotDurationMsAt(two_fork, 8192));

    try testing.expectEqual(@as(u64, f1_ms), slotStartMs(two_fork, 1024));
    try testing.expectEqual(@as(u64, f2_ms), slotStartMs(two_fork, 8192));
    try testing.expectEqual(@as(u64, f2_ms + 4_000), slotStartMs(two_fork, 8193));

    try testing.expectEqual(@as(?Slot, 1024), slotAtMs(two_fork, f1_ms));
    try testing.expectEqual(@as(?Slot, 8191), slotAtMs(two_fork, f2_ms - 1));
    try testing.expectEqual(@as(?Slot, 8192), slotAtMs(two_fork, f2_ms));
    try testing.expectEqual(@as(?Slot, 8193), slotAtMs(two_fork, f2_ms + 4_000));
}

test "gossip disparity: far from boundary only the current slot is accepted" {
    // 3 s into slot 0: more than 500 ms from either boundary, so neither the
    // forward nor the backward tolerance applies.
    const now = test_genesis_ms + 3_000;
    try testing.expectEqual(@as(?Slot, 0), slotWithGossipDisparity(test_cfg, now));
    try testing.expect(isCurrentSlotGivenGossipDisparity(test_cfg, 0, now));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 1, now));
}

test "gossip disparity: just after a boundary the previous slot is accepted" {
    // 300 ms into slot 1 is within the 500 ms window, so slot 0 still counts.
    try testing.expect(
        isCurrentSlotGivenGossipDisparity(test_cfg, 0, test_slot_1_start_ms + 300),
    );
}

test "gossip disparity: forward window inside, at, and past the threshold" {
    // 400 ms before slot 1's start is inside the 500 ms window, exactly
    // 500 ms is the inclusive edge, and 1 ms further is past it.
    const inside = test_slot_1_start_ms - 400;
    try testing.expectEqual(@as(?Slot, 1), slotWithGossipDisparity(test_cfg, inside));
    try testing.expect(isCurrentSlotGivenGossipDisparity(test_cfg, 1, inside));

    const edge = test_slot_1_start_ms - test_disparity_ms;
    try testing.expectEqual(@as(?Slot, 1), slotWithGossipDisparity(test_cfg, edge));
    try testing.expect(isCurrentSlotGivenGossipDisparity(test_cfg, 1, edge));

    try testing.expectEqual(@as(?Slot, 0), slotWithGossipDisparity(test_cfg, edge - 1));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 1, edge - 1));
}

test "gossip disparity: pre-genesis slot 0 only within disparity of genesis" {
    // Before genesis only slot 0 can be current, and only within 500 ms of
    // genesis: 1 s out is too early, 300 ms and the 500 ms edge are in,
    // 501 ms is out again.
    const far_before = test_genesis_ms - 1_000;
    try testing.expectEqual(@as(?Slot, null), slotWithGossipDisparity(test_cfg, far_before));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 0, far_before));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 1, far_before));

    const within = test_genesis_ms - 300;
    try testing.expectEqual(@as(?Slot, 0), slotWithGossipDisparity(test_cfg, within));
    try testing.expect(isCurrentSlotGivenGossipDisparity(test_cfg, 0, within));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 1, within));

    const edge = test_genesis_ms - test_disparity_ms;
    try testing.expectEqual(@as(?Slot, 0), slotWithGossipDisparity(test_cfg, edge));
    try testing.expect(isCurrentSlotGivenGossipDisparity(test_cfg, 0, edge));

    try testing.expectEqual(@as(?Slot, null), slotWithGossipDisparity(test_cfg, edge - 1));
    try testing.expect(!isCurrentSlotGivenGossipDisparity(test_cfg, 0, edge - 1));
}

test "tolerance helpers shift the read forward and backward one slot" {
    // From slot 1's start, one slot of future tolerance reads slot 2 and one
    // slot of past tolerance reads slot 0; four slots in, it reads slot 3.
    const one_slot = test_cfg.slot_duration_ms;
    try testing.expectEqual(
        @as(?Slot, 2),
        slotWithFutureToleranceMs(test_cfg, test_slot_1_start_ms, one_slot),
    );
    try testing.expectEqual(
        @as(Slot, 0),
        slotWithPastToleranceMs(test_cfg, test_slot_1_start_ms, one_slot),
    );
    try testing.expectEqual(
        @as(Slot, 3),
        slotWithPastToleranceMs(test_cfg, test_genesis_ms + 4 * one_slot, one_slot),
    );
}

test "secFromSlot and msFromSlot measure signed offsets from a slot's start" {
    // From slot 1's start: +6 s ahead, zero at the start itself, and -12 s
    // (one full slot) back at genesis.
    const slot_1_start_sec = test_slot_1_start_ms / 1000;
    try testing.expectEqual(@as(i64, 6), secFromSlot(test_cfg, 1, slot_1_start_sec + 6));
    try testing.expectEqual(@as(i64, 6000), msFromSlot(test_cfg, 1, test_slot_1_start_ms + 6_000));
    try testing.expectEqual(@as(i64, 0), secFromSlot(test_cfg, 1, slot_1_start_sec));
    try testing.expectEqual(@as(i64, -12), secFromSlot(test_cfg, 1, test_cfg.genesis_time_sec));
    try testing.expectEqual(@as(i64, -12000), msFromSlot(test_cfg, 1, test_genesis_ms));
}
