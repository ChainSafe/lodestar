const std = @import("std");
const constants = @import("constants.zig");
const consensus = @import("constants");
const snappy = @import("snappy").raw;
const varint = @import("../wire/varint.zig");
const constants_mod = @import("../constants.zig");

const assert = std.debug.assert;
const Crc32c = std.hash.crc.Crc32Iscsi;

pub const identifier = [_]u8{ 0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59 };
pub const frame_header_length: usize = 4;
pub const checksum_length: usize = 4;
pub const frame_compressed_max: usize =
    constants.maxEncodedLength(constants.frame_uncompressed_max);
pub const frame_body_max: usize = checksum_length + frame_compressed_max;
pub const frame_scratch_max: usize = frame_header_length + frame_body_max;
pub const error_message_max: usize = consensus.MAX_ERROR_MESSAGE_LENGTH;
pub const header_max: usize = 1 + constants.context_bytes_length + constants.varint_length_max +
    identifier.len;

const frame_type_compressed: u8 = 0x00;
const frame_type_uncompressed: u8 = 0x01;
const frame_type_identifier: u8 = 0xff;
const frame_type_skippable_first: u8 = 0x80;
const crc_mask_delta: u32 = 0xa282_ead8;

pub const Error = error{
    VarintTooLong,
    LengthOutOfBounds,
    BadIdentifier,
    BadFrameType,
    BadFrameLength,
    FrameTooLarge,
    BadChecksum,
    TooManyCompressedBytes,
    TooManyBytes,
    InvalidCompressed,
    BufferTooSmall,
    Truncated,
};

pub const Bounds = struct {
    min: usize,
    max: usize,
    protocol_max: ?usize = null,
};

pub const error_bounds = Bounds{ .min = 0, .max = error_message_max };

pub const Progress = struct {
    consumed: usize,
    done: bool,
};

const Phase = enum { result, context, awaiting_context, varint, identifier, frame_header, frame_body, done };

