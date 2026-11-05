const std = @import("std");
pub const protocol_id_length_max: usize = 128;
pub const proposals_max: u8 = 4;
pub const supported_max: usize = 64;
const varint = @import("varint.zig");

pub const header = "/multistream/1.0.0";
pub const na = "na";
pub const message_length_max = 2 + protocol_id_length_max + 1;
pub const listener_write_max = 4 * message_length_max;

pub const Error = error{ Malformed, TooLong, TooManyProtocols, BufferTooSmall } || varint.Error;

pub const Protocol = struct {
    id: []const u8,
    /// Stable caller identity, independent of position in the current offer list.
    index: u8,
};

pub const Message = struct {
    token: []const u8,
    consumed: usize,
};

pub fn encodeMessage(token: []const u8, out: []u8) Error![]u8 {
    if (token.len > protocol_id_length_max) return error.TooLong;
    const length = token.len + 1;
    const prefix_length = varint.encodedLength(length);
    if (out.len < prefix_length + length) return error.BufferTooSmall;
    _ = try varint.encode(length, out);
    @memcpy(out[prefix_length..][0..token.len], token);
    out[prefix_length + token.len] = '\n';
    return out[0 .. prefix_length + length];
}

pub fn decodeMessage(bytes: []const u8) Error!?Message {
    const prefix = varint.decode(bytes) catch |err| switch (err) {
        error.Truncated => return null,
        error.Overflow => return error.Malformed,
    };
    if (prefix.value == 0) return error.Malformed;
    if (prefix.value > protocol_id_length_max + 1) return error.TooLong;
    const length: usize = @intCast(prefix.value);
    if (bytes.len - prefix.length < length) return null;
    const line = bytes[prefix.length..][0..length];
    if (line[length - 1] != '\n') return error.Malformed;
    return .{ .token = line[0 .. length - 1], .consumed = prefix.length + length };
}

pub const Status = enum { pending, accepted, rejected };

pub const Outcome = struct {
    consumed: usize,
    status: Status,
};

pub const Dialer = struct {
    protocol: []const u8,
    header_seen: bool = false,

    pub fn init(protocol: []const u8) Error!Dialer {
        if (protocol.len > protocol_id_length_max) return error.TooLong;
        return .{ .protocol = protocol };
    }

    pub fn initialWrite(self: *const Dialer, out: []u8) Error![]u8 {
        const first = try encodeMessage(header, out);
        const second = try encodeMessage(self.protocol, out[first.len..]);
        return out[0 .. first.len + second.len];
    }

    pub fn feed(self: *Dialer, bytes: []const u8) Error!Outcome {
        var consumed: usize = 0;
        while (consumed < bytes.len) {
            const message = try decodeMessage(bytes[consumed..]) orelse break;
            consumed += message.consumed;
            if (!self.header_seen) {
                if (!std.mem.eql(u8, message.token, header)) return error.Malformed;
                self.header_seen = true;
                continue;
            }
            if (std.mem.eql(u8, message.token, self.protocol)) {
                return .{ .consumed = consumed, .status = .accepted };
            }
            if (std.mem.eql(u8, message.token, na)) {
                return .{ .consumed = consumed, .status = .rejected };
            }
            return error.Malformed;
        }
        return .{ .consumed = consumed, .status = .pending };
    }
};

pub const ListenerStatus = union(enum) {
    pending,
    selected: u8,
    failed,
};

pub const ListenerOutcome = struct {
    consumed: usize,
    write: []u8,
    status: ListenerStatus,
};

pub const Listener = struct {
    header_seen: bool = false,
    proposals: u8 = 0,

    pub fn feed(self: *Listener, bytes: []const u8, supported: []const Protocol, out: []u8) Error!ListenerOutcome {
        if (supported.len > supported_max) return error.TooManyProtocols;
        var consumed: usize = 0;
        var written: usize = 0;
        while (consumed < bytes.len) {
            const message = try decodeMessage(bytes[consumed..]) orelse break;
            consumed += message.consumed;
            if (!self.header_seen) {
                if (!std.mem.eql(u8, message.token, header)) return error.Malformed;
                self.header_seen = true;
                written += (try encodeMessage(header, out[written..])).len;
                continue;
            }
            if (self.proposals == proposals_max) {
                return .{ .consumed = consumed, .write = out[0..written], .status = .failed };
            }
            self.proposals += 1;
            for (supported) |protocol| {
                if (!std.mem.eql(u8, message.token, protocol.id)) continue;
                written += (try encodeMessage(protocol.id, out[written..])).len;
                return .{
                    .consumed = consumed,
                    .write = out[0..written],
                    .status = .{ .selected = protocol.index },
                };
            }
            written += (try encodeMessage(na, out[written..])).len;
        }
        return .{ .consumed = consumed, .write = out[0..written], .status = .pending };
    }
};

test {
    _ = @import("multistream_test.zig");
}
