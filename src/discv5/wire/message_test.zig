const std = @import("std");
const constants = @import("constants.zig");
const message = @import("message.zig");
const rlp = @import("rlp.zig");
const types = @import("../types.zig");

test "request IDs preserve length and reject more than eight bytes" {
    const short = try message.RequestId.init(&.{ 0x01, 0x00 });
    try std.testing.expectEqualSlices(u8, &.{ 0x01, 0x00 }, short.slice());
    try std.testing.expectError(
        error.InvalidMessage,
        message.RequestId.init(&([_]u8{0} ** 9)),
    );
}

test "all RPC messages round-trip without allocation" {
    const request_id = try message.RequestId.init(&.{ 0x01, 0x00 });
    const enr = [_]u8{ 0x83, 'e', 'n', 'r' };
    const enrs = [_][]const u8{&enr};
    const cases = [_]message.Message{
        .{ .ping = .{ .request_id = request_id, .enr_sequence = 2 } },
        .{ .pong = .{
            .request_id = request_id,
            .enr_sequence = 3,
            .recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } },
            .recipient_port = 9_000,
        } },
        .{ .find_node = .{ .request_id = request_id, .distances = &.{ 0, 1, 256 } } },
        .{ .nodes = .{ .request_id = request_id, .total = 1, .enrs = &enrs } },
        .{ .talk_request = .{
            .request_id = request_id,
            .protocol = "portal",
            .request = "request",
        } },
        .{ .talk_response = .{ .request_id = request_id, .response = "response" } },
    };

    var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
    var scratch: message.DecodeScratch = .{};
    for (&cases) |*expected| {
        const bytes = try expected.encode(&encoded);
        const actual = try message.Message.decode(bytes, &scratch);
        try expectMessageEqual(expected, &actual);
    }
}

test "message decoder rejects trailing fields and bytes" {
    var buffer: [64]u8 = undefined;
    const ping = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .enr_sequence = 2,
    } };
    const encoded = try ping.encode(&buffer);
    var with_trailing: [65]u8 = undefined;
    @memcpy(with_trailing[0..encoded.len], encoded);
    with_trailing[encoded.len] = 0x80;
    var scratch: message.DecodeScratch = .{};
    try std.testing.expectError(
        error.InvalidEncoding,
        message.Message.decode(with_trailing[0 .. encoded.len + 1], &scratch),
    );

    const extra_field = [_]u8{ 0x01, 0xc3, 0x01, 0x02, 0x80 };
    try std.testing.expectError(
        error.InvalidEncoding,
        message.Message.decode(&extra_field, &scratch),
    );
}

test "FINDNODE rejects any invalid distance and scratch remains reusable" {
    var encoded: [64]u8 = undefined;
    encoded[0] = 0x03;
    var writer = rlp.Writer.init(encoded[1..]);
    const outer = try writer.beginList();
    try writer.writeBytes(&.{0x01});
    const distances = try writer.beginList();
    try writer.writeUint(1);
    try writer.writeUint(257);
    writer.finishList(distances);
    writer.finishList(outer);
    const encoded_length = writer.bytes().len + 1;
    var scratch: message.DecodeScratch = .{};

    try std.testing.expectError(
        error.InvalidMessage,
        message.Message.decode(encoded[0..encoded_length], &scratch),
    );
    const valid: message.Message = .{ .find_node = .{ .request_id = try .init(&.{1}), .distances = &.{ 2, 3 } } };
    const decoded = try message.Message.decode(try valid.encode(&encoded), &scratch);
    try std.testing.expectEqualSlices(u16, &.{ 2, 3 }, decoded.find_node.distances);
}

test "NODES enforces the bounded ENR count" {
    const request_id = try message.RequestId.init(&.{});
    const enrs = [_][]const u8{&.{0x80}} ** (types.findnode_result_max + 1);
    const nodes = message.Message{ .nodes = .{
        .request_id = request_id,
        .total = 1,
        .enrs = &enrs,
    } };
    var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
    try std.testing.expectError(error.InvalidMessage, nodes.encode(&encoded));
}

