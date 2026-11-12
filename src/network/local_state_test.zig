const std = @import("std");
const t = @import("local_state.zig");
const w = @import("control_wire.zig");
const capabilities = @import("capabilities.zig");

test "peer local state validated immutable copy leaves previous value on rejection" {
    var source: t.LocalState = .{};
    var copied: t.LocalState = undefined;
    try t.copyLocal(&copied, &source);
    source.status.head_slot = 99;
    try std.testing.expectEqual(@as(u64, 0), copied.status.head_slot);
    source.metadata.syncnets = 16;
    try std.testing.expectError(error.InvalidSyncnets, t.copyLocal(&copied, &source));
    try std.testing.expectEqual(@as(u64, 0), copied.status.head_slot);
    source.metadata.syncnets = 0;
    source.metadata.custody_group_count = 0;
    try std.testing.expectError(error.InvalidCustodyCount, t.copyLocal(&copied, &source));
    try std.testing.expectEqual(@as(u64, 0), copied.status.head_slot);
}

test "peer control serving prerequisites follow receive protocols before Fulu" {
    var receive: capabilities.Set = .initEmpty();
    receive.insert(.{ .reqresp = .status_v1 });
    receive.insert(.{ .reqresp = .metadata_v2 });
    var source: t.LocalState = .{};
    var copied: t.LocalState = undefined;
    try t.copyServingLocal(&copied, &source, receive);
    const before = copied;
    source.status.head_slot = 42;
    receive.insert(.{ .reqresp = .metadata_v3 });
    try std.testing.expectError(error.MissingCustodyAdvertisement, t.copyServingLocal(&copied, &source, receive));
    try std.testing.expectEqualDeep(before, copied);
    source.metadata.custody_group_count = 1;
    try t.copyServingLocal(&copied, &source, receive);
    receive.insert(.{ .reqresp = .status_v2 });
    try std.testing.expectError(error.MissingAvailability, t.copyServingLocal(&copied, &source, receive));
    source.status.earliest_available_slot = 0;
    try t.copyServingLocal(&copied, &source, receive);
    const valid = copied;
    source.metadata.custody_group_count = 0;
    try std.testing.expectError(error.InvalidCustodyCount, t.copyServingLocal(&copied, &source, receive));
    try std.testing.expectEqualDeep(valid, copied);
    var bytes: [w.status_size_max]u8 = undefined;
    const len = try w.encodeStatus(.status_v2, &copied.status, &bytes);
    try std.testing.expectEqualDeep(source.status, try w.decodeStatus(.status_v2, bytes[0..len]));
}

test "control values validate serving prerequisites before copying complete local state" {
    var receive: capabilities.Set = .initEmpty();
    receive.insert(.{ .reqresp = .status_v2 });
    receive.insert(.{ .reqresp = .metadata_v3 });
    var out: t.LocalState = .{ .status = .{ .head_slot = 42 }, .metadata = .{ .seq_number = 8 } };
    const before = out;
    var candidate: t.LocalState = .{ .fork = .{ .custody_groups = 0 } };
    try std.testing.expectError(error.MissingCustodyAdvertisement, t.copyServingLocal(&out, &candidate, receive));
    candidate.metadata.custody_group_count = 1;
    try std.testing.expectError(error.MissingAvailability, t.copyServingLocal(&out, &candidate, receive));
    candidate.status.earliest_available_slot = 0;
    try std.testing.expectError(error.InvalidForkContext, t.copyServingLocal(&out, &candidate, receive));
    candidate.fork.custody_groups = 1;
    candidate.status.fork_digest[0] = 1;
    try std.testing.expectError(error.InvalidForkDigest, t.copyServingLocal(&out, &candidate, receive));
    try std.testing.expectEqualDeep(before, out);
    candidate.fork.digest = candidate.status.fork_digest;
    try t.copyServingLocal(&out, &candidate, receive);
    candidate.metadata.seq_number = 99;
    try std.testing.expectEqual(@as(u64, 0), out.metadata.seq_number);
}
