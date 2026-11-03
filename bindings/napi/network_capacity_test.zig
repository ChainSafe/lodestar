const std = @import("std");
const t = std.testing;
const capacity = @import("network_capacity.zig");

test "request capacity watches survive early releases and ignore unrelated resources" {
    var tracker: capacity.Tracker = .{ .instance = 7 };
    const blocked = tracker.token(.requests);
    var buffer: [capacity.token_max]u8 = undefined;
    try t.expectEqualDeep(blocked, try capacity.Token.parse(blocked.format(&buffer)));
    try t.expect(!try tracker.watch(blocked));
    tracker.update(.bridge_bytes, 1);
    tracker.update(.bridge_slots, 1);
    tracker.update(.publication_slots, 1);
    try t.expect(!tracker.pending);
    tracker.update(.requests, 1);
    try t.expect(tracker.pending);
    try t.expect(try tracker.watch(blocked));
    tracker.pending = false;
    const next = tracker.token(.requests);
    tracker.update(.requests, 2);
    try t.expect(try tracker.watch(next));
    try t.expect(!tracker.pending);
    try t.expectError(error.InvalidNetworkCapacityToken, tracker.watch(.{ .instance = 8, .resource = .requests, .revision = 0 }));
    try t.expectError(error.InvalidNetworkCapacityToken, tracker.watch(.{ .instance = 7, .resource = .requests, .revision = 3 }));
}

test "publication watches distinguish entry retirement from shared byte releases" {
    var tracker: capacity.Tracker = .{ .instance = 8 };
    const slots = tracker.token(.publication_slots);
    try t.expect(!try tracker.watch(slots));
    tracker.update(.bridge_bytes, 1);
    try t.expect(!tracker.pending);
    tracker.update(.publication_slots, 1);
    try t.expect(tracker.pending);
    try t.expect(try tracker.watch(slots));
    const bytes = tracker.token(.bridge_bytes);
    tracker.update(.bridge_bytes, 2);
    try t.expect(try tracker.watch(bytes));
}

test "request capacity tokens reject malformed and oversized input" {
    for ([_][]const u8{ "", "0", "0:0", "0:255:0", "0:0:0:0", "x:0:0", "1:0:10000000000000000", &([_]u8{'0'} ** 65) }) |text| {
        try t.expectError(error.InvalidNetworkCapacityToken, capacity.Token.parse(text));
    }
}
