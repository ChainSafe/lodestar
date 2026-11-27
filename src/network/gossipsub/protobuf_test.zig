const Message = @import("protobuf.zig").Message;
const Reader = @import("protobuf.zig").Reader;
const RpcReader = @import("protobuf.zig").RpcReader;
const Writer = @import("protobuf.zig").Writer;
const beginIdontwantRpc = @import("protobuf.zig").beginIdontwantRpc;
const beginIhaveRpc = @import("protobuf.zig").beginIhaveRpc;
const beginIwantRpc = @import("protobuf.zig").beginIwantRpc;
const bytesFieldSize = pb.bytesFieldSize;
const graftRpcSize = @import("protobuf.zig").graftRpcSize;
const idontwantRpcSize = @import("protobuf.zig").idontwantRpcSize;
const ihaveRpcSize = @import("protobuf.zig").ihaveRpcSize;
const iwantRpcSize = @import("protobuf.zig").iwantRpcSize;
const pruneRpcSize = @import("protobuf.zig").pruneRpcSize;
const std = @import("std");
const varintLen = @import("protobuf.zig").varintLen;
const wire_len = @import("protobuf.zig").wire_len;
const writeGraftRpc = @import("protobuf.zig").writeGraftRpc;
const writeIdontwantId = @import("protobuf.zig").writeIdontwantId;
const writeIhaveId = @import("protobuf.zig").writeIhaveId;
const writeIwantId = @import("protobuf.zig").writeIwantId;
const writeMessage = @import("protobuf.zig").writeMessage;
const writePruneRpc = @import("protobuf.zig").writePruneRpc;
const writeSubscription = @import("protobuf.zig").writeSubscription;
const pb = @import("../wire/protobuf.zig");

test "protobuf round trips an idontwant control rpc" {
    var buf: [64]u8 = undefined;
    var w = Writer.init(&buf);
    beginIdontwantRpc(&w, 1, 20);
    writeIdontwantId(&w, "id090000000000000000");
    try std.testing.expectEqual(idontwantRpcSize(1, 20), w.len);
    var reader = RpcReader.init(w.written());
    const item = (try reader.next()).?;
    var ids = item.idontwant.ids();
    try std.testing.expectEqualStrings("id090000000000000000", (try ids.next()).?);
}

test "protobuf round trips ihave and iwant control rpcs" {
    var buf: [256]u8 = undefined;
    var w = Writer.init(&buf);
    beginIhaveRpc(&w, "t", 2, 20);
    writeIhaveId(&w, "id010000000000000000");
    writeIhaveId(&w, "id020000000000000000");
    try std.testing.expectEqual(ihaveRpcSize("t", 2, 20), w.len);
    var reader = RpcReader.init(w.written());
    const ihave = (try reader.next()).?;
    try std.testing.expectEqualStrings("t", ihave.ihave.topic);
    var ids = ihave.ihave.ids();
    try std.testing.expectEqualStrings("id010000000000000000", (try ids.next()).?);
    try std.testing.expectEqualStrings("id020000000000000000", (try ids.next()).?);

    w = Writer.init(&buf);
    beginIwantRpc(&w, 1, 20);
    writeIwantId(&w, "id030000000000000000");
    try std.testing.expectEqual(iwantRpcSize(1, 20), w.len);
    reader = RpcReader.init(w.written());
    const iwant = (try reader.next()).?;
    var wids = iwant.iwant.ids();
    try std.testing.expectEqualStrings("id030000000000000000", (try wids.next()).?);
}

test "protobuf round trips graft and prune control rpcs" {
    var buf: [128]u8 = undefined;
    var w = Writer.init(&buf);
    writeGraftRpc(&w, "topic_a");
    try std.testing.expectEqual(graftRpcSize("topic_a"), w.len);
    var reader = RpcReader.init(w.written());
    const graft = (try reader.next()).?;
    try std.testing.expectEqualStrings("topic_a", graft.graft);
    try std.testing.expect((try reader.next()) == null);

    w = Writer.init(&buf);
    writePruneRpc(&w, "topic_b", 60);
    try std.testing.expectEqual(pruneRpcSize("topic_b", 60), w.len);
    reader = RpcReader.init(w.written());
    const prune = (try reader.next()).?;
    try std.testing.expectEqualStrings("topic_b", prune.prune.topic);
    try std.testing.expectEqual(@as(u64, 60), prune.prune.backoff);
}

test "protobuf round trips an RPC with subscriptions, messages, and control" {
    var buf: [512]u8 = undefined;
    var w = Writer.init(&buf);
    writeSubscription(&w, true, "topic_a");
    writeMessage(&w, "payload", "topic_a");
    // control: graft topic_a, then idontwant [id1,id2]
    const graft_content = bytesFieldSize(1, "topic_a".len);
    const idontwant_content = bytesFieldSize(1, 20) + bytesFieldSize(1, 20);
    const control_content = bytesFieldSize(3, graft_content) + bytesFieldSize(5, idontwant_content);
    w.tag(3, wire_len);
    w.varint(control_content);
    w.tag(3, wire_len);
    w.varint(graft_content);
    w.bytesField(1, "topic_a");
    w.tag(5, wire_len);
    w.varint(idontwant_content);
    w.bytesField(1, "aaa00000000000000000");
    w.bytesField(1, "bbb00000000000000000");

    var reader = RpcReader.init(w.written());
    const sub = (try reader.next()).?;
    try std.testing.expect(sub.subscription.subscribe);
    try std.testing.expectEqualStrings("topic_a", sub.subscription.topic);
    const msg = (try reader.next()).?;
    try std.testing.expectEqualStrings("payload", msg.message.data);
    try std.testing.expectEqualStrings("topic_a", msg.message.topic);
    try std.testing.expect(!msg.message.signed);
    const graft = (try reader.next()).?;
    try std.testing.expectEqualStrings("topic_a", graft.graft);
    const idontwant = (try reader.next()).?;
    var ids = idontwant.idontwant.ids();
    try std.testing.expectEqualStrings("aaa00000000000000000", (try ids.next()).?);
    try std.testing.expectEqualStrings("bbb00000000000000000", (try ids.next()).?);
    try std.testing.expect((try ids.next()) == null);
    try std.testing.expect((try reader.next()) == null);
}

