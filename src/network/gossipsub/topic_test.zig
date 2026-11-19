const ForkDigest = @import("topic.zig").ForkDigest;
const MessageIdPolicy = @import("topic.zig").MessageIdPolicy;
const build = @import("topic.zig").build;
fn expect(comptime hex: []const u8) MessageId {
    var out: MessageId = undefined;
    _ = std.fmt.hexToBytes(&out, hex) catch unreachable;
    return out;
}
const invalidMessageId = @import("topic.zig").invalidMessageId;
const parse = @import("topic.zig").parse;
const phase0_policy = MessageIdPolicy{ .phase0_digest = .{ 1, 2, 3, 4 } };
const std = @import("std");
const topic_max_len = @import("topic.zig").topic_max_len;
const validMessageId = @import("topic.zig").validMessageId;
const vector_other_topic = "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy";
const vector_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const MessageId = @import("topic.zig").MessageId;

test "topic builds and round trips through parse" {
    var buf: [topic_max_len]u8 = undefined;
    const digest = ForkDigest{ 0x6a, 0x95, 0xa1, 0xa9 };
    const topic = build(digest, "beacon_block", &buf);
    try std.testing.expectEqualStrings("/eth2/6a95a1a9/beacon_block/ssz_snappy", topic);
    const parsed = parse(topic).?;
    try std.testing.expectEqual(digest, parsed.digest);
    try std.testing.expectEqualStrings("beacon_block", parsed.name);

    var sub: [topic_max_len]u8 = undefined;
    const columns = build(digest, "data_column_sidecar_127", &sub);
    try std.testing.expectEqualStrings("data_column_sidecar_127", parse(columns).?.name);
}

test "topic parse rejects malformed strings" {
    try std.testing.expect(parse("/eth2/6a95a1a9/beacon_block/ssz") == null);
    try std.testing.expect(parse("/eth1/6a95a1a9/beacon_block/ssz_snappy") == null);
    try std.testing.expect(parse("/eth2/zzzzzzzz/beacon_block/ssz_snappy") == null);
    try std.testing.expect(parse("/eth2/6a95a1/beacon_block/ssz_snappy") == null);
    try std.testing.expect(parse("/eth2/6a95a1a9//ssz_snappy") == null);
    try std.testing.expect(parse("") == null);
}

test "message id preserves the configured Phase0 domain and twenty byte truncation" {
    const valid = validMessageId(vector_topic, "hello", phase0_policy);
    const invalid = invalidMessageId(vector_topic, "hello", phase0_policy);
    try std.testing.expectEqual(expect("79d62a59d0e47597aeb73cb85ba034c3f67f90e8"), valid);
    try std.testing.expectEqual(expect("44c0a0d0ddc9808a27834e778f82623f9c897072"), invalid);
    const empty = validMessageId(vector_topic, "", phase0_policy);
    try std.testing.expectEqual(expect("67abdd721024f0ff4e0b3f4c2fc13bc5bad42d0b"), empty);
    try std.testing.expect(!std.mem.eql(u8, &valid, &invalid));
    try std.testing.expectEqual(
        expect("a0960f8d63bfe4fce6c26ae9e33f8f2d2729239a"),
        invalidMessageId(vector_topic, &.{0xff}, phase0_policy),
    );
    try std.testing.expectEqual(valid, validMessageId(vector_other_topic, "hello", phase0_policy));
}

test "message id includes the Altair topic length and bytes" {
    try std.testing.expectEqual(
        expect("a9fe6ab574e2aac2f18a37d95a6250a6e0f5b583"),
        validMessageId(vector_topic, "hello", .{}),
    );
}

test "message id includes the topic for invalid Snappy" {
    try std.testing.expectEqual(
        expect("a28c11a9057a41e968c2c3eead4b4c9fdd39c0d0"),
        invalidMessageId(vector_topic, &.{0xff}, .{}),
    );
}

test "message id separates modern topics when Phase0 is configured" {
    const policy = MessageIdPolicy{ .phase0_digest = .{ 9, 8, 7, 6 } };
    try std.testing.expectEqual(
        expect("a9fe6ab574e2aac2f18a37d95a6250a6e0f5b583"),
        validMessageId(vector_topic, "hello", policy),
    );
    try std.testing.expectEqual(
        expect("da00350732db6a43c1f625bf287c9a136f6dfc75"),
        validMessageId(vector_other_topic, "hello", policy),
    );
    try std.testing.expectEqual(
        expect("6e01bb6dbc25bf015fe1884bae6973aff4614ddf"),
        invalidMessageId(vector_other_topic, &.{0xff}, policy),
    );
}

test "topic accepts the aggregate and proof protocol name" {
    try std.testing.expect(parse(vector_other_topic) != null);
    var out: [topic_max_len]u8 = undefined;
    try std.testing.expectEqualStrings(
        vector_other_topic,
        build(.{ 1, 2, 3, 4 }, "beacon_aggregate_and_proof", &out),
    );
}
