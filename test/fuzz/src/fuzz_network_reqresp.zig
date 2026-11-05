const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const rr = @import("network").reqresp;
const codec = rr.codec;
const preset = @import("preset");
const constants = @import("constants");
const policy = rr.request_policy.Policy.init(&.{
    .deneb_start_slot = 0,
    .blocks_pre_deneb = constants.MAX_REQUEST_BLOCKS,
    .blocks_deneb = constants.MAX_REQUEST_BLOCKS_DENEB,
    .blob_identifiers_deneb = 768,
    .blob_identifiers_electra = 1152,
    .number_of_columns = preset.NUMBER_OF_COLUMNS,
    .column_chunks = preset.MAX_REQUEST_DATA_COLUMN_SIDECARS,
    .blob_schedule = &.{ .{ .start_slot = 0, .max_blobs = 6 }, .{ .start_slot = 100, .max_blobs = 9 } },
}) catch unreachable;

const input_max = 128 * 1024;
const payload_max = 64 * 1024;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len == 0 or len > input_max) return;
    const which: rr.Protocol = @enumFromInt(buf[0] % rr.Protocol.count);
    if (policy.inspect(which, buf[1..len], .fulu)) |inspection| {
        std.debug.assert(inspection.charged_cost >= 1);
        std.debug.assert(inspection.chunks_max <= which.info().chunks_max);
    } else |_| {}
    var sink: [payload_max]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    const control = which.isControl();
    var decoder = if (control)
        codec.Decoder.initResponse(.{ .min = which.info().response_min, .max = which.info().response_max }, false, &sink, scratch[0..rr.protocol.control_scratch_length])
    else
        codec.Decoder.initResponseWithContext(.{ .min = 0, .max = payload_max }, &sink, &scratch);
    var offset: usize = 0;
    for (0..4096) |_| {
        if (offset == len or decoder.isDone()) break;
        const take = @min(@as(usize, buf[offset] % 127 + 1), len - offset);
        const result = decoder.feed(buf[offset..][0..take]) catch return;
        if (result.consumed == 0) return;
        offset += result.consumed;
        if (decoder.awaitingContext()) {
            const digest = decoder.context().?;
            const min: usize = std.mem.readInt(u16, digest[0..2], .little);
            const max: usize = std.mem.readInt(u16, digest[2..4], .little);
            decoder.setContextBounds(.{ .min = min, .max = max }) catch return;
        }
    }
    if (!decoder.isDone()) return;
    const value = decoder.payload();
    std.debug.assert(value.len <= payload_max);
}
