const std = @import("std");
const Rejection = @import("types.zig").Rejection;
const dial_history = @import("dial_history.zig");

pub const Reason = enum { shutdown, irrelevant_network, fault, unable_to_verify, too_many_peers, bad_score, banned, banned_ip, unknown };
pub const count = @typeInfo(Reason).@"enum".fields.len;

pub fn reason(code: u64) Reason {
    return switch (code) {
        1 => .shutdown,
        2 => .irrelevant_network,
        3 => .fault,
        128 => .unable_to_verify,
        129 => .too_many_peers,
        250 => .bad_score,
        251 => .banned,
        252 => .banned_ip,
        else => .unknown,
    };
}

/// The rejection a received Goodbye records against its sender.
pub fn rejection(code: u64) Rejection {
    return switch (reason(code)) {
        .shutdown => .shutdown,
        .too_many_peers => .too_many_peers,
        .irrelevant_network, .bad_score, .banned, .banned_ip => .banned,
        .fault, .unable_to_verify, .unknown => .fault,
    };
}

/// The cooldown after a Goodbye we send, equal to the first block of the same Goodbye received.
pub fn cooldownMs(code: u64) u64 {
    return dial_history.firstBlockMs(rejection(code));
}

test "goodbye labels and cooldowns bound unknown peer codes" {
    try std.testing.expectEqual(Reason.too_many_peers, reason(129));
    try std.testing.expectEqual(Reason.unknown, reason(std.math.maxInt(u64)));
    try std.testing.expectEqual(@as(u64, 300_000), cooldownMs(129));
    try std.testing.expectEqual(@as(u64, 60_000), cooldownMs(std.math.maxInt(u64)));
    try std.testing.expectEqual(@as(u64, 600_000), cooldownMs(250));
    try std.testing.expectEqual(@as(u64, 600_000), cooldownMs(2));
    try std.testing.expectEqual(@as(u64, 60_000), cooldownMs(128));
    try std.testing.expectEqual(Rejection.fault, rejection(std.math.maxInt(u64)));
    try std.testing.expectEqual(Rejection.banned, rejection(252));
}
