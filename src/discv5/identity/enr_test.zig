const std = @import("std");
const crypto = @import("crypto.zig");
const enr = @import("enr.zig");
const types = @import("../types.zig");
const rlp_mod = @import("../wire/rlp.zig");

test "ENR content hash identifies signed fields independently of signature nonce" {
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
    const original = try enr.Record.create(&key, 7, .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } });
    const digest = try original.contentHash();
    var signature = try key.signPrehashed(digest, @splat(1));
    const scalar = std.crypto.ecc.Secp256k1.scalar;
    if (std.mem.readInt(u256, &signature.s, .big) > scalar.field_order / 2) {
        signature.s = try scalar.neg(signature.s, .big);
    }
    var outer = rlp_mod.Reader.init(original.slice());
    var fields = try outer.readList();
    const old_signature = try fields.readBytes();
    const offset = @intFromPtr(old_signature.ptr) - @intFromPtr(original.bytes[0..].ptr);
    const signature_bytes = signature.toBytes();
    try std.testing.expect(!std.mem.eql(u8, old_signature, &signature_bytes));
    var encoded = original.bytes;
    @memcpy(encoded[offset..][0..signature_bytes.len], &signature_bytes);
    const resigned = try enr.Record.init(encoded[0..original.length]);
    try std.testing.expectEqual(digest, try resigned.contentHash());
    const updated = try enr.Record.create(&key, 8, original.endpoint().?);
    try std.testing.expect(!std.mem.eql(u8, &digest, &try updated.contentHash()));
}

test "EIP-778 record validates signature identity and endpoint" {
    const text =
        "enr:-IS4QHCYrYZbAKWCBRlAy5zzaDZXJBGkcnh4MHcBFZntXNFrdvJjX04jRzjzCBOo" ++
        "nrkTfj499SZuOh8R33Ls8RRcy5wBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPK" ++
        "Y0yuDUmstAHYpMa2_oxVtw0RW_QAdpzBQA8yWM0xOIN1ZHCCdl8";
    const record = try enr.Record.initText(text);
    const expected_id = hexBytes(
        32,
        "a448f24c6d18e575453db13171562b71999873db5b286df957af199ec94617f7",
    );
    try std.testing.expectEqual(@as(u64, 1), record.sequence);
    try std.testing.expectEqual(expected_id, record.node_id);
    for (record.bytes[record.length..]) |byte| {
        try std.testing.expectEqual(@as(u8, 0), byte);
    }
    try std.testing.expectEqual(
        types.Address{ .ip4 = .{
            .octets = .{ 127, 0, 0, 1 },
            .port = 30_303,
        } },
        record.endpoint().?,
    );

    var tampered = record.bytes;
    tampered[record.length - 1] ^= 1;
    try std.testing.expectError(
        error.InvalidSignature,
        enr.Record.init(tampered[0..record.length]),
    );
}

test "EIP-778 record accepts unknown list values" {
    const text =
        "enr:-Ku4QB83BHEIa8uU6Q932c7EddcaxbDY-LlL_71dkEaHP3rPL4old52mYB8Oy-" ++
        "CuCrFKPiCcKpHFRFZ6jps6UmK7s82GAZ7PBP-ug2V0aMfGhAfJRi6AgmlkgnY0" ++
        "gmlwhKRGnbyJc2VjcDI1NmsxoQPNpMD5QcpDsSXoH4DyuU0vZoPAcrqYb8kD" ++
        "hpsh_hgmD4RzbmFwwIN0Y3CCdl2DdWRwgqBjhHVkcDaCdl0";
    const record = try enr.Record.initText(text);
    try std.testing.expectEqual(
        types.Address{ .ip4 = .{ .octets = .{ 164, 70, 157, 188 }, .port = 41_059 } },
        record.endpoint().?,
    );
}

test "EIP-778 record creation round-trips IPv4 and IPv6 endpoints" {
    const key_pair = try crypto.keyPairFromSecret(&([_]u8{0x42} ** 32));
    const endpoints = [_]types.Address{
        .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9_000 } },
        .{ .ip6 = .{
            .octets = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 },
            .port = 9_001,
        } },
    };
    for (endpoints) |endpoint| {
        const record = try enr.Record.create(&key_pair, 7, endpoint);
        try std.testing.expectEqualDeep(record, try enr.Record.init(record.slice()));
        try std.testing.expectEqual(@as(u64, 7), record.sequence);
        try std.testing.expectEqual(endpoint, record.endpoint().?);
        try std.testing.expectEqual(
            crypto.compressedPublicKey(&key_pair),
            record.public_key,
        );
    }

    try std.testing.expectError(
        error.InvalidRecord,
        enr.Record.create(
            &key_pair,
            1,
            .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 0 } },
        ),
    );
}

fn hexBytes(comptime length: usize, comptime encoded: []const u8) [length]u8 {
    var result: [length]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, encoded) catch unreachable;
    return result;
}

