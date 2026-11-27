const prom = @import("metrics/registry.zig");
const Record = @import("logging.zig").Record;
const Sink = @import("logging.zig").Sink;
const bind = @import("logging.zig").bind;
const capacity = @import("logging.zig").capacity;
const drain_max = @import("logging.zig").drain_max;
const logFn = @import("logging.zig").logFn;
const message_capacity = @import("logging.zig").message_capacity;
const std = @import("std");

test "native logging retains fatal context at the error threshold" {
    var sink: Sink = .{};
    sink.configure(.err);
    const previous = bind(&sink);
    defer _ = bind(previous);
    logFn(.debug, .network_runtime, "owner_poll_failed errno=NOMEM", .{});
    logFn(.err, .network_runtime, "owner_poll_failed errno=NOMEM", .{});
    var records: [1]Record = undefined;
    try std.testing.expectEqual(@as(usize, 1), sink.peek(&records).count);
    try std.testing.expectEqual(.err, records[0].level);
    try std.testing.expectEqual(.network_runtime, records[0].scope);
    try std.testing.expectEqualStrings("owner_poll_failed errno=NOMEM", records[0].message[0..records[0].len]);
}

test "native logging bounds records, sanitizes text and isolates sinks" {
    var first: Sink = .{};
    const second: Sink = .{};
    first.configure(.debug);
    first.write(.debug, .network_reqresp, 10, 20, "event value={s}", .{"a\n\r\x1bb"});
    var records: [drain_max]Record = undefined;
    const batch = first.peek(&records);
    try std.testing.expectEqual(@as(usize, 1), batch.count);
    try std.testing.expectEqualStrings("event value=a???b", records[0].message[0..records[0].len]);
    try std.testing.expectEqual(@as(u16, 0), second.len);
    try std.testing.expectEqual(@as(usize, 1), first.peek(&records).count);
    first.commit(1);
    first.write(.info, .network_core, 10, 20, "{s}", .{&([_]u8{'x'} ** (message_capacity + 1))});
    _ = first.peek(&records);
    try std.testing.expectEqual(@as(u64, 1), first.snapshot().total("truncated"));
    try std.testing.expectEqual(@as(u16, message_capacity), records[0].len);
    first.configure(null);
    first.write(.err, .network_runtime, 10, 20, "disabled", .{});
    try std.testing.expectEqual(@as(u16, 1), first.len);
}

test "native logging rate limits scopes and levels independently and resets each second" {
    var sink: Sink = .{};
    sink.configure(.debug);
    inline for (.{ .network_runtime, .network_core, .network_quic, .network_peers, .network_reqresp, .network_gossip, .network_mesh, .network_discovery }) |scope| {
        for (0..129) |_| sink.write(.debug, scope, 1, 1, "busy", .{});
    }
    try std.testing.expectEqual(@as(u16, 1024), sink.len);
    try std.testing.expectEqual(@as(u64, 8), sink.snapshot().total("suppressed"));
    sink.write(.debug, .network_bridge, 1000, 1000, "global limit", .{});
    try std.testing.expectEqual(@as(u16, 1024), sink.len);
    try std.testing.expectEqual(@as(u64, 9), sink.snapshot().total("suppressed"));
    for (0..128) |_| sink.write(.info, .network_runtime, 1000, 1000, "lifecycle", .{});
    try std.testing.expectEqual(@as(u16, 1152), sink.len);
    for (0..128) |_| sink.write(.debug, .network_runtime, 1001, 1001, "new window", .{});
    try std.testing.expectEqual(@as(u16, 1280), sink.len);
    try std.testing.expectEqual(@as(u64, 9), sink.snapshot().total("suppressed"));
    try std.testing.expectEqual(@as(u64, 0), sink.snapshot().total("dropped"));
}

