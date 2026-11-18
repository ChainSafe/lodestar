//! Virtual time advances only when the simulator advances its integer clock.
const Time = @import("../types.zig").Time;
const Clock = @This();

time: *const Time,

pub fn now(self: *const Clock) Time {
    return self.time.*;
}
