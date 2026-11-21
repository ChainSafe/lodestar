const std = @import("std");
const enr = @import("identity/enr.zig");
const PendingResponse = @import("PendingResponse.zig");
const types = @import("types.zig");
const constants = @import("wire/constants.zig");
const message = @import("wire/message.zig");
const test_support = @import("test_support.zig");

const fakeEndpoint = test_support.fakeEndpoint;

test "an unprepared response is complete and yields nothing" {
    const response = PendingResponse{};
    var raw: PendingResponse.RawRecords = undefined;
    try std.testing.expect(response.complete());
    try std.testing.expect(response.next(&raw) == null);
}

test "empty NODES response is one packet" {
    var response: PendingResponse = .{};
    try response.prepareNodes(
        fakeEndpoint(0x11, 9_001),
        try message.RequestId.init(&.{0x01}),
        0,
    );
    var raw: PendingResponse.RawRecords = undefined;
    const next = response.next(&raw).?;
    try std.testing.expectEqual(@as(u64, 1), next.nodes.total);
    try std.testing.expectEqual(@as(usize, 0), next.nodes.enrs.len);
    response.advance();
    try std.testing.expect(response.complete());
    try std.testing.expect(response.next(&raw) == null);
}

test "maximum ENRs are fragmented by encoded size" {
    var response: PendingResponse = .{};
    for (&response.records) |*record| record.* = maximumRecord();
    try response.prepareNodes(
        fakeEndpoint(0x11, 9_001),
        try message.RequestId.init(&.{0x01}),
        response.records.len,
    );

    var packet_count: usize = 0;
    var record_count: usize = 0;
    var raw: PendingResponse.RawRecords = undefined;
    var retry_raw: PendingResponse.RawRecords = undefined;
    while (response.next(&raw)) |next| {
        const retry = response.next(&retry_raw).?;
        try std.testing.expectEqual(next.nodes.enrs.len, retry.nodes.enrs.len);
        var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
        _ = try next.encode(&encoded);
        try std.testing.expect(next.nodes.total > 1);
        try std.testing.expect(next.nodes.enrs.len > 0);
        packet_count += 1;
        record_count += next.nodes.enrs.len;
        response.advance();
    }
    try std.testing.expect(response.complete());
    try std.testing.expectEqual(response.records.len, record_count);
    try std.testing.expectEqual(@as(usize, 6), packet_count);
}

test "PONG reports the authenticated source address" {
    var response: PendingResponse = .{};
    const peer = types.Endpoint{
        .node_id = [_]u8{0x11} ** 32,
        .address = .{ .ip6 = .{
            .octets = [_]u8{0x22} ** 16,
            .port = 9_001,
        } },
    };
    response.preparePong(
        peer,
        try message.RequestId.init(&.{0x01}),
        7,
    );
    var raw: PendingResponse.RawRecords = undefined;
    const next = response.next(&raw).?;
    try std.testing.expectEqual(@as(u64, 7), next.pong.enr_sequence);
    try std.testing.expectEqual(@as(u16, 9_001), next.pong.recipient_port);
    try std.testing.expectEqual([_]u8{0x22} ** 16, next.pong.recipient_ip.ip6);
    response.advance();
    try std.testing.expect(response.complete());
}

fn maximumRecord() enr.Record {
    var record: enr.Record = undefined;
    @memset(&record.bytes, 0);
    record.length = constants.enr_size_max;
    record.bytes[0] = 0xf9;
    std.mem.writeInt(
        u16,
        record.bytes[1..3],
        constants.enr_size_max - 3,
        .big,
    );
    return record;
}
