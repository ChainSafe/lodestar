const std = @import("std");
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");

const assert = std.debug.assert;

pub const Error = error{ FrameTooLarge, VarintTooLong };

/// Writes `body` framed with its unsigned-varint length prefix into `out` and
/// returns the framed slice. `out` must hold `protobuf.varintLen(body.len) + body.len`.
pub fn writeFrame(out: []u8, body: []const u8) []const u8 {
    var writer = protobuf.Writer.init(out);
    writer.varint(body.len);
    writer.bytes(body);
    return writer.written();
}

pub const Result = struct { consumed: usize, frame: ?[]const u8 };

/// A resumable length-prefixed frame reader. Stream bytes are fed in; body bytes
/// accumulate into caller-owned storage. When the declared length exceeds that
/// storage, only the prefix is consumed; the caller retains the remaining input
/// until a sufficiently large receive buffer is available.
pub const Reader = struct {
    prefix: [constants_varint_max]u8 = undefined,
    prefix_len: u8 = 0,
    declared: ?usize = null,
    filled: usize = 0,

    const constants_varint_max = 10;

    /// Returns the declared body length once the prefix has been parsed, so the
    /// caller can size the body buffer before feeding more.
    pub fn declaredLen(self: *const Reader) ?usize {
        return self.declared;
    }

    pub fn feed(self: *Reader, input: []const u8, body: []u8) Error!Result {
        const pos = if (self.declared == null) try self.readPrefix(input) else 0;
        if (self.declared == null) return .{ .consumed = pos, .frame = null };
        const declared = self.declared.?;
        const want = declared - self.filled;
        const take = @min(want, input.len - pos);
        // The body buffer is too small for this frame; the caller grows it and
        // re-feeds. The prefix is already consumed, so no bytes are lost.
        if (declared > body.len) return .{ .consumed = pos, .frame = null };
        @memcpy(body[self.filled..][0..take], input[pos..][0..take]);
        self.filled += take;
        if (self.filled == declared) {
            self.reset();
            return .{ .consumed = pos + take, .frame = body[0..declared] };
        }
        return .{ .consumed = pos + take, .frame = null };
    }

    pub fn readPrefix(self: *Reader, input: []const u8) Error!usize {
        assert(self.declared == null);
        var pos: usize = 0;
        while (pos < input.len) {
            const byte = input[pos];
            pos += 1;
            if (self.prefix_len == constants_varint_max) return error.VarintTooLong;
            self.prefix[self.prefix_len] = byte;
            self.prefix_len += 1;
            if (byte & 0x80 == 0) {
                var reader = protobuf.Reader.init(self.prefix[0..self.prefix_len]);
                const len = reader.varint() catch return error.VarintTooLong;
                if (len > constants.GOSSIP_MAX_SIZE) return error.FrameTooLarge;
                self.declared = @intCast(len);
                self.filled = 0;
                break;
            }
        }
        return pos;
    }

    fn reset(self: *Reader) void {
        self.declared = null;
        self.prefix_len = 0;
        self.filled = 0;
    }
};

test {
    _ = @import("frame_test.zig");
}
