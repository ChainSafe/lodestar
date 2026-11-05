const std = @import("std");
const protocol = @import("protocol.zig");
const RequestIO = @import("RequestIO.zig");
const codec = @import("codec.zig");

const Decoder = codec.Decoder;

fn fromHex(comptime text: []const u8) [text.len / 2]u8 {
    var out: [text.len / 2]u8 = undefined;
    _ = std.fmt.hexToBytes(&out, text) catch unreachable;
    return out;
}

const phase0_metadata_prefix = fromHex("10");
const phase0_metadata_chunk = fromHex("ff060000734e61507059011400000b5ee91209000000000000000000000000000000");
const altair_metadata_prefix = fromHex("11");
const altair_metadata_chunk = fromHex("ff060000734e6150705901150000ff4669fc0800000000000000000000000000000000");
const ping_prefix = fromHex("08");
const ping_chunk = fromHex("ff060000734e61507059010c00000175de410100000000000000");

fn decodeAll(decoder: *Decoder, bytes: []const u8, piece: usize) ![]const u8 {
    var cursor: usize = 0;
    while (cursor < bytes.len) {
        const end = @min(bytes.len, cursor + piece);
        const progress = try decoder.feed(bytes[cursor..end]);
        cursor += progress.consumed;
        if (progress.done) break;
        try std.testing.expect(progress.consumed > 0);
    }
    try std.testing.expect(decoder.isDone());
    return decoder.payload();
}

test "codec decodes the Lodestar metadata and ping fixtures" {
    var sink: [64]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;

    var decoder = Decoder.initRequest(.{ .min = 16, .max = 16 }, &sink, &scratch);
    const phase0 = phase0_metadata_prefix ++ phase0_metadata_chunk;
    const metadata = try decodeAll(&decoder, &phase0, 3);
    try std.testing.expectEqual(@as(usize, 16), metadata.len);
    try std.testing.expectEqual(@as(u8, 9), metadata[0]);
    try std.testing.expect(std.mem.allEqual(u8, metadata[1..], 0));

    decoder = Decoder.initRequest(.{ .min = 17, .max = 17 }, &sink, &scratch);
    const altair = altair_metadata_prefix ++ altair_metadata_chunk;
    const altair_metadata = try decodeAll(&decoder, &altair, 1);
    try std.testing.expectEqual(@as(usize, 17), altair_metadata.len);
    try std.testing.expectEqual(@as(u8, 8), altair_metadata[0]);

    decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
    const ping = [_]u8{0} ++ ping_prefix ++ ping_chunk;
    const ping_payload = try decodeAll(&decoder, &ping, 5);
    try std.testing.expectEqual(@as(u64, 1), std.mem.readInt(u64, ping_payload[0..8], .little));
    try std.testing.expectEqual(@as(u8, 0), decoder.result());
    try std.testing.expect(decoder.context() == null);
}

test "codec encodes the Lodestar fixtures byte for byte" {
    var out: [128]u8 = undefined;
    var ping_value: [8]u8 = undefined;
    std.mem.writeInt(u64, &ping_value, 1, .little);
    const ping = try codec.encodeRequest(&ping_value, &out);
    try std.testing.expectEqualSlices(u8, &(ping_prefix ++ ping_chunk), ping);

    var metadata_value = [_]u8{0} ** 16;
    metadata_value[0] = 9;
    const metadata = try codec.encodeChunk(0, null, &metadata_value, &out);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ++ phase0_metadata_prefix ++ phase0_metadata_chunk), metadata);
}

test "codec round trips a large payload in one-byte and seven-byte pieces" {
    const allocator = std.testing.allocator;
    const payload = try allocator.alloc(u8, 100_000);
    defer allocator.free(payload);
    var prng = std.Random.DefaultPrng.init(7);
    prng.random().bytes(payload);
    const encoded = try allocator.alloc(u8, codec.encodedLengthMax(payload.len));
    defer allocator.free(encoded);
    const context = [4]u8{ 0xde, 0xad, 0xbe, 0xef };
    const bytes = try codec.encodeChunk(0, context, payload, encoded);
    try std.testing.expect(bytes.len > payload.len);

    const sink = try allocator.alloc(u8, payload.len);
    defer allocator.free(sink);
    const scratch = try allocator.alloc(u8, codec.frame_scratch_max);
    defer allocator.free(scratch);
    for ([_]usize{ 1, 7, 65_536 }) |piece| {
        var decoder = Decoder.initResponse(.{ .min = 1, .max = payload.len }, true, sink, scratch);
        const decoded = try decodeAll(&decoder, bytes, piece);
        try std.testing.expectEqualSlices(u8, payload, decoded);
        try std.testing.expectEqual(context, decoder.context().?);
    }
}

