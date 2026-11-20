const std = @import("std");
const multistream = @import("multistream.zig");

const ping = "/ipfs/ping/1.0.0";
const other = "/other/1.0.0";
const supported = [_]multistream.Protocol{
    .{ .id = other, .index = 91 },
    .{ .id = ping, .index = 255 },
};

test "multistream messages are varint length prefixed lines" {
    var buffer: [multistream.message_length_max]u8 = undefined;
    const encoded = try multistream.encodeMessage(multistream.header, &buffer);
    try std.testing.expectEqual(@as(u8, 19), encoded[0]);
    try std.testing.expectEqualStrings("/multistream/1.0.0\n", encoded[1..]);
    const decoded = (try multistream.decodeMessage(encoded)).?;
    try std.testing.expectEqualStrings(multistream.header, decoded.token);
    try std.testing.expectEqual(encoded.len, decoded.consumed);
    try std.testing.expectEqual(@as(?multistream.Message, null), try multistream.decodeMessage(encoded[0..5]));
    try std.testing.expectError(error.Malformed, multistream.decodeMessage(&.{ 0x02, 'a', 'b' }));
    try std.testing.expectError(error.Malformed, multistream.decodeMessage(&.{0x00}));
    try std.testing.expectError(error.TooLong, multistream.decodeMessage(&.{ 0xff, 0x01 }));
    var small: [4]u8 = undefined;
    try std.testing.expectError(error.BufferTooSmall, multistream.encodeMessage(multistream.header, &small));
    try std.testing.expectError(error.TooLong, multistream.encodeMessage("x" ** 129, &buffer));
}

test "multistream dialer and listener agree on a protocol" {
    var dialer = try multistream.Dialer.init(ping);
    var listener: multistream.Listener = .{};

    var dial_buffer: [2 * multistream.message_length_max]u8 = undefined;
    const dial_bytes = try dialer.initialWrite(&dial_buffer);

    var reply_buffer: [2 * multistream.message_length_max]u8 = undefined;
    const half = dial_bytes.len / 2;
    const first = try listener.feed(dial_bytes[0..half], &supported, &reply_buffer);
    try std.testing.expectEqual(multistream.ListenerStatus.pending, first.status);
    const second = try listener.feed(dial_bytes[first.consumed..], &supported, reply_buffer[first.write.len..]);
    try std.testing.expectEqual(multistream.ListenerStatus{ .selected = 255 }, second.status);
    try std.testing.expectEqual(dial_bytes.len, first.consumed + second.consumed);

    const reply = reply_buffer[0 .. first.write.len + second.write.len];
    const outcome = try dialer.feed(reply);
    try std.testing.expectEqual(multistream.Status.accepted, outcome.status);
    try std.testing.expectEqual(reply.len, outcome.consumed);
}