test "message decoder rejects invalid PONG endpoints and excessive NODES records" {
    var encoded: [128]u8 = undefined;
    var scratch: message.DecodeScratch = .{};
    for ([_]struct { ip: []const u8, port: u64 }{
        .{ .ip = &.{ 127, 0, 0, 1, 1 }, .port = 9000 },
        .{ .ip = &.{ 127, 0, 0, 1 }, .port = 65_536 },
    }) |case| {
        encoded[0] = 2;
        var writer = rlp.Writer.init(encoded[1..]);
        const outer = try writer.beginList();
        try writer.writeBytes(&.{1});
        try writer.writeUint(1);
        try writer.writeBytes(case.ip);
        try writer.writeUint(case.port);
        writer.finishList(outer);
        try std.testing.expectError(error.InvalidMessage, message.Message.decode(encoded[0 .. 1 + writer.bytes().len], &scratch));
    }
    encoded[0] = 4;
    var writer = rlp.Writer.init(encoded[1..]);
    const outer = try writer.beginList();
    try writer.writeBytes(&.{1});
    try writer.writeUint(1);
    const records = try writer.beginList();
    for (0..types.findnode_result_max + 1) |_| try writer.writeBytes(&.{});
    writer.finishList(records);
    writer.finishList(outer);
    try std.testing.expectError(error.InvalidMessage, message.Message.decode(encoded[0 .. 1 + writer.bytes().len], &scratch));
}

test "FINDNODE decoding publishes each distance once" {
    const request_id = try message.RequestId.init(&.{0x01});
    const find_node = message.Message{ .find_node = .{
        .request_id = request_id,
        .distances = &.{ 256, 0, 256, 1, 0 },
    } };
    var encoded: [64]u8 = undefined;
    const bytes = try find_node.encode(&encoded);
    var scratch: message.DecodeScratch = .{};
    const decoded = try message.Message.decode(bytes, &scratch);
    try std.testing.expectEqualSlices(u16, &.{ 256, 0, 1 }, decoded.find_node.distances);
}

test "FINDNODE decoder bounds large duplicate lists by distinct values" {
    var encoded: [1_200]u8 = undefined;
    encoded[0] = 0x03;
    var writer = rlp.Writer.init(encoded[1..]);
    const outer = try writer.beginList();
    try writer.writeBytes(&.{0x01});
    const distances = try writer.beginList();
    for (0..300) |_| try writer.writeUint(256);
    writer.finishList(distances);
    writer.finishList(outer);
    const encoded_length = writer.bytes().len + 1;
    var scratch: message.DecodeScratch = .{};
    const decoded = try message.Message.decode(encoded[0..encoded_length], &scratch);
    try std.testing.expectEqualSlices(u16, &.{256}, decoded.find_node.distances);

    const outbound = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .distances = &([_]u16{0} ** (types.distance_count + 1)),
    } };
    try std.testing.expectError(error.InvalidMessage, outbound.encode(&encoded));
}

fn expectMessageEqual(expected: *const message.Message, actual: *const message.Message) !void {
    try std.testing.expectEqual(std.meta.activeTag(expected.*), std.meta.activeTag(actual.*));
    switch (expected.*) {
        .ping => |value| try std.testing.expectEqualDeep(value, actual.ping),
        .pong => |value| try std.testing.expectEqualDeep(value, actual.pong),
        .find_node => |value| {
            try expectRequestIdEqual(value.request_id, actual.find_node.request_id);
            try std.testing.expectEqualSlices(u16, value.distances, actual.find_node.distances);
        },
        .nodes => |value| {
            try expectRequestIdEqual(value.request_id, actual.nodes.request_id);
            try std.testing.expectEqual(value.total, actual.nodes.total);
            for (value.enrs, actual.nodes.enrs) |expected_enr, actual_enr| {
                try std.testing.expectEqualSlices(u8, expected_enr, actual_enr);
            }
        },
        .talk_request => |value| {
            try expectRequestIdEqual(value.request_id, actual.talk_request.request_id);
            try std.testing.expectEqualSlices(u8, value.protocol, actual.talk_request.protocol);
            try std.testing.expectEqualSlices(u8, value.request, actual.talk_request.request);
        },
        .talk_response => |value| {
            try expectRequestIdEqual(value.request_id, actual.talk_response.request_id);
            try std.testing.expectEqualSlices(u8, value.response, actual.talk_response.response);
        },
    }
}

fn expectRequestIdEqual(expected: message.RequestId, actual: message.RequestId) !void {
    try std.testing.expectEqualSlices(u8, expected.slice(), actual.slice());
}