test "codec compresses repetitive payloads into compressed frames" {
    const allocator = std.testing.allocator;
    const payload = try allocator.alloc(u8, 70_000);
    defer allocator.free(payload);
    @memset(payload, 0);
    const encoded = try allocator.alloc(u8, codec.encodedLengthMax(payload.len));
    defer allocator.free(encoded);
    const bytes = try codec.encodeRequest(payload, encoded);
    try std.testing.expect(bytes.len < payload.len / 10);
    try std.testing.expectEqual(@as(u8, 0x00), bytes[3 + codec.identifier.len]);

    const sink = try allocator.alloc(u8, payload.len);
    defer allocator.free(sink);
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var decoder = Decoder.initRequest(.{ .min = 0, .max = payload.len }, sink, &scratch);
    const decoded = try decodeAll(&decoder, bytes, 1_000);
    try std.testing.expectEqualSlices(u8, payload, decoded);
}

test "codec streams a chunk through the writer identically to the one-shot encoder" {
    const allocator = std.testing.allocator;
    const payload = try allocator.alloc(u8, 200_000);
    defer allocator.free(payload);
    for (payload, 0..) |*byte, index| byte.* = @truncate(index *% 13);
    const whole = try allocator.alloc(u8, codec.encodedLengthMax(payload.len));
    defer allocator.free(whole);
    const expected = try codec.encodeChunk(0, [4]u8{ 1, 2, 3, 4 }, payload, whole);

    var writer = codec.ChunkWriter.initChunk(0, [4]u8{ 1, 2, 3, 4 }, payload);
    var piece_buffer: [codec.frame_scratch_max]u8 = undefined;
    const streamed = try allocator.alloc(u8, expected.len);
    defer allocator.free(streamed);
    var cursor: usize = 0;
    var pieces: usize = 0;
    while (!writer.done()) : (pieces += 1) {
        const piece = try writer.next(&piece_buffer);
        @memcpy(streamed[cursor..][0..piece.len], piece);
        cursor += piece.len;
    }
    try std.testing.expectEqual(@as(usize, 5), pieces);
    try std.testing.expectEqualSlices(u8, expected, streamed[0..cursor]);
}

test "codec decodes standard custom and reserved error results" {
    var sink: [codec.error_message_max]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var out: [128]u8 = undefined;
    const chunk = try codec.encodeChunk(1, null, "bad", &out);
    var decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, true, &sink, &scratch);
    const message = try decodeAll(&decoder, chunk, 4);
    try std.testing.expectEqualStrings("bad", message);
    try std.testing.expectEqual(@as(u8, 1), decoder.result());
    try std.testing.expect(decoder.isError());
    try std.testing.expect(decoder.context() == null);

    const custom = try codec.encodeChunk(200, null, "", &out);
    decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, true, &sink, &scratch);
    try std.testing.expectEqual(@as(usize, 0), (try decodeAll(&decoder, custom, 64)).len);
    try std.testing.expectEqual(@as(u8, 200), decoder.result());

    decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
    try std.testing.expect((try decoder.feed(&.{ 5, 0 })).done);
    try std.testing.expectEqual(@as(u8, 5), decoder.result());
}

