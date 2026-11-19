//! Beacon clock - slot/epoch timing for Ethereum consensus.
//!
//! Public surface:
//!   `config`    - `ClockConfig`
//!   `slot_math` - pure arithmetic, comptime-compatible
//!   `Clock`     - event-driven beacon clock with listeners and waiters

pub const config = @import("config.zig");
pub const slot_math = @import("slot_math.zig");
pub const Clock = @import("Clock.zig");

pub const ClockConfig = config.ClockConfig;
pub const Slot = slot_math.Slot;
pub const Epoch = slot_math.Epoch;

pub const ListenerId = Clock.ListenerId;
pub const Error = Clock.Error;

test {
    _ = config;
    _ = slot_math;
    _ = Clock;
}
