const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const wire = @import("network").wire;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0) return;
    const data = buf[1..len];
    switch (buf[0] % 5) {
        0 => fuzzMultiaddr(data),
        1 => fuzzPeerId(data),
        2 => fuzzSignedKey(data),
        3 => fuzzMultistream(data),
        4 => fuzzVarint(data),
        else => unreachable,
    }
}

fn fuzzMultiaddr(data: []const u8) void {
    if (data.len > wire.multiaddr.text_length_max) return;
    if (wire.multiaddr.Multiaddr.decode(data)) |first| {
        var binary: [wire.multiaddr.binary_length_max]u8 = undefined;
        const encoded = first.encode(&binary) catch @panic("decoded multiaddr failed to encode");
        const second = wire.multiaddr.Multiaddr.decode(encoded) catch @panic("encoded multiaddr failed to decode");
        std.debug.assert(second.address.eql(first.address));
        var text: [wire.multiaddr.text_length_max]u8 = undefined;
        const rendered = first.toText(&text) catch @panic("multiaddr failed to render");
        const parsed = wire.multiaddr.Multiaddr.parse(rendered) catch @panic("rendered multiaddr failed to parse");
        std.debug.assert(parsed.address.eql(first.address));
    } else |_| {}
    _ = wire.multiaddr.Multiaddr.parse(data) catch return;
}

fn fuzzPeerId(data: []const u8) void {
    if (wire.peer_id.PeerId.fromBytes(data)) |id| {
        var text: [wire.peer_id.text_length_max]u8 = undefined;
        const rendered = id.toText(&text);
        const parsed = wire.peer_id.PeerId.fromText(rendered) catch @panic("rendered peer id failed to parse");
        std.debug.assert(parsed.eql(&id));
    } else |_| {}
    if (data.len > wire.peer_id.text_length_max) return;
    const from_text = wire.peer_id.PeerId.fromText(data) catch return;
    var text: [wire.peer_id.text_length_max]u8 = undefined;
    std.debug.assert(std.mem.eql(u8, from_text.toText(&text), data));
}

fn fuzzSignedKey(data: []const u8) void {
    if (data.len > wire.signed_key.der_length_max) return;
    const first = wire.signed_key.decode(data) catch return;
    var out: [wire.signed_key.der_length_max]u8 = undefined;
    const encoded = wire.signed_key.encode(&first.public_key, first.signature, &out) catch
        @panic("decoded SignedKey failed to encode");
    const second = wire.signed_key.decode(encoded) catch @panic("encoded SignedKey failed to decode");
    std.debug.assert(std.mem.eql(u8, &first.public_key.bytes, &second.public_key.bytes));
    std.debug.assert(std.mem.eql(u8, first.signature, second.signature));
}

fn fuzzMultistream(data: []const u8) void {
    if (data.len > 4 * wire.multistream.message_length_max) return;
    if (wire.multistream.decodeMessage(data)) |maybe| {
        if (maybe) |message| {
            var out: [wire.multistream.message_length_max]u8 = undefined;
            const encoded = wire.multistream.encodeMessage(message.token, &out) catch @panic("token failed to encode");
            const again = (wire.multistream.decodeMessage(encoded) catch @panic("encoded message failed to decode")).?;
            std.debug.assert(std.mem.eql(u8, message.token, again.token));
        }
    } else |_| {}
    var listener: wire.multistream.Listener = .{};
    var reply: [8 * wire.multistream.message_length_max]u8 = undefined;
    _ = listener.feed(data, &.{.{ .id = "/ipfs/ping/1.0.0", .index = 0 }}, &reply) catch {};
    var dialer = wire.multistream.Dialer.init("/ipfs/ping/1.0.0") catch unreachable;
    _ = dialer.feed(data) catch {};
}

fn fuzzVarint(data: []const u8) void {
    const decoded = wire.varint.decode(data) catch return;
    var out: [wire.varint.length_max]u8 = undefined;
    const encoded = wire.varint.encode(decoded.value, &out) catch @panic("varint failed to encode");
    const again = wire.varint.decode(encoded) catch @panic("encoded varint failed to decode");
    std.debug.assert(again.value == decoded.value);
    std.debug.assert(encoded.len <= decoded.length);
}

test "network wire fuzz harness accepts a valid multiaddr" {
    const text = "/ip4/127.0.0.1/udp/4001/quic-v1/p2p/16Uiu2HAkutTMoTzDw1tCvSRtu6YoixJwS46S1ZFxW8hSx9fWHiPs";
    const parsed = try wire.multiaddr.Multiaddr.parse(text);
    var binary: [wire.multiaddr.binary_length_max]u8 = undefined;
    const encoded = try parsed.encode(&binary);
    var input: [1 + wire.multiaddr.binary_length_max]u8 = undefined;
    input[0] = 0;
    @memcpy(input[1..][0..encoded.len], encoded);
    zig_fuzz_test(&input, 1 + encoded.len);
}