test "codec rejects every malformed input it must" {
    var sink: [256]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    const bounds = codec.Bounds{ .min = 8, .max = 64 };

    var decoder = Decoder.initRequest(bounds, &sink, &scratch);
    const long_varint = [_]u8{0x80} ** 10 ++ [_]u8{0x01};
    try std.testing.expectError(error.VarintTooLong, decoder.feed(&long_varint));

    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(&[_]u8{7}));
    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(&[_]u8{65}));

    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    try std.testing.expectError(error.BadIdentifier, decoder.feed(&[_]u8{ 8, 0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x58 }));

    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    const reserved_frame = [_]u8{8} ++ codec.identifier ++ [_]u8{ 0x02, 0x04, 0x00, 0x00 };
    try std.testing.expectError(error.BadFrameType, decoder.feed(&reserved_frame));

    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    const huge_frame = [_]u8{8} ++ codec.identifier ++ [_]u8{ 0x01, 0xff, 0xff, 0xff };
    try std.testing.expectError(error.FrameTooLarge, decoder.feed(&huge_frame));

    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    const long_frame = [_]u8{8} ++ codec.identifier ++ [_]u8{ 0x01, 40, 0x00, 0x00 } ++ [_]u8{0} ** 40;
    try std.testing.expectError(error.TooManyCompressedBytes, decoder.feed(&long_frame));

    var bad_crc = ping_prefix ++ ping_chunk;
    bad_crc[1 + codec.identifier.len + 4] ^= 0x01;
    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    try std.testing.expectError(error.BadChecksum, decoder.feed(&bad_crc));

    const second_frame = ping_chunk[codec.identifier.len..].*;
    const two_frames = ping_prefix ++ ping_chunk ++ second_frame;
    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    const progress = try decoder.feed(&two_frames);
    try std.testing.expect(progress.done);
    try std.testing.expectEqual(@as(usize, 1 + ping_chunk.len), progress.consumed);

    var too_many = [_]u8{8} ++ codec.identifier ++ [_]u8{ 0x01, 0x0d, 0x00, 0x00 } ++ [_]u8{0} ** 13;
    std.mem.writeInt(u32, too_many[1 + codec.identifier.len + 4 ..][0..4], codec.maskedChecksum(too_many[1 + codec.identifier.len + 8 ..]), .little);
    decoder = Decoder.initRequest(bounds, &sink, &scratch);
    try std.testing.expectError(error.TooManyBytes, decoder.feed(&too_many));

    decoder = Decoder.initRequest(.{ .min = 0, .max = 8 }, &sink, &scratch);
    const empty = try decoder.feed(&[_]u8{0});
    try std.testing.expect(empty.done);
    try std.testing.expectEqual(@as(usize, 0), decoder.payload().len);
}

test "codec frame size constants and header bound hold" {
    try std.testing.expectEqual(@as(usize, 4 + 32 + 65_536 + 65_536 / 6), codec.frame_body_max);
    try std.testing.expectEqual(@as(usize, 25 + 40 + 100 + 16), codec.encodedLengthMax(100));
    try std.testing.expectEqual(@as(usize, 2), codec.frameCount(65_537));
    try std.testing.expectEqual(@as(usize, 1), codec.frameCount(0));
    var out: [16]u8 = undefined;
    try std.testing.expectError(error.BufferTooSmall, codec.encodeRequest(&[_]u8{1} ** 8, &out));
}

test "codec decodes errors without touching the small success sink" {
    for ([_]usize{ 0, 15, 256 }) |length| {
        const message = [_]u8{'e'} ** 256;
        var sink = [_]u8{0xa5} ** 8;
        var scratch: [codec.frame_scratch_max]u8 = undefined;
        var wire: [512]u8 = undefined;
        const encoded = try codec.encodeChunk(1, null, message[0..length], &wire);
        var decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
        const payload = try decodeAll(&decoder, encoded, 1);
        try std.testing.expectEqualSlices(u8, message[0..length], payload);
        try std.testing.expect(std.mem.allEqual(u8, &sink, 0xa5));
    }
}

test "codec rejects malformed compressed payload boundaries" {
    const cases = [_]struct { frame: []const u8, expected: codec.Error }{
        .{ .frame = &.{ 0, 6, 0, 0, 0, 0, 0, 0, 1, 0xff }, .expected = error.InvalidCompressed },
        .{ .frame = &.{ 0, 7, 0, 0, 0, 0, 0, 0, 0x81, 0x80, 0x04 }, .expected = error.FrameTooLarge },
        .{ .frame = &.{ 0, 5, 0, 0, 0, 0, 0, 0, 2 }, .expected = error.TooManyBytes },
        .{ .frame = &.{ 0, 3, 0, 0 }, .expected = error.BadFrameLength },
    };
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var sink: [1]u8 = undefined;
    for (cases) |case| {
        var decoder = Decoder.initRequest(.{ .min = 1, .max = 1 }, &sink, &scratch);
        _ = try decoder.feed(&([_]u8{1} ++ codec.identifier));
        try std.testing.expectError(case.expected, decoder.feed(case.frame));
    }
}

test "codec bounds errors separately from successful ping payloads" {
    var sink: [8]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
    try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(&.{ 1, 0x81, 0x02 }));
    decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
    try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(&.{ 0, 9 }));
}

test "codec compact control buffers decode successful and maximum error payloads" {
    var sink: [protocol.payloadMaxControl()]u8 = undefined;
    var scratch: [protocol.control_scratch_length]u8 = undefined;
    var encoded: [codec.encodedLengthMax(codec.error_message_max)]u8 = undefined;
    var payload: [codec.error_message_max]u8 = undefined;
    var random = std.Random.DefaultPrng.init(1);
    random.random().bytes(&payload);
    for ([_]usize{ 8, 16, 17, 25, 84, 92, codec.error_message_max }) |length| {
        const is_error = length == codec.error_message_max;
        const bytes = try codec.encodeChunk(if (is_error) 1 else 0, null, payload[0..length], &encoded);
        for ([_]usize{ 1, 7, RequestIO.control_read_buffer_length }) |piece| {
            var decoder = Decoder.initResponse(.{ .min = 8, .max = sink.len }, false, &sink, &scratch);
            try std.testing.expectEqualSlices(u8, payload[0..length], try decodeAll(&decoder, bytes, piece));
            try std.testing.expectEqual(is_error, decoder.isError());
        }
    }
}

