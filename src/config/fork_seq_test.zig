//! Tests for `fork_seq.zig`.

const std = @import("std");
const ForkSeq = @import("fork_seq.zig").ForkSeq;

test "fork - ForkSeq.name" {
    try std.testing.expectEqualSlices(u8, "phase0", ForkSeq.phase0.name());
    try std.testing.expectEqualSlices(u8, "altair", ForkSeq.altair.name());
    try std.testing.expectEqualSlices(u8, "bellatrix", ForkSeq.bellatrix.name());
    try std.testing.expectEqualSlices(u8, "capella", ForkSeq.capella.name());
    try std.testing.expectEqualSlices(u8, "deneb", ForkSeq.deneb.name());
    try std.testing.expectEqualSlices(u8, "electra", ForkSeq.electra.name());
    try std.testing.expectEqualSlices(u8, "fulu", ForkSeq.fulu.name());
    try std.testing.expectEqualSlices(u8, "gloas", ForkSeq.gloas.name());
    try std.testing.expectEqualSlices(u8, "heze", ForkSeq.heze.name());
}

test "fork - ForkSeq.fromName" {
    try std.testing.expectEqual(ForkSeq.phase0, ForkSeq.fromName("phase0"));
    try std.testing.expectEqual(ForkSeq.altair, ForkSeq.fromName("altair"));
    try std.testing.expectEqual(ForkSeq.bellatrix, ForkSeq.fromName("bellatrix"));
    try std.testing.expectEqual(ForkSeq.capella, ForkSeq.fromName("capella"));
    try std.testing.expectEqual(ForkSeq.deneb, ForkSeq.fromName("deneb"));
    try std.testing.expectEqual(ForkSeq.electra, ForkSeq.fromName("electra"));
    try std.testing.expectEqual(ForkSeq.fulu, ForkSeq.fromName("fulu"));
    try std.testing.expectEqual(ForkSeq.gloas, ForkSeq.fromName("gloas"));
    try std.testing.expectEqual(ForkSeq.heze, ForkSeq.fromName("heze"));
}
