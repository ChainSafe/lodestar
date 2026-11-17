//! Pure slot/epoch arithmetic and gossip-disparity/tolerance helpers.
//! No state, no allocation, no I/O; every function is comptime-compatible.
//! All functions assume `validate()` accepted the config.
//!
//! Arithmetic uses plain operators - out-of-range values are program errors
//! and trap. `slotWithPastToleranceMs` alone saturates, defensively: `now_ms`
//! is a Unix-ms timestamp and callers pass sub-second tolerances, so nothing
//! short of a nonsense tolerance can underflow it.

const std = @import("std");
const ct = @import("consensus_types");

pub const Slot = ct.primitive.Slot.Type;
pub const Epoch = ct.primitive.Epoch.Type;
pub const ClockConfig = @import("config.zig").ClockConfig;
pub const DurationTransition = @import("config.zig").DurationTransition;

/// Returns the slot at the given Unix-millisecond timestamp,
/// or null if pre-genesis.
/// Precondition: `validate()` accepted `config` - guarantees all durations > 0.
pub fn slotAtMs(config: ClockConfig, now_ms: u64) ?Slot {
    std.debug.assert(config.slot_duration_ms != 0);
    const genesis_ms = config.genesis_time_sec * 1000;
    if (now_ms < genesis_ms) return null;

    var seg_start_slot: Slot = 0;
    var seg_start_ms: u64 = genesis_ms;
    var seg_duration: u64 = config.slot_duration_ms;

    for (config.transitions()) |t| {
        const seg_slots = t.from_slot - seg_start_slot;
        const seg_ms_total = seg_slots * seg_duration;
        if (now_ms - seg_start_ms < seg_ms_total) {
            return seg_start_slot + (now_ms - seg_start_ms) / seg_duration;
        }
        seg_start_ms = seg_start_ms + seg_ms_total;
        seg_start_slot = t.from_slot;
        seg_duration = t.new_duration_ms;
    }

    return seg_start_slot + (now_ms - seg_start_ms) / seg_duration;
}

/// Returns the slot at the given Unix-second timestamp,
/// or null if pre-genesis.
pub fn slotAtSec(config: ClockConfig, now_sec: u64) ?Slot {
    const now_ms = now_sec * 1000;
    return slotAtMs(config, now_ms);
}

/// Slot duration that applies at `slot` - the last transition whose
/// `from_slot <= slot`, else the base `slot_duration_ms`.
pub fn slotDurationMsAt(config: ClockConfig, slot: Slot) u64 {
    var duration = config.slot_duration_ms;
    for (config.transitions()) |t| {
        if (t.from_slot > slot) break;
        duration = t.new_duration_ms;
    }
    return duration;
}

/// Returns the epoch that contains `slot`.
/// Precondition: `validate()` accepted `config` - `slots_per_epoch > 0`.
pub fn epochAtSlot(config: ClockConfig, slot: Slot) Epoch {
    std.debug.assert(config.slots_per_epoch != 0);
    return @divFloor(slot, config.slots_per_epoch);
}

/// Returns the Unix-millisecond start time of `slot`.
pub fn slotStartMs(config: ClockConfig, slot: Slot) u64 {
    const genesis_ms = config.genesis_time_sec * 1000;

    var seg_start_slot: Slot = 0;
    var seg_start_ms: u64 = genesis_ms;
    var seg_duration: u64 = config.slot_duration_ms;

    for (config.transitions()) |t| {
        if (slot < t.from_slot) {
            return seg_start_ms + (slot - seg_start_slot) * seg_duration;
        }
        const seg_slots = t.from_slot - seg_start_slot;
        seg_start_ms = seg_start_ms + seg_slots * seg_duration;
        seg_start_slot = t.from_slot;
        seg_duration = t.new_duration_ms;
    }

    return seg_start_ms + (slot - seg_start_slot) * seg_duration;
}

/// Returns the Unix-second start time of `slot`.
/// Sub-second slot durations truncate to the floor second.
pub fn slotStartSec(config: ClockConfig, slot: Slot) u64 {
    return @divFloor(slotStartMs(config, slot), 1000);
}

