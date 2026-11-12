const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const network = @import("network");
const codec = network.identify.codec;
const input_max = codec.aggregate_max + 101;
const identity: network.PeerId = .{ .bytes = .{ 0, 37, 8, 2, 18, 33, 2, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87, 0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16, 0xf8, 0x17, 0x98 } };

pub export fn zig_fuzz_init() callconv(.c) void {}
pub export fn zig_fuzz_test(input: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    const bytes = input[1..len];
    var decoder = codec.Decoder.init(&identity);
    var whole = codec.Decoder.init(&identity);
    whole.feed(bytes, true) catch {};
    const chunk: usize = 1 + input[0] % 64;
    var offset: usize = 0;
    for (0..input_max) |_| {
        if (offset == bytes.len) break;
        const end = @min(offset + chunk, bytes.len);
        decoder.feed(bytes[offset..end], false) catch {
            std.debug.assert(whole.result() == null and decoder.result() == null);
            return;
        };
        std.debug.assert(decoder.result() == null);
        offset = end;
    }
    std.debug.assert(offset == bytes.len);
    decoder.feed(&.{}, true) catch {
        std.debug.assert(whole.result() == null);
        return;
    };
    std.debug.assert(std.meta.eql(decoder.result(), whole.result()));
}