test "protobuf decodes ihave and iwant ids" {
    var buf: [256]u8 = undefined;
    var w = Writer.init(&buf);
    const ihave_content = bytesFieldSize(1, "t".len) + bytesFieldSize(2, 20) + bytesFieldSize(2, 20);
    const iwant_content = bytesFieldSize(1, 20);
    const control_content = bytesFieldSize(1, ihave_content) + bytesFieldSize(2, iwant_content);
    w.tag(3, wire_len);
    w.varint(control_content);
    w.tag(1, wire_len);
    w.varint(ihave_content);
    w.bytesField(1, "t");
    w.bytesField(2, "id010000000000000000");
    w.bytesField(2, "id020000000000000000");
    w.tag(2, wire_len);
    w.varint(iwant_content);
    w.bytesField(1, "id030000000000000000");

    var reader = RpcReader.init(w.written());
    const ihave = (try reader.next()).?;
    try std.testing.expectEqualStrings("t", ihave.ihave.topic);
    var hids = ihave.ihave.ids();
    try std.testing.expectEqualStrings("id010000000000000000", (try hids.next()).?);
    try std.testing.expectEqualStrings("id020000000000000000", (try hids.next()).?);
    try std.testing.expect((try hids.next()) == null);
    const iwant = (try reader.next()).?;
    var wids = iwant.iwant.ids();
    try std.testing.expectEqualStrings("id030000000000000000", (try wids.next()).?);
}

test "protobuf rejects truncated and malformed input" {
    try std.testing.expectError(error.Truncated, blk: {
        var r = Reader.init(&[_]u8{0x80});
        break :blk r.varint();
    });
    try std.testing.expectError(error.Overflow, blk: {
        var r = Reader.init(&([_]u8{0x80} ** 11));
        break :blk r.varint();
    });
    try std.testing.expectError(error.Truncated, blk: {
        var r = Reader.init(&[_]u8{ 0x0a, 0x05, 0x01 }); // len 5, only 1 byte
        break :blk r.lenDelimited();
    });
}

test "protobuf varintLen matches the encoded width" {
    var buf: [16]u8 = undefined;
    for ([_]u64{ 0, 1, 127, 128, 300, 16_384, std.math.maxInt(u64) }) |value| {
        var w = Writer.init(&buf);
        w.varint(value);
        try std.testing.expectEqual(w.len, varintLen(value));
        var r = Reader.init(w.written());
        try std.testing.expectEqual(value, try r.varint());
    }
}

test "protobuf rejects field numbers outside the protobuf range" {
    var r = Reader.init(&.{ 0x80, 0x80, 0x80, 0x80, 0x80, 0x01 });
    try std.testing.expectError(error.InvalidField, r.tag());
}

test "protobuf rejects a field carrying an unexpected wire type" {
    var buf: [64]u8 = undefined;
    var w = Writer.init(&buf);
    w.varintField(1, 12_345);
    writeSubscription(&w, true, "topic_a");
    var reader = RpcReader.init(w.written());
    try std.testing.expectError(error.BadWireType, reader.next());
}

test "gossip protobuf extension skipping remains budgeted before dispatch" {
    var bytes: [8192]u8 = undefined;
    for (0..4096) |i| @memcpy(bytes[i * 2 ..][0..2], &[_]u8{ 0x38, 0 });
    var rpc = RpcReader.init(&bytes);
    var fields: usize = 1;
    try std.testing.expectEqual(RpcReader.Step.deferred, try rpc.step(&fields));
    try std.testing.expectEqual(@as(usize, 0), rpc.top.cursor.pos);
    try std.testing.expect((try rpc.next()) == null);
}

test "gossip protobuf prevalidation preserves a deferred dispatch cursor" {
    var encoded: [256]u8 = undefined;
    var w = Writer.init(&encoded);
    writeMessage(&w, "data", "topic");
    var rpc = RpcReader.init(w.written());
    var fields: usize = 1;
    try std.testing.expectEqual(RpcReader.Step.deferred, try rpc.step(&fields));
    try std.testing.expectEqual(@as(usize, 0), rpc.top.cursor.pos);
    fields = 16385;
    const result = try rpc.step(&fields);
    try std.testing.expectEqualStrings("data", (try rpc.decode(result.item, &.{})).message.data);
}

test "protobuf rejects overflowing tenth varint byte" {
    var reader = Reader.init(&.{ 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2 });
    try std.testing.expectError(error.Overflow, reader.varint());
}