test "ENR generic fields preserve signed extensions and exact record boundary" {
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
    const public_key = crypto.compressedPublicKey(&key);
    const fields = [_]enr.Field{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "x", .value = .{ .raw = &.{0xc0} } },
    };
    const record = try enr.Record.createFields(&key, 7, &fields);
    try std.testing.expectEqualDeep(record, try enr.Record.init(record.slice()));
    try std.testing.expectEqualSlices(u8, &.{0xc0}, (try record.field("x")).?);
    try std.testing.expect((try record.field("missing")) == null);
    var changed = record;
    changed.bytes[changed.length - 1] = 0x80;
    try std.testing.expectError(error.InvalidSignature, enr.Record.init(changed.slice()));
    const other = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{2}));
    try std.testing.expectError(error.InvalidSignature, enr.Record.createFields(&other, 7, &fields));

    var padding: [200]u8 = @splat(1);
    var padded = fields;
    padded[2].value = .{ .bytes = padding[0..177] };
    const full = try enr.Record.createFields(&key, 7, &padded);
    try std.testing.expectEqual(@as(usize, 300), full.slice().len);
    padded[2].value = .{ .bytes = padding[0..178] };
    try std.testing.expectError(error.BufferTooSmall, enr.Record.createFields(&key, 7, &padded));
    try std.testing.expectError(error.InvalidRecord, enr.Record.createFields(&key, 7, &.{ fields[1], fields[0] }));
    try std.testing.expectError(error.InvalidRecord, enr.Record.createFields(&key, 7, &.{ fields[0], fields[0], fields[1] }));
}

test "ENR mapped IPv6 remains signed content but is not an operational endpoint" {
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
    const public_key = crypto.compressedPublicKey(&key);
    const mapped = [_]u8{0} ** 10 ++ [_]u8{ 0xff, 0xff, 192, 0, 2, 1 };
    const fields = [_]enr.Field{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &.{ 192, 0, 2, 2 } } },
        .{ .key = "ip6", .value = .{ .bytes = &mapped } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
        .{ .key = "udp6", .value = .{ .uint = 9001 } },
    };
    const record = try enr.Record.createFields(&key, 7, &fields);
    const parsed = try enr.Record.init(record.slice());
    try std.testing.expectEqualSlices(u8, record.slice(), parsed.slice());
    try std.testing.expectEqualSlices(u8, &mapped, (try parsed.fieldBytes("ip6")).?);
    try std.testing.expectEqual(try record.contentHash(), try parsed.contentHash());
    try std.testing.expectEqualDeep(types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 2 }, .port = 9000 } }, parsed.endpointFor(.dual).?);
    try std.testing.expectEqual(null, parsed.endpoints()[1]);
    try std.testing.expectEqual(null, parsed.endpointFor(.ip6));
    const no_fallback = try enr.Record.createFields(&key, 7, &.{ fields[0], fields[2], fields[3], fields[4], fields[5] });
    try std.testing.expectEqual(null, no_fallback.endpoint());
}

test "ENR generic raw extensions validate nested canonical RLP before signing" {
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{2}));
    const public_key = crypto.compressedPublicKey(&key);
    var fields = [_]enr.Field{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "x", .value = .{ .raw = &.{0xc0} } },
    };
    for ([_][]const u8{ &.{ 0xc1, 0xff }, &.{ 0xc2, 0xc1, 0xb8 }, &.{ 0xc2, 0x81, 0x01 }, &.{ 0xc3, 0xb8, 0x01, 0x80 }, &.{ 0xc3, 0xb9, 0, 56 }, &.{ 0xc2, 0xc2, 0x80 }, &.{ 0xc0, 0x80 } }) |raw| {
        fields[2].value = .{ .raw = raw };
        try std.testing.expectError(error.InvalidRecord, enr.Record.createFields(&key, 1, &fields));
    }
    for ([_][]const u8{ &.{0xc0}, &.{ 0xc4, 0xc2, 0x01, 0x80, 0xc0 }, &.{ 0xc3, 0xc2, 0xc1, 0x80 } }) |raw| {
        fields[2].value = .{ .raw = raw };
        const record = try enr.Record.createFields(&key, 1, &fields);
        try std.testing.expectEqualSlices(u8, raw, (try record.field("x")).?);
    }
}

// Literal signed malformed record retained from the independent review probe.
test "ENR verified record rejects signed malformed nested extension" {
    const bytes = hexBytes(122, "f878b840814e3ece4bf074b9bacac98322a3e4b6fe737c48105d59cf7a756fdf21e0cf9b6a0af549bad074a4c16948d4caa6d8d8529d383be1cc0d7bdbaa16d975c697380182696482763489736563703235366b31a102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee578c1ff");
    try std.testing.expectError(error.InvalidRecord, enr.Record.init(&bytes));
}

test "ENR nested raw extension reaches exact size bound without recursive parsing" {
    const rlp = @import("../wire/rlp.zig");
    var nested: [300]u8 = undefined;
    nested[0] = 0xc0;
    var length: usize = 1;
    for (0..115) |_| {
        var scratch: [300]u8 = undefined;
        var writer = rlp.Writer.init(&scratch);
        const mark = try writer.beginList();
        try writer.writeRawItem(nested[0..length]);
        writer.finishList(mark);
        length = writer.bytes().len;
        @memcpy(nested[0..length], writer.bytes());
    }
    try std.testing.expectEqual(@as(usize, 176), length);
    var extension: [300]u8 = undefined;
    var writer = rlp.Writer.init(&extension);
    const mark = try writer.beginList();
    try writer.writeRawItem(nested[0..length]);
    try writer.writeBytes(&.{});
    writer.finishList(mark);
    try std.testing.expectEqual(@as(usize, 179), writer.bytes().len);
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{2}));
    const public_key = crypto.compressedPublicKey(&key);
    const record = try enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "x", .value = .{ .raw = writer.bytes() } },
    });
    try std.testing.expectEqual(@as(usize, 300), record.slice().len);
    try std.testing.expectEqualSlices(u8, writer.bytes(), (try record.field("x")).?);
}
