const std = @import("std");
const t = @import("types.zig");
test "peer fork context rejects invalid custody group bounds" {
    try std.testing.expectError(
        error.InvalidForkContext,
        (t.ForkContext{ .custody_groups = 0 }).validate(),
    );
    try std.testing.expectError(
        error.InvalidForkContext,
        (t.ForkContext{ .custody_groups = 129 }).validate(),
    );
    try std.testing.expectError(
        error.InvalidForkContext,
        (t.ForkContext{ .custody_groups = 3 }).validate(),
    );
}

test "custody demand validates every target against chain groups fork and peer capacity" {
    const context: t.ForkContext = .{ .fork = .fulu, .custody_groups = 64 };
    var demand: t.Demand = .{};
    demand.custody_group_targets[63] = 2;
    try demand.validate(&context, 2);
    try std.testing.expect(demand.wanted().custody_groups.isSet(63));
    try std.testing.expectError(error.InvalidDemand, demand.validate(&context, 1));
    try std.testing.expectError(error.InvalidDemand, demand.validate(&.{ .fork = .electra, .custody_groups = 64 }, 2));
    demand.custody_group_targets[64] = 1;
    try std.testing.expectError(error.InvalidDemand, demand.validate(&context, 2));
    try std.testing.expectError(error.InvalidForkContext, (t.ForkContext{ .custody_groups = 64, .custody_requirement = 65 }).validate());
}