test "multistream listener answers na and bounds proposals" {
    var listener: multistream.Listener = .{};
    var request: [4 * multistream.message_length_max]u8 = undefined;
    var cursor: usize = 0;
    cursor += (try multistream.encodeMessage(multistream.header, request[cursor..])).len;
    cursor += (try multistream.encodeMessage(other, request[cursor..])).len;
    var reply: [4 * multistream.message_length_max]u8 = undefined;
    const outcome = try listener.feed(request[0..cursor], supported[1..], &reply);
    try std.testing.expectEqual(multistream.ListenerStatus.pending, outcome.status);
    const decoded_header = (try multistream.decodeMessage(outcome.write)).?;
    try std.testing.expectEqualStrings(multistream.header, decoded_header.token);
    const decoded_na = (try multistream.decodeMessage(outcome.write[decoded_header.consumed..])).?;
    try std.testing.expectEqualStrings(multistream.na, decoded_na.token);

    var proposals: [5 * multistream.message_length_max]u8 = undefined;
    var proposals_len: usize = 0;
    for (0..4) |_| proposals_len += (try multistream.encodeMessage(other, proposals[proposals_len..])).len;
    const bounded = try listener.feed(proposals[0..proposals_len], supported[1..], &reply);
    try std.testing.expectEqual(multistream.ListenerStatus.failed, bounded.status);
    try std.testing.expectEqual(@as(usize, 3 * 4), bounded.write.len);

    var dialer = try multistream.Dialer.init(ping);
    var rejected: [2 * multistream.message_length_max]u8 = undefined;
    var rejected_len: usize = 0;
    rejected_len += (try multistream.encodeMessage(multistream.header, rejected[rejected_len..])).len;
    rejected_len += (try multistream.encodeMessage(multistream.na, rejected[rejected_len..])).len;
    try std.testing.expectEqual(multistream.Status.rejected, (try dialer.feed(rejected[0..rejected_len])).status);

    var wrong_header = try multistream.Dialer.init(ping);
    var bad: [2 * multistream.message_length_max]u8 = undefined;
    const bad_len = (try multistream.encodeMessage(other, &bad)).len;
    try std.testing.expectError(error.Malformed, wrong_header.feed(bad[0..bad_len]));
    try std.testing.expectError(error.TooLong, multistream.Dialer.init("x" ** 129));
}

test "multistream listener checks live support when a fragmented proposal completes" {
    var listener: multistream.Listener = .{};
    const dialer = try multistream.Dialer.init(ping);
    var request: [2 * multistream.message_length_max]u8 = undefined;
    const hello = try dialer.initialWrite(&request);
    var reply: [multistream.listener_write_max]u8 = undefined;
    const partial = try listener.feed(hello[0 .. hello.len - 1], &supported, &reply);
    try std.testing.expectEqual(multistream.ListenerStatus.pending, partial.status);
    try std.testing.expectEqual((try multistream.decodeMessage(hello)).?.consumed, partial.consumed);

    const withdrawn = try listener.feed(hello[partial.consumed..], supported[0..1], &reply);
    try std.testing.expectEqual(multistream.ListenerStatus.pending, withdrawn.status);
    try std.testing.expectEqualStrings(multistream.na, (try multistream.decodeMessage(withdrawn.write)).?.token);
    const fallback = try multistream.encodeMessage(other, &request);
    const accepted = try listener.feed(fallback, &supported, &reply);
    try std.testing.expectEqual(multistream.ListenerStatus{ .selected = 91 }, accepted.status);
    try std.testing.expectEqualStrings(other, (try multistream.decodeMessage(accepted.write)).?.token);
}

test "multistream listener bounds the support table before consuming input" {
    var listener: multistream.Listener = .{};
    const dialer = try multistream.Dialer.init(ping);
    var request: [2 * multistream.message_length_max]u8 = undefined;
    const hello = try dialer.initialWrite(&request);
    var reply: [multistream.listener_write_max]u8 = undefined;
    var offered = [_]multistream.Protocol{supported[0]} ** 65;
    offered[63] = supported[1];
    try std.testing.expectError(error.TooManyProtocols, listener.feed(hello, &offered, &reply));
    try std.testing.expect(!listener.header_seen);
    try std.testing.expectEqual(@as(u8, 0), listener.proposals);
    const accepted = try listener.feed(hello, offered[0..64], &reply);
    try std.testing.expectEqual(multistream.ListenerStatus{ .selected = 255 }, accepted.status);
    try std.testing.expectEqual(hello.len, accepted.consumed);

    var empty: multistream.Listener = .{};
    const rejected = try empty.feed(hello, &.{}, &reply);
    try std.testing.expectEqual(multistream.ListenerStatus.pending, rejected.status);
    try std.testing.expectEqual(hello.len, rejected.consumed);
    const header = (try multistream.decodeMessage(rejected.write)).?;
    try std.testing.expectEqualStrings(multistream.na, (try multistream.decodeMessage(rejected.write[header.consumed..])).?.token);
}
