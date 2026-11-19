const std = @import("std");
const protobuf = @import("protobuf.zig");
const topic = @import("topic.zig");
const constants = @import("constants.zig");
const snappy = @import("snappy");

pub const Header = union(enum) { rejected, invalid, payload: usize };
pub const Decoded = union(enum) {
    invalid: topic.MessageId,
    valid: struct { id: topic.MessageId, bytes: []const u8 },
};

pub fn inspect(msg: *const protobuf.Message) Header {
    if (msg.signed or msg.data.len > constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE)) return .rejected;
    const size = snappy.raw.uncompressedLength(msg.data) catch return .invalid;
    if (size > constants.MAX_PAYLOAD_SIZE) return .rejected;
    return .{ .payload = size };
}

/// Call after inspect returns payload, with output sized to that declared length.
pub fn decode(msg: *const protobuf.Message, output: []u8, policy: topic.MessageIdPolicy) Decoded {
    const header = inspect(msg);
    std.debug.assert(header == .payload and header.payload == output.len);
    const written = snappy.raw.uncompress(msg.data, output) catch {
        return .{ .invalid = topic.invalidMessageId(msg.topic, msg.data, policy) };
    };
    std.debug.assert(written == output.len);
    return .{ .valid = .{ .id = topic.validMessageId(msg.topic, output[0..written], policy), .bytes = output[0..written] } };
}

test {
    _ = @import("admission_test.zig");
}
