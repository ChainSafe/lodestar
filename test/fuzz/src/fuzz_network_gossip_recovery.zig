const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const fixture = @import("gossip_fixture");
const gossip = @import("network").gossipsub;
const Harness = fixture.Harness;
const input_max = 4096;
const steps_max = 2048;
/// Announced ids the harness can later deliver, so promises resolve as well as expire.
const planned_max = 32;
const planned_len = 96;

var harness: Harness = undefined;

/// Snapshot mode: this runs once before the fork server, so every input starts from this state.
pub export fn zig_fuzz_init() callconv(.c) void {
    harness.init(std.heap.c_allocator, .{ .peers = 12, .retained = 25, .validation = 8 }) catch @panic("gossip harness initialization failed");
}

pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    var cursor: fixture.Cursor = .{ .bytes = input[0..len] };
    var steps: usize = 0;
    var planned: u64 = 0;
    while (cursor.next()) |op| : (steps += 1) {
        if (steps == steps_max) break;
        const peer = cursor.byte();
        const arg = cursor.byte();
        const topic = fixture.topics[arg % 4];
        switch (op % 14) {
            0 => _ = harness.addPeer(peer),
            1 => {
                harness.closePeer(peer);
                if (arg & 1 == 1) _ = harness.addPeer(peer);
            },
            2 => {
                _ = harness.control(peer, .{ .subscription = .{ .subscribe = true, .topic = topic } });
                _ = harness.control(peer, .{ .graft = topic });
            },
            3 => {
                // Up to a heartbeat's worth of IHAVE batches, each announcing unseen ids.
                const batches = 1 + @as(usize, cursor.byte()) % gossip.constants.max_ihave_per_heartbeat;
                const count = 1 + @as(usize, arg) % fixture.ids_max;
                for (0..batches) |batch| {
                    const ids = harness.fillIds(count, true, harness.counter +% batch *% 977 +% arg);
                    _ = harness.control(peer, .{ .ihave = .{ .topic = topic, .body = harness.idBody(2, ids) } });
                    harness.counter += 1;
                }
            },
            4 => {
                // Announce ids of messages the harness can deliver later.
                const count = 1 + @as(usize, arg) % 8;
                for (harness.ids[0..count], 0..) |*id, i| id.* = harness.plannedId(topic, planned_len, planned +% i);
                _ = harness.control(peer, .{ .ihave = .{ .topic = topic, .body = harness.idBody(2, harness.ids[0..count]) } });
            },
            5 => {
                // Deliver a planned message from some peer, resolving its promise if announced.
                const seed = planned +% @as(u64, arg) % 8;
                const before = harness.sink.len;
                _ = harness.message(peer, topic, planned_len, seed);
                if (harness.sink.len > before) harness.remember(harness.sink.ids[harness.sink.len - 1]);
                if (arg & 8 == 8) planned +%= 1 + @as(u64, arg) % planned_max;
            },
            6 => {
                const count = 1 + @as(usize, cursor.byte()) % fixture.ids_max;
                const ids = harness.fillIds(count, arg & 2 == 2, harness.counter +% arg);
                _ = harness.control(peer, .{ .iwant = .{ .body = harness.idBody(1, ids) } });
            },
            7 => harness.advance(1 + @as(u64, arg) * @as(u64, if (arg > 192) 100 else 1)),
            8 => harness.drain(peer, 1 + @as(usize, arg) * 64),
            9 => harness.report(arg, switch (arg % 3) {
                0 => .accept,
                1 => .reject,
                else => .ignore,
            }),
            10 => harness.penalize(peer, @as(f64, @floatFromInt(arg)) * 2.0),
            11 => harness.cancelWrites(peer),
            12 => harness.cancelPromises(peer, arg & 1 == 1),
            13 => {
                const count = 1 + @as(usize, cursor.byte()) % 8;
                const ids = harness.fillIds(count, arg & 2 == 2, harness.counter +% arg);
                _ = harness.control(peer, .{ .idontwant = .{ .body = harness.idBody(1, ids) } });
            },
            else => unreachable,
        }
        if (steps % 8 == 7) harness.checkInvariants();
    }
    harness.checkInvariants();
    // The fork child ends with the teardown checks; the kernel reclaims its copy of the snapshot.
    harness.settle();
}