/// Milliseconds until the next slot boundary.
/// Pre-genesis: returns the time until genesis.
pub fn msUntilNextSlot(config: ClockConfig, now_ms: u64) u64 {
    const genesis_ms = config.genesis_time_sec * 1000;
    if (now_ms < genesis_ms) return genesis_ms - now_ms;
    // now_ms >= genesis_ms here, so slotAtMs is non-null.
    const slot = slotAtMs(config, now_ms).?;
    const next_slot = slot + 1;
    const next_start = slotStartMs(config, next_slot);
    return next_start - now_ms;
}

/// Returns the slot the network may be advancing to, accounting for gossip
/// clock disparity, or null pre-genesis when no slot is current yet.
///
/// Per phase0/p2p-interface.md, gossip validation rejects future messages with
/// strict `<`, hence `<=` here.
///
/// Assumes the disparity window reaches at most the adjacent slot - true
/// for every real config (500 ms disparity vs seconds-long slots).
pub fn slotWithGossipDisparity(config: ClockConfig, now_ms: u64) ?Slot {
    const current = slotAtMs(config, now_ms) orelse {
        // Pre-genesis the wall slot is conceptually negative, so slot 0 is
        // "current" only once we're within gossip disparity of genesis.
        const genesis_ms = slotStartMs(config, 0);
        return if (genesis_ms - now_ms <= config.maximum_gossip_clock_disparity_ms)
            0
        else
            null;
    };
    const next_slot = current + 1;
    const next_slot_ms = slotStartMs(config, next_slot);
    if (next_slot_ms - now_ms <= config.maximum_gossip_clock_disparity_ms) {
        return next_slot;
    }
    return current;
}

/// See `slotWithGossipDisparity` for the `<=` rationale.
pub fn isCurrentSlotGivenGossipDisparity(config: ClockConfig, slot: Slot, now_ms: u64) bool {
    const current = slotAtMs(config, now_ms) orelse {
        // Slot 0 pre-genesis rule: see slotWithGossipDisparity.
        if (slot != 0) return false;
        const genesis_ms = slotStartMs(config, 0);
        return genesis_ms - now_ms <= config.maximum_gossip_clock_disparity_ms;
    };
    if (slot == current) return true;

    const next_slot = current + 1;
    const next_slot_ms = slotStartMs(config, next_slot);
    if (next_slot_ms - now_ms <= config.maximum_gossip_clock_disparity_ms) {
        return slot == next_slot;
    }

    if (current > 0) {
        const current_slot_ms = slotStartMs(config, current);
        if (now_ms - current_slot_ms <= config.maximum_gossip_clock_disparity_ms) {
            return slot == current - 1;
        }
    }

    return false;
}

/// Slot at `now_ms + tolerance_ms`, or null if that still lands pre-genesis.
pub fn slotWithFutureToleranceMs(config: ClockConfig, now_ms: u64, tolerance_ms: u64) ?Slot {
    const shifted_ms = now_ms + tolerance_ms;
    return slotAtMs(config, shifted_ms);
}

/// Slot at `now_ms - tolerance_ms`, saturating (defensively - see the header);
/// anything at or before genesis clamps to slot 0.
pub fn slotWithPastToleranceMs(config: ClockConfig, now_ms: u64, tolerance_ms: u64) Slot {
    const shifted_ms = now_ms -| tolerance_ms;
    return slotAtMs(config, shifted_ms) orelse 0;
}

/// Seconds from the start of `slot` to `to_sec`; negative if earlier.
pub fn secFromSlot(config: ClockConfig, slot: Slot, to_sec: u64) i64 {
    const from_sec = slotStartSec(config, slot);
    return @as(i64, @intCast(to_sec)) - @as(i64, @intCast(from_sec));
}

/// Milliseconds from the start of `slot` to `to_ms`; negative if earlier.
pub fn msFromSlot(config: ClockConfig, slot: Slot, to_ms: u64) i64 {
    const from_ms = slotStartMs(config, slot);
    return @as(i64, @intCast(to_ms)) - @as(i64, @intCast(from_ms));
}

test {
    _ = @import("slot_math_test.zig");
}
