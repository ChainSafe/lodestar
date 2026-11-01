const std = @import("std");
const Replay = @import("replay.zig").Replay;

test "xray replay wraps bytes and preserves retained sequence boundaries" {
    var replay = try Replay.init(std.testing.allocator);
    defer replay.deinit(std.testing.allocator);
    var frame: [65533]u8 = @splat(0);
    for (0..1100) |i| {
        std.mem.writeInt(u64, frame[0..8], i + 1, .little);
        replay.append(&frame);
    }
    try std.testing.expect(!replay.covers(1));
    const first = replay.last_sequence - replay.len + 1;
    try std.testing.expect(!replay.covers(first - 1));
    try std.testing.expect(replay.covers(first));
    for (first..replay.last_sequence + 1) |sequence| {
        try std.testing.expectEqual(frame.len, replay.copy(sequence, &frame).?);
        try std.testing.expectEqual(sequence, std.mem.readInt(u64, frame[0..8], .little));
    }
    try std.testing.expect(replay.covers(1101));
    try std.testing.expect(replay.copy(1101, &frame) == null);
    replay.clear();
    try std.testing.expect(!replay.covers(1100));
    try std.testing.expect(replay.covers(1101));
    replay.append("next");
    try std.testing.expectEqual(@as(usize, 4), replay.copy(1101, &frame).?);
    try std.testing.expectEqualSlices(u8, "next", frame[0..4]);
}

test "xray replay bounds tiny events independently of byte capacity" {
    var replay = try Replay.init(std.testing.allocator);
    defer replay.deinit(std.testing.allocator);
    for (0..Replay.entries_max + 1) |_| replay.append("a");
    try std.testing.expectEqual(Replay.entries_max, replay.len);
    try std.testing.expect(!replay.covers(1));
    try std.testing.expect(replay.covers(2));
}