test "codec compact control buffers reject oversized frame declarations before copying" {
    var sink = [_]u8{0xa5} ** 8;
    var scratch = [_]u8{0xa5} ** protocol.control_scratch_length;
    for ([_]u8{ 0, 1, 0xfe }) |kind| {
        var decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
        const prefix = [_]u8{ 0, 8 } ++ codec.identifier;
        _ = try decoder.feed(&prefix);
        try std.testing.expectError(error.TooManyCompressedBytes, decoder.feed(&.{ kind, 0xff, 0, 0 }));
        try std.testing.expect(std.mem.allEqual(u8, &scratch, 0xa5));
        try std.testing.expect(std.mem.allEqual(u8, &sink, 0xa5));
    }
}

test "codec empty SSZ leaves no trailing Snappy identifier" {
    var encoded: [codec.frame_scratch_max]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var sink: [32]u8 = undefined;
    const request = try codec.encodeRequest("", &encoded);
    var decoder = Decoder.initRequest(.{ .min = 0, .max = 32 }, &sink, &scratch);
    const progress = try decoder.feed(request);
    try std.testing.expect(progress.done);
    try std.testing.expectEqual(request.len, progress.consumed);
    try std.testing.expectEqualSlices(u8, &.{0}, request);
    const response = try codec.encodeChunk(1, null, "", &encoded);
    decoder = Decoder.initResponse(.{ .min = 8, .max = 8 }, false, &sink, &scratch);
    const error_progress = try decoder.feed(response);
    try std.testing.expect(error_progress.done);
    try std.testing.expectEqual(response.len, error_progress.consumed);
    try std.testing.expectEqualSlices(u8, &.{ 1, 0 }, response);
}

test "codec validates repeated stream identifiers at every byte boundary" {
    const frame = phase0_metadata_chunk[codec.identifier.len..].*;
    const bytes = [_]u8{32} ++ codec.identifier ++ frame ++ codec.identifier ++ frame;
    var sink: [32]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    const repeated = 1 + codec.identifier.len + frame.len;

    for (0..bytes.len + 1) |split| {
        var decoder = Decoder.initRequest(.{ .min = 32, .max = 32 }, &sink, &scratch);
        const first = try decoder.feed(bytes[0..split]);
        try std.testing.expectEqual(split, first.consumed);
        const second = try decoder.feed(bytes[split..]);
        try std.testing.expectEqual(bytes.len - split, second.consumed);
        try std.testing.expect(second.done);
        try std.testing.expectEqual(@as(u64, 9), std.mem.readInt(u64, sink[0..8], .little));
        try std.testing.expectEqual(@as(u64, 9), std.mem.readInt(u64, sink[16..24], .little));
    }

    for (1..codec.identifier.len) |changed| {
        var malformed = bytes;
        malformed[repeated + changed] ^= 1;
        for (1..codec.identifier.len + 1) |piece| {
            var decoder = Decoder.initRequest(.{ .min = 32, .max = 32 }, &sink, &scratch);
            try std.testing.expectError(error.BadIdentifier, decodeAll(&decoder, &malformed, piece));
        }
    }

    for (0..codec.identifier.len) |end| {
        var decoder = Decoder.initRequest(.{ .min = 32, .max = 32 }, &sink, &scratch);
        const partial = bytes[0 .. repeated + end];
        const progress = try decoder.feed(partial);
        try std.testing.expectEqual(partial.len, progress.consumed);
        try std.testing.expect(!progress.done);
    }
}

test "codec skips padding and reserved skippable frames between data frames" {
    const frame = ping_chunk[codec.identifier.len..].*;
    var sink: [16]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    for ([_]u8{ 0x80, 0xfd, 0xfe }) |kind| {
        const bytes = [_]u8{16} ++ codec.identifier ++ frame ++ [_]u8{ kind, 2, 0, 0, 0xaa, 0xbb } ++ frame;
        var decoder = Decoder.initRequest(.{ .min = 16, .max = 16 }, &sink, &scratch);
        _ = try decodeAll(&decoder, &bytes, 1);
        try std.testing.expectEqual(@as(u64, 1), std.mem.readInt(u64, sink[8..16], .little));
    }
}

