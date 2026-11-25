//! Clock configuration: genesis, slot duration (with fork-aware transitions),
//! epoch length, and gossip-disparity tolerance.  Shared by `slot_math`
//! (pure arithmetic) and the stateful `Clock` layer.

const std = @import("std");
const ct = @import("consensus_types");
const bounded_array = @import("bounded_array");
const ChainConfig = @import("config").ChainConfig;
const preset = @import("preset").preset;
const FAR_FUTURE_EPOCH = @import("constants").FAR_FUTURE_EPOCH;

const Slot = ct.primitive.Slot.Type;

pub const DurationTransition = struct {
    from_slot: Slot,
    new_duration_ms: u64,
};

pub const max_duration_transitions: u32 = 4;

pub const DurationTransitions =
    bounded_array.BoundedArray(DurationTransition, max_duration_transitions);

/// Comptime builder for `ClockConfig.duration_transitions`.
pub fn forkTransitions(
    comptime list: []const DurationTransition,
) DurationTransitions {
    if (list.len > max_duration_transitions) {
        @compileError("too many slot duration transitions");
    }
    var arr: DurationTransitions = .{};
    inline for (list) |t| arr.push(t);
    return arr;
}

/// `duration_transitions` entries must be sorted strictly ascending by
/// `from_slot`, with non-zero `new_duration_ms` and `from_slot != 0` (validated).
pub const ClockConfig = struct {
    genesis_time_sec: u64,
    slot_duration_ms: u64,
    duration_transitions: DurationTransitions = .{},
    slots_per_epoch: u64,
    maximum_gossip_clock_disparity_ms: u64 = 500,

    pub fn validate(self: ClockConfig) error{InvalidConfig}!void {
        if (self.slot_duration_ms == 0) return error.InvalidConfig;
        if (self.slots_per_epoch == 0) return error.InvalidConfig;
        // genesis_time_sec -> ms must not overflow.
        _ = std.math.mul(u64, self.genesis_time_sec, 1000) catch return error.InvalidConfig;
        var prev_slot: Slot = 0;
        for (self.duration_transitions.constSlice()) |t| {
            if (t.from_slot == 0) return error.InvalidConfig;
            if (t.new_duration_ms == 0) return error.InvalidConfig;
            if (t.from_slot <= prev_slot) return error.InvalidConfig;
            prev_slot = t.from_slot;
        }
    }

    pub fn transitions(self: *const ClockConfig) []const DurationTransition {
        return self.duration_transitions.constSlice();
    }

    /// The chain's slot durations: `SLOT_DURATION_MS`, then `SLOT_DURATION_MS_HEZE`
    /// from the Heze fork when it is scheduled and differs.
    pub fn fromChainConfig(chain: *const ChainConfig, genesis_time_sec: u64) ClockConfig {
        var config: ClockConfig = .{
            .genesis_time_sec = genesis_time_sec,
            .slot_duration_ms = chain.SLOT_DURATION_MS,
            .slots_per_epoch = preset.SLOTS_PER_EPOCH,
        };
        if (chain.HEZE_FORK_EPOCH == FAR_FUTURE_EPOCH or chain.SLOT_DURATION_MS_HEZE == chain.SLOT_DURATION_MS) return config;
        if (chain.HEZE_FORK_EPOCH == 0) {
            config.slot_duration_ms = chain.SLOT_DURATION_MS_HEZE;
        } else {
            config.duration_transitions.push(.{
                .from_slot = chain.HEZE_FORK_EPOCH * preset.SLOTS_PER_EPOCH,
                .new_duration_ms = chain.SLOT_DURATION_MS_HEZE,
            });
        }
        return config;
    }
};

test {
    _ = @import("config_test.zig");
}
