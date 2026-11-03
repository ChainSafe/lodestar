const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const network = @import("network");
const fixture = @import("network_fixture");
const quic = network.quic;
const Engine = quic.Engine;
var context: network.tls.context.Context = undefined;
var engine: Engine = undefined;

pub export fn zig_fuzz_init() callconv(.c) void {
    const key = network.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ .{1})) catch unreachable;
    context = network.tls.context.Context.init(&key, fixture.unix_s, @splat(1)) catch @panic("TLS initialization failed");
    engine = Engine.init(std.heap.c_allocator, .{
        .tls = context,
        .limits = .{ .connections_max = 4, .handshaking_max = 2, .handshaking_per_source_max = 1, .dialing_max = 1 },
        .local = .{ fixture.local, null },
        .seed = &fixture.seed,
    }) catch @panic("QUIC initialization failed");
}

pub export fn zig_fuzz_test(bytes: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > network.constants.datagram_size_max) return;
    var datagram: [network.constants.datagram_size_max]u8 = undefined;
    var output: [datagram.len]u8 = undefined;
    var events: [32]quic.Engine.Event = undefined;
    var now: network.Now = network.Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = fixture.unix_s });
    for (0..4) |i| {
        @memcpy(datagram[0..len], bytes[0..len]);
        const source = fixture.source(i);
        _ = engine.receive(datagram[0..len], &source, now, &output);
        now.monotonic = network.time.milliseconds(now.millis() + 1);
        engine.advance(now);
        _ = engine.pollEvents(&events);
        engine.releaseReported();
        std.debug.assert(engine.registry.active_len <= 4);
        std.debug.assert(engine.registry.handshaking <= 2);
        std.debug.assert(engine.registry.routes.count <= engine.registry.active_len);
    }
    for (engine.registry.activeIndices()) |index| {
        const owner = engine.sendOwner(index) orelse continue;
        std.debug.assert(engine.failSend(owner));
    }
    _ = engine.pollEvents(&events);
    engine.releaseReported();
    std.debug.assert(engine.registry.active_len == 0 and engine.registry.handshaking == 0);
    std.debug.assert(engine.registry.routes.count == 0);
}