pub const Decoder = struct {
    phase: Phase,
    bounds: Bounds,
    length_protocol_fault: bool = false,
    expect_context: bool,
    gate_context: bool = false,
    sink: []u8,
    scratch: []u8,
    error_sink: [error_message_max]u8 = undefined,
    result_byte: u8 = 0,
    context_bytes: [constants.context_bytes_length]u8 = undefined,
    header: [constants.varint_length_max]u8 = undefined,
    header_len: u8 = 0,
    frame_type: u8 = 0,
    frame_length: usize = 0,
    frame_filled: usize = 0,
    length: usize = 0,
    written: usize = 0,
    compressed_total: usize = 0,

    pub fn initResponse(bounds: Bounds, context_bytes: bool, sink: []u8, scratch: []u8) Decoder {
        assert(bounds.min <= bounds.max);
        assert(sink.len >= bounds.max);
        assert(scratch.len >= frameLengthMax(@min(@max(bounds.max, error_message_max), constants.frame_uncompressed_max)));
        return .{
            .phase = .result,
            .bounds = bounds,
            .expect_context = context_bytes,
            .sink = sink,
            .scratch = scratch,
        };
    }

    pub fn initResponseWithContext(bounds: Bounds, sink: []u8, scratch: []u8) Decoder {
        var decoder = initResponse(bounds, true, sink, scratch);
        decoder.gate_context = true;
        return decoder;
    }

    pub fn awaitingContext(self: *const Decoder) bool {
        return self.phase == .awaiting_context;
    }

    pub fn setContextBounds(self: *Decoder, bounds: Bounds) error{LengthOutOfBounds}!void {
        assert(self.awaitingContext());
        if (bounds.min > bounds.max or bounds.max > self.sink.len) return error.LengthOutOfBounds;
        self.bounds = bounds;
        self.phase = .varint;
    }

    pub fn initRequest(bounds: Bounds, sink: []u8, scratch: []u8) Decoder {
        assert(bounds.min <= bounds.max);
        assert(sink.len >= bounds.max);
        assert(scratch.len >= frameLengthMax(@min(bounds.max, constants.frame_uncompressed_max)));
        return .{
            .phase = .varint,
            .bounds = bounds,
            .expect_context = false,
            .sink = sink,
            .scratch = scratch,
        };
    }

    pub fn protocolFault(self: *const Decoder, err: Error) bool {
        return switch (err) {
            error.LengthOutOfBounds => self.length_protocol_fault,
            error.BufferTooSmall => false,
            error.VarintTooLong, error.BadIdentifier, error.BadFrameType, error.BadFrameLength, error.FrameTooLarge, error.BadChecksum, error.TooManyCompressedBytes, error.TooManyBytes, error.InvalidCompressed, error.Truncated => true,
        };
    }

    pub fn isDone(self: *const Decoder) bool {
        return self.phase == .done;
    }

    pub fn result(self: *const Decoder) u8 {
        assert(self.phase != .result);
        return self.result_byte;
    }

    pub fn isError(self: *const Decoder) bool {
        return self.result_byte != constants.result_success;
    }

    pub fn context(self: *const Decoder) ?[constants.context_bytes_length]u8 {
        if (!self.expect_context or self.isError()) return null;
        assert(self.phase != .result and self.phase != .context);
        return self.context_bytes;
    }

    pub fn payload(self: *const Decoder) []const u8 {
        assert(self.phase == .done);
        assert(self.written == self.length);
        return if (self.isError()) self.error_sink[0..self.length] else self.sink[0..self.length];
    }

    pub fn feed(self: *Decoder, bytes: []const u8) Error!Progress {
        assert(self.written <= self.length or self.phase == .result or self.phase == .context or
            self.phase == .varint);
        var consumed: usize = 0;
        while (consumed < bytes.len and self.phase != .done and !self.awaitingContext()) {
            consumed += try self.step(bytes[consumed..]);
        }
        assert(consumed <= bytes.len);
        return .{ .consumed = consumed, .done = self.phase == .done };
    }

    fn step(self: *Decoder, bytes: []const u8) Error!usize {
        assert(bytes.len > 0);
        switch (self.phase) {
            .result => {
                const code = bytes[0];
                self.result_byte = code;
                if (code == constants.result_success) {
                    self.phase = if (self.expect_context) .context else .varint;
                } else {
                    self.bounds = error_bounds;
                    self.phase = .varint;
                }
                return 1;
            },
            .context => {
                const want = constants.context_bytes_length - self.header_len;
                const take = @min(want, bytes.len);
                @memcpy(self.context_bytes[self.header_len..][0..take], bytes[0..take]);
                self.header_len += @intCast(take);
                if (self.header_len == constants.context_bytes_length) {
                    self.header_len = 0;
                    self.phase = if (self.gate_context) .awaiting_context else .varint;
                }
                return take;
            },
            .varint => {
                if (self.header_len == constants.varint_length_max) return error.VarintTooLong;
                self.header[self.header_len] = bytes[0];
                self.header_len += 1;
                if (bytes[0] & 0x80 != 0) return 1;
                const decoded = varint.decode(self.header[0..self.header_len]) catch
                    return error.VarintTooLong;
                if (decoded.value < self.bounds.min or decoded.value > self.bounds.max) {
                    self.length_protocol_fault = decoded.value < self.bounds.min or
                        decoded.value > (self.bounds.protocol_max orelse self.bounds.max);
                    return error.LengthOutOfBounds;
                }
                self.length = @intCast(decoded.value);
                self.header_len = 0;
                self.compressed_total = 0;
                self.phase = if (self.length == 0) .done else .identifier;
                return 1;
            },
            .identifier => {
                const want = identifier.len - self.header_len;
                const take = @min(want, bytes.len);
                if (!std.mem.eql(u8, bytes[0..take], identifier[self.header_len..][0..take])) {
                    return error.BadIdentifier;
                }
                self.header_len += @intCast(take);
                try self.countCompressed(take);
                if (self.header_len == identifier.len) {
                    self.header_len = 0;
                    self.phase = .frame_header;
                }
                return take;
            },
            .frame_header => {
                const want = frame_header_length - self.header_len;
                const take = @min(want, bytes.len);
                @memcpy(self.header[self.header_len..][0..take], bytes[0..take]);
                self.header_len += @intCast(take);
                try self.countCompressed(take);
                if (self.header_len == frame_header_length) {
                    try self.beginFrame();
                }
                return take;
            },
            .frame_body => {
                const want = self.frame_length - self.frame_filled;
                const take = @min(want, bytes.len);
                try self.countCompressed(take);
                if (isDataFrame(self.frame_type)) {
                    assert(self.frame_length <= self.scratch.len);
                    @memcpy(self.scratch[self.frame_filled..][0..take], bytes[0..take]);
                }
                self.frame_filled += take;
                if (self.frame_filled == self.frame_length) try self.finishFrame();
                return take;
            },
            .awaiting_context, .done => unreachable,
        }
    }

    fn countCompressed(self: *Decoder, count: usize) Error!void {
        self.compressed_total += count;
        if (self.compressed_total > constants.maxEncodedLength(self.length)) {
            return error.TooManyCompressedBytes;
        }
    }

    fn beginFrame(self: *Decoder) Error!void {
        assert(self.header_len == frame_header_length);
        const frame_type = self.header[0];
        const frame_length: usize = @as(usize, self.header[1]) | (@as(usize, self.header[2]) << 8) |
            (@as(usize, self.header[3]) << 16);
        if (frame_type == frame_type_identifier) {
            if (!std.mem.eql(u8, self.header[0..frame_header_length], identifier[0..frame_header_length])) {
                return error.BadIdentifier;
            }
            self.phase = .identifier;
            return;
        }
        self.header_len = 0;
        if (isDataFrame(frame_type)) {
            if (frame_length < checksum_length) return error.BadFrameLength;
            if (frame_length > frame_body_max) {
                return error.FrameTooLarge;
            }
            if (frame_type == frame_type_uncompressed and
                frame_length - checksum_length > constants.frame_uncompressed_max)
            {
                return error.FrameTooLarge;
            }
        } else if (frame_type >= frame_type_skippable_first) {
            if (frame_length > frame_body_max) return error.FrameTooLarge;
        } else {
            return error.BadFrameType;
        }
        if (frame_length > constants.maxEncodedLength(self.length) - self.compressed_total)
            return error.TooManyCompressedBytes;
        if (isDataFrame(frame_type) and frame_length > self.scratch.len)
            return error.FrameTooLarge;
        self.frame_type = frame_type;
        self.frame_length = frame_length;
        self.frame_filled = 0;
        if (frame_length == 0) {
            try self.finishFrame();
        } else {
            self.phase = .frame_body;
        }
    }

    fn finishFrame(self: *Decoder) Error!void {
        assert(self.frame_filled == self.frame_length);
        if (isDataFrame(self.frame_type)) {
            const body = self.scratch[0..self.frame_length];
            const expected = std.mem.readInt(u32, body[0..checksum_length], .little);
            const data = body[checksum_length..];
            const sink = if (self.isError()) &self.error_sink else self.sink;
            const room = sink[self.written..self.length];
            var produced: usize = 0;
            if (self.frame_type == frame_type_uncompressed) {
                if (data.len > room.len) return error.TooManyBytes;
                @memcpy(room[0..data.len], data);
                produced = data.len;
            } else {
                const size = snappy.uncompressedLength(data) catch
                    return error.InvalidCompressed;
                if (size > constants.frame_uncompressed_max) return error.FrameTooLarge;
                if (size > room.len) return error.TooManyBytes;
                produced = snappy.uncompress(data, room[0..size]) catch
                    return error.InvalidCompressed;
                if (produced != size) return error.InvalidCompressed;
            }
            if (maskedChecksum(room[0..produced]) != expected) return error.BadChecksum;
            self.written += produced;
        }
        assert(self.written <= self.length);
        self.phase = if (self.written == self.length) .done else .frame_header;
    }
};

