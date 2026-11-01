const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const fixture = @import("gossip_fixture");
const Harness = fixture.Harness;
const input_max = 4096;
const steps_max = 2048;

var harness: Harness = undefined;

/// Snapshot mode: this runs once before the fork server, so every input starts from this state.
pub export fn zig_fuzz_init() callconv(.c) void {
    harness.init(std.heap.c_allocator, .{}) catch @panic("gossip harness initialization failed");
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    var cursor: fixture.Cursor = .{ .bytes = input[0..len] };
    var steps: usize = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max) break;
        const peer = cursor.byte();
        const arg = cursor.byte();
        const topic = fixture.topics[arg % fixture.topics.len];
        switch (op % 16) {
            0 => _ = harness.addPeer(peer),
            1 => harness.closePeer(peer),
            2 => _ = harness.control(peer, .{ .subscription = .{ .subscribe = arg & 1 == 1, .topic = topic } }),
            3 => _ = harness.control(peer, .{ .graft = topic }),
            4 => _ = harness.control(peer, .{ .prune = .{ .topic = topic, .backoff = @as(u64, arg / 8) * 10 } }),
            5 => {
                const count = 1 + @as(usize, cursor.byte()) % fixture.ids_max;
                const ids = harness.fillIds(count, arg & 2 == 2, harness.counter +% arg);
                _ = harness.control(peer, .{ .ihave = .{ .topic = topic, .body = harness.idBody(2, ids) } });
            },
            6 => {
                const count = 1 + @as(usize, cursor.byte()) % fixture.ids_max;
                const ids = harness.fillIds(count, arg & 2 == 2, harness.counter +% arg);
                _ = harness.control(peer, .{ .iwant = .{ .body = harness.idBody(1, ids) } });
            },
            7 => {
                const count = 1 + @as(usize, cursor.byte()) % 8;
                const ids = harness.fillIds(count, arg & 2 == 2, harness.counter +% arg);
                _ = harness.control(peer, .{ .idontwant = .{ .body = harness.idBody(1, ids) } });
            },
            8 => {
                const size = 1 + @as(usize, cursor.byte()) * 31;
                const seed: u64 = if (arg & 4 == 4) arg / 8 else harness.counter +% 0x9e37;
                const before = harness.sink.len;
                _ = harness.message(peer, topic, size, seed);
                if (harness.sink.len > before) harness.remember(harness.sink.ids[harness.sink.len - 1]);
            },
            9 => harness.report(arg, switch (arg % 3) {
                0 => .accept,
                1 => .reject,
                else => .ignore,
            }),
            10 => harness.advance(1 + @as(u64, arg) * @as(u64, if (arg > 200) 50 else 1)),
            11 => harness.drain(peer, 1 + @as(usize, arg) * 16),
            12 => harness.cancelWrites(peer),
            13 => harness.penalize(peer, @as(f64, @floatFromInt(arg)) * 0.5),
            14 => harness.publish(topic, 1 + @as(usize, arg) * 17, harness.counter +% 0x51),
            15 => harness.sink.refuse = arg & 1 == 1,
            else => unreachable,
        }
        if (steps % 8 == 7) harness.checkInvariants();
    }
    harness.checkInvariants();
    // The fork child ends with the teardown checks; the kernel reclaims its copy of the snapshot.
    harness.settle();
}

test "fuzz harness gossip starts each input with fresh state and a controlled clock" {
    var h: Harness = undefined;
    for (0..3) |_| {
        try h.init(std.testing.allocator, .{});
        defer h.deinit();
        try std.testing.expect(h.addPeer(0));
        try std.testing.expectEqual(@as(u32, 1), h.conns[0].?.generation);
        h.advance(25);
        try std.testing.expectEqual(@as(u64, 26), h.now_ms);
        const sample = std.Io.Clock.Timestamp.now(h.g.clock, .awake);
        try std.testing.expectEqual(@as(i96, 26 * std.time.ns_per_ms), sample.raw.nanoseconds);
        _ = h.message(0, fixture.topics[0], 96, 7);
        try std.testing.expectEqual(@as(usize, 1), h.sink.len);
        h.report(0, .accept);
        h.checkInvariants();
    }
}
