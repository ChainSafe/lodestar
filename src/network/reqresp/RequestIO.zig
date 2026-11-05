const std = @import("std");
const Engine = @import("../quic/Engine.zig");
const codec = @import("codec.zig");
const stream_io = @import("../stream_io.zig");
const constants = @import("constants.zig");
const protocol = @import("protocol.zig");
const Negotiator = @import("../negotiate.zig").Negotiator;

pub const read_buffer_length: usize = 16 * 1024;
pub const reads_per_pump_max: u32 = 8;
pub const scratch_length: usize = codec.frame_scratch_max;
pub const control_read_buffer_length: usize = Negotiator.inbox_capacity;

const RequestIO = @This();

payload: []const u8 = &.{},
sink: []u8 = &.{},
scratch: []u8 = &.{},
read_buffer: []u8 = &.{},
buffered_start: usize = 0,
buffered_end: usize = 0,
fin_seen: bool = false,
decoder: codec.Decoder = undefined,
decoding: bool = false,
writer: codec.ChunkWriter = undefined,
writing: bool = false,
outbox: stream_io.Outbox = .{},

pub fn flush(
    self: *RequestIO,
    engine: *Engine,
    stream: Engine.StreamHandle,
    fin: bool,
) !stream_io.Outbox.Progress {
    if (self.writing and self.outbox.idle()) {
        const piece = try self.writer.next(self.scratch);
        const last = self.writer.done();
        self.outbox.queue(piece, last and fin);
        if (last) self.writing = false;
    }
    const flushed = try self.outbox.pump(engine, stream);
    if (flushed == .done) self.outbox = .{};
    return if (flushed == .done and self.writing) .yielded else flushed;
}

pub const Input = struct { bytes: []const u8, fin: bool, progressed: bool, reset: bool };

pub fn read(
    self: *RequestIO,
    engine: *Engine,
    stream: Engine.StreamHandle,
) Engine.StreamError!Input {
    var progressed = false;
    var reset = false;
    if (self.buffered_start == self.buffered_end and !self.fin_seen) {
        const incoming = try engine.read(stream, self.read_buffer);
        self.buffered_start = 0;
        self.buffered_end = incoming.len;
        self.fin_seen = incoming.fin;
        progressed = incoming.len > 0 or incoming.fin;
        reset = incoming.reset_code != null;
    }
    return .{
        .bytes = self.read_buffer[self.buffered_start..self.buffered_end],
        .fin = self.fin_seen,
        .progressed = progressed,
        .reset = reset,
    };
}

pub fn feed(self: *RequestIO, bytes: []const u8) codec.Error!bool {
    const progress = try self.decoder.feed(bytes);
    std.debug.assert(progress.consumed <= self.buffered_end - self.buffered_start);
    self.buffered_start += progress.consumed;
    return progress.done;
}

pub fn unread(self: *const RequestIO, engine: *Engine, stream: Engine.StreamHandle) bool {
    if (self.buffered_start < self.buffered_end or self.fin_seen) return true;
    return engine.streamReadable(stream) catch true;
}

pub fn clear(self: *RequestIO) void {
    self.payload = &.{};
    self.buffered_start = 0;
    self.buffered_end = 0;
    self.decoding = false;
    self.writing = false;
    self.decoder = undefined;
    self.writer = undefined;
    self.outbox = .{};
}

pub const BufferSizes = struct {
    scratch: usize,
    read: usize,

    pub fn init(protocols: protocol.Protocol.Set) BufferSizes {
        var payload_max: usize = 0;
        for (std.enums.values(protocol.Protocol)) |which| {
            if (!protocols.contains(which)) continue;
            const bounds = which.info();
            payload_max = @max(payload_max, bounds.request_max, bounds.response_max);
        }
        const frame_max = @min(payload_max, constants.frame_uncompressed_max);
        return .{
            .scratch = codec.frameLengthMax(@min(@max(payload_max, codec.error_message_max), constants.frame_uncompressed_max)),
            .read = @max(Negotiator.inbox_capacity, @min(read_buffer_length, codec.header_max + codec.frameLengthMax(frame_max))),
        };
    }

    pub fn bytes(self: BufferSizes) usize {
        return self.scratch + self.read;
    }
};

pub fn assignBuffers(io: *RequestIO, arena: []u8, cursor: usize, sizes: BufferSizes) usize {
    io.scratch = arena[cursor..][0..sizes.scratch];
    io.read_buffer = arena[cursor + sizes.scratch ..][0..sizes.read];
    return cursor + sizes.bytes();
}

comptime {
    std.debug.assert(read_buffer_length >= 1024);
    std.debug.assert(scratch_length >= codec.frame_scratch_max);
    std.debug.assert(protocol.control_scratch_length < scratch_length);
    std.debug.assert(control_read_buffer_length >= Negotiator.inbox_capacity);
}