test "codec independent response enumerates context prefix and both frame splits" {
    // The independent JS CRC32C/Snappy codec encoded two 65-byte frames and a 130-byte declaration.
    const wire = @embedFile("testdata/independent-two-frames.bin");
    var expected: [130]u8 = undefined;
    for (&expected, 0..) |*byte, i| byte.* = @intCast(i);
    for ([_]bool{ true, false }) |response| {
        const input = if (response) wire else wire[5..];
        for (0..input.len + 1) |split| {
            var sink: [130]u8 = undefined;
            var scratch: [codec.frame_scratch_max]u8 = undefined;
            var decoder = if (response) Decoder.initResponse(.{ .min = 130, .max = 130 }, true, &sink, &scratch) else Decoder.initRequest(.{ .min = 130, .max = 130 }, &sink, &scratch);
            var consumed: usize = 0;
            for ([_][]const u8{ input[0..split], input[split..] }) |fragment| {
                var cursor: usize = 0;
                for (0..wire.len + 1) |_| {
                    if (cursor == fragment.len) break;
                    const result = try decoder.feed(fragment[cursor..]);
                    try std.testing.expect(result.consumed > 0);
                    cursor += result.consumed;
                }
                try std.testing.expectEqual(fragment.len, cursor);
                consumed += cursor;
            }
            try std.testing.expectEqual(input.len, consumed);
            try std.testing.expect(decoder.isDone());
            try std.testing.expectEqualSlices(u8, &expected, decoder.payload());
            if (response) {
                try std.testing.expectEqual([4]u8{ 1, 0, 0, 0 }, decoder.context().?);
                try std.testing.expectEqual(@as(u8, 0), decoder.result());
            }
            try std.testing.expectEqual(@as(usize, 0), (try decoder.feed(&.{})).consumed);
        }
    }
}

test "reqresp active context gate pauses before coalesced length and frames at every header split" {
    var sink = [_]u8{0xaa} ** 256;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var encoded: [512]u8 = undefined;
    const payload = [_]u8{0x42} ** 100;
    const bytes = try codec.encodeChunk(0, .{ 1, 2, 3, 4 }, &payload, &encoded);
    for (0..7) |split| {
        var decoder = Decoder.initResponseWithContext(.{ .min = 0, .max = 256 }, &sink, &scratch);
        const first = try decoder.feed(bytes[0..split]);
        try std.testing.expectEqual(@min(split, 5), first.consumed);
        var consumed = first.consumed;
        if (!decoder.awaitingContext()) {
            const second = try decoder.feed(bytes[consumed..]);
            consumed += second.consumed;
        }
        try std.testing.expectEqual(@as(usize, 5), consumed);
        try std.testing.expect(decoder.awaitingContext());
        try std.testing.expectEqual(@as(usize, 0), (try decoder.feed(bytes[consumed..])).consumed);
        try std.testing.expectError(error.LengthOutOfBounds, decoder.setContextBounds(.{ .min = 2, .max = 1 }));
        try std.testing.expectError(error.LengthOutOfBounds, decoder.setContextBounds(.{ .min = 0, .max = 257 }));
        try decoder.setContextBounds(.{ .min = 100, .max = 100 });
        try std.testing.expect((try decoder.feed(bytes[consumed..])).done);
        try std.testing.expectEqualSlices(u8, &payload, decoder.payload());
    }
}

test "reqresp active context gate rejects invalid coalesced length without writing sink" {
    var sink = [_]u8{0xaa} ** 256;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    for ([_]u8{ 99, 101 }) |length| {
        const bytes = [_]u8{ 0, 1, 2, 3, 4, length, 0xff, 6, 0, 0 };
        var decoder = Decoder.initResponseWithContext(.{ .min = 0, .max = 256 }, &sink, &scratch);
        try std.testing.expectEqual(@as(usize, 5), (try decoder.feed(&bytes)).consumed);
        try decoder.setContextBounds(.{ .min = 100, .max = 100 });
        try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(bytes[5..]));
        try std.testing.expect(std.mem.allEqual(u8, &sink, 0xaa));
    }
    var encoded: [512]u8 = undefined;
    const bytes = try codec.encodeChunk(1, null, "bad request", &encoded);
    var decoder = Decoder.initResponseWithContext(.{ .min = 100, .max = 256 }, &sink, &scratch);
    try std.testing.expect((try decoder.feed(bytes)).done);
    try std.testing.expect(!decoder.awaitingContext());
    try std.testing.expectEqualStrings("bad request", decoder.payload());
}
