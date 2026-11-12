const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const discv5 = @import("discv5");

const enr = discv5.identity.enr;
const constants = discv5.wire.constants;
const message = discv5.wire.message;
const packet = discv5.wire.packet;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0) return;
    const data = buf[1..len];
    switch (buf[0] % 3) {
        0 => fuzzMessage(data),
        1 => fuzzPacket(data),
        2 => fuzzEnr(data),
        else => unreachable,
    }
}

fn fuzzMessage(data: []const u8) void {
    if (data.len > constants.ordinary_plaintext_size_max) return;
    var first_scratch: message.DecodeScratch = .{};
    const first = message.Message.decode(data, &first_scratch) catch return;
    var first_buffer: [constants.ordinary_plaintext_size_max]u8 = undefined;
    const first_encoded = first.encode(&first_buffer) catch
        @panic("decoded DiscV5 message failed to encode");

    var second_scratch: message.DecodeScratch = .{};
    const second = message.Message.decode(first_encoded, &second_scratch) catch
        @panic("encoded DiscV5 message failed to decode");
    var second_buffer: [constants.ordinary_plaintext_size_max]u8 = undefined;
    const second_encoded = second.encode(&second_buffer) catch
        @panic("round-tripped DiscV5 message failed to encode");
    std.debug.assert(std.mem.eql(u8, first_encoded, second_encoded));
}

fn fuzzPacket(data: []const u8) void {
    if (data.len > constants.packet_size_max) return;
    const recipient_id = [_]u8{0x42} ** constants.node_id_size;
    var scratch: packet.DecodeScratch = .{};
    const decoded = packet.decode(data, &recipient_id, &scratch) catch return;
    std.debug.assert(decoded.header.len <= constants.header_size_max);
    std.debug.assert(decoded.ciphertext.len <= data.len);
    std.debug.assert(
        decoded.static_header.authdata_size <= constants.handshake_authdata_size_max,
    );
}

fn fuzzEnr(data: []const u8) void {
    if (data.len > constants.enr_size_max) return;
    const first = enr.Record.init(data) catch return;
    const second = enr.Record.init(first.slice()) catch
        @panic("validated ENR failed to decode twice");
    std.debug.assert(std.meta.eql(first, second));
}

test "DiscV5 fuzz harness exercises a valid message" {
    const value = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .enr_sequence = 1,
    } };
    var input: [constants.ordinary_plaintext_size_max + 1]u8 = undefined;
    input[0] = 0;
    const encoded = try value.encode(input[1..]);
    zig_fuzz_test(&input, encoded.len + 1);
}