fn isDataFrame(frame_type: u8) bool {
    return frame_type == frame_type_compressed or frame_type == frame_type_uncompressed;
}

pub fn maskedChecksum(data: []const u8) u32 {
    const crc = Crc32c.hash(data);
    return ((crc >> 15) | (crc << 17)) +% crc_mask_delta;
}

pub fn frameCount(ssz_len: usize) usize {
    assert(ssz_len <= constants.MAX_PAYLOAD_SIZE);
    const frames = std.math.divCeil(usize, ssz_len, constants.frame_uncompressed_max) catch
        unreachable;
    return @max(frames, 1);
}

pub fn frameLengthMax(data_len: usize) usize {
    assert(data_len <= constants.frame_uncompressed_max);
    return frame_header_length + checksum_length + constants.maxEncodedLength(data_len);
}

pub fn encodedLengthMax(ssz_len: usize) usize {
    assert(ssz_len <= constants.MAX_PAYLOAD_SIZE);
    const per_frame = frame_header_length + checksum_length + constants_mod.snappy_overhead;
    return header_max + frameCount(ssz_len) * per_frame + ssz_len + ssz_len / 6;
}

pub const ChunkWriter = struct {
    result_byte: ?u8,
    context_bytes: ?[constants.context_bytes_length]u8,
    ssz: []const u8,
    offset: usize = 0,
    header_written: bool = false,

    pub fn initRequest(ssz: []const u8) ChunkWriter {
        assert(ssz.len <= constants.MAX_PAYLOAD_SIZE);
        return .{ .result_byte = null, .context_bytes = null, .ssz = ssz };
    }

    pub fn initChunk(
        result_byte: u8,
        context_bytes: ?[constants.context_bytes_length]u8,
        ssz: []const u8,
    ) ChunkWriter {
        assert(ssz.len <= constants.MAX_PAYLOAD_SIZE);
        assert(result_byte == constants.result_success or context_bytes == null);
        return .{ .result_byte = result_byte, .context_bytes = context_bytes, .ssz = ssz };
    }

    pub fn done(self: *const ChunkWriter) bool {
        assert(self.offset <= self.ssz.len);
        return self.header_written and self.offset == self.ssz.len;
    }

    pub fn next(self: *ChunkWriter, out: []u8) Error![]u8 {
        assert(!self.done());
        if (!self.header_written) {
            const written = try self.writeHeader(out);
            self.header_written = true;
            return out[0..written];
        }
        const remaining = self.ssz[self.offset..];
        const take = @min(remaining.len, constants.frame_uncompressed_max);
        if (out.len < frameLengthMax(take)) return error.BufferTooSmall;
        const written = try writeFrame(remaining[0..take], out);
        self.offset += take;
        assert(self.offset <= self.ssz.len);
        return out[0..written];
    }

    fn writeHeader(self: *const ChunkWriter, out: []u8) Error!usize {
        var cursor: usize = 0;
        if (self.result_byte) |code| {
            if (out.len < 1) return error.BufferTooSmall;
            out[0] = code;
            cursor += 1;
        }
        if (self.context_bytes) |bytes| {
            if (out.len < cursor + bytes.len) return error.BufferTooSmall;
            @memcpy(out[cursor..][0..bytes.len], &bytes);
            cursor += bytes.len;
        }
        const prefix = varint.encode(self.ssz.len, out[cursor..]) catch return error.BufferTooSmall;
        cursor += prefix.len;
        if (self.ssz.len == 0) return cursor;
        if (out.len < cursor + identifier.len) return error.BufferTooSmall;
        @memcpy(out[cursor..][0..identifier.len], &identifier);
        cursor += identifier.len;
        assert(cursor <= header_max);
        return cursor;
    }
};

