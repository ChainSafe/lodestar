const std = @import("std");

/// Ordered consensus fork identifiers used throughout the client.
///
/// The numeric values define the canonical chronological ordering of forks.
// Implementors note: when adding a new fork, append it to preserve ordering and update any
// tests that enumerate names.
pub const ForkSeq = enum(u8) {
    phase0 = 0,
    altair = 1,
    bellatrix = 2,
    capella = 3,
    deneb = 4,
    electra = 5,
    fulu = 6,
    gloas = 7,
    heze = 8,

    /// Total number of fork variants.
    pub const count: u8 = @intCast(@typeInfo(ForkSeq).@"enum".fields.len);

    /// Returns the canonical tag name for this fork (e.g. `"capella"`).
    pub fn name(self: ForkSeq) [:0]const u8 {
        return @tagName(self);
    }

    /// Parses a fork name into a `ForkSeq`.
    ///
    /// If `fork_name` does not match any known fork tag name exactly, this returns
    /// `.phase0` as a safe default.
    pub fn fromName(fork_name: []const u8) ForkSeq {
        const values = comptime std.enums.values(ForkSeq);
        inline for (values) |fork_seq| {
            if (std.mem.eql(u8, fork_seq.name(), fork_name)) {
                return fork_seq;
            }
        }

        return ForkSeq.phase0;
    }

    /// Returns `true` if `self` is strictly earlier than `other` in fork order.
    pub inline fn lt(self: ForkSeq, other: ForkSeq) bool {
        return @intFromEnum(self) < @intFromEnum(other);
    }

    /// Returns `true` if `self` is earlier than or equal to `other` in fork order.
    pub inline fn lte(self: ForkSeq, other: ForkSeq) bool {
        return @intFromEnum(self) <= @intFromEnum(other);
    }

    /// Returns `true` if `self` is strictly later than `other` in fork order.
    pub inline fn gt(self: ForkSeq, other: ForkSeq) bool {
        return @intFromEnum(self) > @intFromEnum(other);
    }

    /// Returns `true` if `self` is later than or equal to `other` in fork order.
    pub inline fn gte(self: ForkSeq, other: ForkSeq) bool {
        return @intFromEnum(self) >= @intFromEnum(other);
    }
};

test {
    _ = @import("fork_seq_test.zig");
}