test "native logging reserves capacity for severe records" {
    var sink: Sink = .{};
    sink.configure(.debug);
    for (0..capacity) |i| sink.write(.debug, .network_gossip, i * 1000, i * 1000, "busy", .{});
    try std.testing.expectEqual(@as(u16, capacity - 512), sink.len);
    try std.testing.expectEqual(@as(u64, 512), sink.snapshot().total("dropped"));
    for (0..257) |i| sink.write(.info, .network_runtime, (capacity + i) * 1000, 0, "lifecycle", .{});
    try std.testing.expectEqual(@as(u16, capacity - 256), sink.len);
    try std.testing.expectEqual(@as(u64, 513), sink.snapshot().total("dropped"));
    for (0..257) |i| sink.write(.err, .network_runtime, (capacity + 257 + i) * 1000, 0, "failure", .{});
    try std.testing.expectEqual(@as(u16, capacity), sink.len);
    try std.testing.expectEqual(@as(u64, 514), sink.snapshot().total("dropped"));
    try std.testing.expectEqual(@as(u64, 0), sink.snapshot().total("suppressed"));
}

test "native logging restores nested bindings and isolates owner threads" {
    var main_sink: Sink = .{};
    var child_sink: Sink = .{};
    const previous = bind(&main_sink);
    defer _ = bind(previous);
    const Child = struct {
        fn run(sink: *Sink) void {
            const old = bind(sink);
            std.debug.assert(old == null);
            defer _ = bind(old);
            logFn(.info, .network_runtime, "child_owner", .{});
        }
    };
    const thread = try std.Thread.spawn(.{}, Child.run, .{&child_sink});
    thread.join();
    const nested = bind(&child_sink);
    std.debug.assert(nested == &main_sink);
    _ = bind(nested);
    logFn(.info, .network_runtime, "main_owner", .{});
    var records: [drain_max]Record = undefined;
    try std.testing.expectEqual(@as(usize, 1), main_sink.peek(&records).count);
    try std.testing.expectEqualStrings("main_owner", records[0].message[0..records[0].len]);
    try std.testing.expectEqual(@as(usize, 1), child_sink.peek(&records).count);
    try std.testing.expectEqualStrings("child_owner", records[0].message[0..records[0].len]);
}

test "native logging preserves copied records and ordering across queue wrap and loss" {
    var sink: Sink = .{};
    for (0..capacity) |i| sink.write(.info, .network_runtime, i * 1000, i * 1000, "event index={d}", .{i});
    var records: [drain_max]Record = undefined;
    _ = sink.peek(&records);
    records[0].message[0] = '?';
    _ = sink.peek(&records);
    try std.testing.expectEqualStrings("event index=0", records[0].message[0..records[0].len]);
    sink.commit(drain_max);
    for (0..512) |i| sink.write(.err, .network_runtime, (capacity + i) * 1000, 0, "critical index={d}", .{i});
    var expected: usize = drain_max;
    var text: [40]u8 = undefined;
    for (0..capacity / drain_max) |_| {
        const batch = sink.peek(&records);
        for (records[0..batch.count]) |*record| {
            const message = if (expected < capacity - 256) try std.fmt.bufPrint(&text, "event index={d}", .{expected}) else try std.fmt.bufPrint(&text, "critical index={d}", .{expected - (capacity - 256)});
            try std.testing.expectEqualStrings(message, record.message[0..record.len]);
            expected += 1;
        }
        sink.commit(batch.count);
        if (!batch.more) break;
    }
    try std.testing.expectEqual(@as(u16, 0), sink.len);
    try std.testing.expectEqual(@as(u64, 256), sink.snapshot().total("dropped"));
    try std.testing.expectEqual(@as(usize, capacity + 256), expected);
}

test "native logging exports every loss kind" {
    var sink: Sink = .{};
    sink.configure(.debug);
    for (0..capacity) |i| sink.write(.debug, .network_gossip, i * 1000, 0, "busy", .{});
    for (0..129) |_| sink.write(.info, .network_core, capacity * 1000, 0, "{s}", .{&([_]u8{'x'} ** (message_capacity + 1))});
    var bytes: [32 * 1024]u8 = undefined;
    var writer: std.Io.Writer = .fixed(&bytes);
    var encoder: prom.Encoder = .{ .writer = &writer };
    const stats = sink.snapshot();
    try stats.write(&encoder);
    for ([_][]const u8{
        "scope=\"network_gossip\",level=\"debug\",kind=\"dropped\"} 512",
        "scope=\"network_core\",level=\"info\",kind=\"suppressed\"} 1",
        "scope=\"network_core\",level=\"info\",kind=\"truncated\"} 128",
    }) |sample| try std.testing.expect(std.mem.find(u8, writer.buffered(), sample) != null);
}