fn writeFrame(data: []const u8, out: []u8) Error!usize {
    assert(data.len <= constants.frame_uncompressed_max);
    assert(out.len >= frameLengthMax(data.len));
    const body = out[frame_header_length..];
    std.mem.writeInt(u32, body[0..checksum_length], maskedChecksum(data), .little);
    const compressed = snappy.compress(data, body[checksum_length..]) catch
        return error.BufferTooSmall;
    var frame_type = frame_type_compressed;
    var payload_len = compressed;
    if (compressed >= data.len) {
        @memcpy(body[checksum_length..][0..data.len], data);
        frame_type = frame_type_uncompressed;
        payload_len = data.len;
    }
    const body_len = checksum_length + payload_len;
    assert(body_len <= frame_body_max);
    out[0] = frame_type;
    out[1] = @truncate(body_len);
    out[2] = @truncate(body_len >> 8);
    out[3] = @truncate(body_len >> 16);
    return frame_header_length + body_len;
}

pub fn encodeRequest(ssz: []const u8, out: []u8) Error![]u8 {
    var writer = ChunkWriter.initRequest(ssz);
    return drainWriter(&writer, out);
}

pub fn encodeChunk(
    result_byte: u8,
    context_bytes: ?[constants.context_bytes_length]u8,
    ssz: []const u8,
    out: []u8,
) Error![]u8 {
    var writer = ChunkWriter.initChunk(result_byte, context_bytes, ssz);
    return drainWriter(&writer, out);
}

fn drainWriter(writer: *ChunkWriter, out: []u8) Error![]u8 {
    if (out.len < encodedLengthMax(writer.ssz.len)) return error.BufferTooSmall;
    var cursor: usize = 0;
    var frames: usize = 0;
    const frames_max = constants.MAX_PAYLOAD_SIZE / constants.frame_uncompressed_max + 2;
    while (!writer.done() and frames < frames_max) : (frames += 1) {
        const piece = try writer.next(out[cursor..]);
        cursor += piece.len;
    }
    assert(writer.done());
    assert(cursor <= out.len);
    return out[0..cursor];
}

comptime {
    assert(frame_body_max < 1 << 24);
    assert(frame_scratch_max >= checksum_length + constants.frame_uncompressed_max);
    assert(header_max == 25);
}

test {
    _ = @import("codec_test.zig");
}
