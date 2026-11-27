const std = @import("std");
const codec = @import("codec.zig");
const keys = @import("../wire/keys.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const types = @import("../types.zig");
const capabilities = @import("../capabilities.zig");
const protocol = @import("../reqresp/protocol.zig");
const protocol_mod = @import("../gossipsub/protocol.zig");
const Multiaddr = @import("../wire/multiaddr.zig").Multiaddr;
const protobuf = @import("../wire/protobuf.zig");
fn identity() !PeerId {
    const key = try keys.PublicKey.fromBytes(&.{ 0x02, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87, 0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16, 0xf8, 0x17, 0x98 });
    return PeerId.fromPublicKey(&key);
}
test "identify independent unknown protocol and empty agent publish only at FIN" {
    const peer = try identity();
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(&.{ 7, 0x1a, 3, '/', 'x', '/', 0x32, 0 }, false);
    try std.testing.expect(decoder.result() == null);
    try decoder.feed(&.{}, true);
    const result = decoder.result().?;
    try std.testing.expectEqualStrings("", result.agent.?.slice());
    try std.testing.expectEqual(@as(u8, 0), result.protocols.count());
    try std.testing.expect(result.protocol_version == null);
    try std.testing.expectError(error.Finished, decoder.feed(&.{0}, false));
    try std.testing.expectEqualDeep(result, decoder.result().?);
}

test "identify independent fragmented noncanonical prefix and coalesced frames" {
    const peer = try identity();
    const bytes = [_]u8{ 0x82, 0, 0x32, 0, 2, 0x2a, 0 };
    for (0..bytes.len + 1) |split| {
        var decoder = codec.Decoder.init(&peer);
        try decoder.feed(bytes[0..split], false);
        try std.testing.expect(decoder.result() == null);
        try decoder.feed(bytes[split..], true);
        try std.testing.expectEqualStrings("", decoder.result().?.protocol_version.?.slice());
    }
    var decoder = codec.Decoder.init(&peer);
    for (&bytes) |byte| try decoder.feed(&.{byte}, false);
    try decoder.feed(&.{}, true);
    try std.testing.expect(decoder.result() != null);
}

test "identify rejects malformed framing and protobuf without publication" {
    const peer = try identity();
    const Case = struct { bytes: []const u8, err: codec.Error };
    const cases = [_]Case{
        .{ .bytes = &.{}, .err = error.Truncated },
        .{ .bytes = &.{0x80}, .err = error.Truncated },
        .{ .bytes = &.{ 2, 0x32 }, .err = error.Truncated },
        .{ .bytes = &.{ 1, 0 }, .err = error.InvalidField },
        .{ .bytes = &.{ 1, 0x4b }, .err = error.BadWireType },
        .{ .bytes = &.{ 0x81, 0x40 }, .err = error.FrameLimit },
        .{ .bytes = &.{ 3, 0x32, 1, 0xff }, .err = error.InvalidUtf8 },
        .{ .bytes = &.{ 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2 }, .err = error.Overflow },
        .{ .bytes = &.{ 11, 0x48, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2 }, .err = error.Overflow },
    };
    for (cases) |case| {
        var decoder = codec.Decoder.init(&peer);
        try std.testing.expectError(case.err, decoder.feed(case.bytes, true));
        try std.testing.expect(decoder.result() == null);
    }
}

test "identify canonical key and reordered uncompressed equivalent bind full identity" {
    const peer = try identity();
    const key = try peer.publicKey();
    const canonical = key.encodeProtobuf();
    var frame: [258]u8 = undefined;
    frame[0] = 39;
    frame[1] = 0x0a;
    frame[2] = 37;
    @memcpy(frame[3..40], &canonical);
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(frame[0..40], true);
    const point = try std.crypto.sign.ecdsa.EcdsaSecp256k1Sha256.PublicKey.fromSec1(&key.bytes);
    const uncompressed = point.toUncompressedSec1();
    frame[0] = 73;
    frame[1] = 0x0a;
    frame[2] = 71;
    frame[3] = 0x12;
    frame[4] = 65;
    @memcpy(frame[5..70], &uncompressed);
    @memcpy(frame[70..74], &[_]u8{ 0x48, 0, 0x08, 2 });
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(frame[0..74], true);
    var other = peer;
    other.bytes[6] = 3;
    decoder = codec.Decoder.init(&other);
    try std.testing.expectError(error.IdentityMismatch, decoder.feed(frame[0..74], true));
    try std.testing.expect(decoder.result() == null);
}

test "identify ten maximum frames use one buffer and bound aggregate" {
    const peer = try identity();
    var frame: [codec.encoded_frame_max]u8 = @splat(0);
    frame[0] = 0x80;
    frame[1] = 0x40;
    frame[2] = 0x42;
    frame[3] = 0xfd;
    frame[4] = 0x3f;
    var decoder = codec.Decoder.init(&peer);
    for (0..10) |_| try decoder.feed(&frame, false);
    try std.testing.expectEqual(@as(usize, 81920), decoder.aggregate);
    try decoder.feed(&.{}, true);
    try std.testing.expect(decoder.result() != null);
    decoder = codec.Decoder.init(&peer);
    for (0..10) |_| try decoder.feed(&.{0}, false);
    try std.testing.expectError(error.FrameLimit, decoder.feed(&.{0}, true));
}

fn fieldFrame(out: []u8, field: u32, value: []const u8, occurrences: usize) []const u8 {
    const pb = @import("../wire/protobuf.zig");
    var writer = pb.Writer.init(out);
    writer.varint(pb.bytesFieldSize(field, value.len) * occurrences);
    for (0..occurrences) |_| writer.bytesField(field, value);
    return writer.written();
}

test "identify enforces exact string and occurrence bounds including ignored addresses" {
    const peer = try identity();
    var frame: [codec.encoded_frame_max]u8 = undefined;
    const Cases = struct { field: u32, cap: usize };
    for ([_]Cases{ .{ .field = 6, .cap = 256 }, .{ .field = 5, .cap = 64 }, .{ .field = 3, .cap = 256 }, .{ .field = 2, .cap = 1024 }, .{ .field = 4, .cap = 1024 } }) |case| {
        const bytes: [1025]u8 = @splat('x');
        var decoder = codec.Decoder.init(&peer);
        try decoder.feed(fieldFrame(&frame, case.field, bytes[0..case.cap], 1), true);
        decoder = codec.Decoder.init(&peer);
        try std.testing.expectError(error.StringLimit, decoder.feed(fieldFrame(&frame, case.field, bytes[0 .. case.cap + 1], 1), true));
    }
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 3, "", 64), true);
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 3, "", 64), false);
    try std.testing.expectError(error.OccurrenceLimit, decoder.feed(fieldFrame(&frame, 3, "", 1), true));
}

test "identify accepts many listen addresses plus an observed address without losing identity or protocols" {
    const peer = try identity();
    const key = (try peer.publicKey()).encodeProtobuf();
    const pb = @import("../wire/protobuf.zig");
    const address = [_]u8{ 4, 127, 0, 0, 1, 0x91, 2, 0x23, 0x29, 0xcd, 3 };
    for ([_]usize{ 32, 34 }) |listen_count| {
        var body: [1024]u8 = undefined;
        var writer = pb.Writer.init(&body);
        for (0..listen_count) |_| writer.bytesField(2, &address);
        writer.bytesField(4, &address);
        writer.bytesField(1, &key);
        writer.bytesField(3, "/ipfs/id/1.0.0");
        writer.bytesField(6, "compatible-peer");
        var frame: [1026]u8 = undefined;
        var framed = pb.Writer.init(&frame);
        framed.varint(writer.written().len);
        framed.bytes(writer.written());
        var decoder = codec.Decoder.init(&peer);
        for (framed.written()) |byte| try decoder.feed(&.{byte}, false);
        try std.testing.expect(decoder.result() == null);
        try decoder.feed(&.{}, true);
        try std.testing.expectEqualStrings("compatible-peer", decoder.result().?.agent.?.slice());
        try std.testing.expect(decoder.result().?.protocols.contains(.identify));
        var other = peer;
        other.bytes[6] = 3;
        decoder = codec.Decoder.init(&other);
        try std.testing.expectError(error.IdentityMismatch, decoder.feed(framed.written(), true));
    }
}

test "identify bounds all field visits and accepts unknown protobuf wire forms" {
    const peer = try identity();
    var frame: [300]u8 = undefined;
    for ([_]u32{ 2, 4, 9 }) |field| {
        const bytes = fieldFrame(&frame, field, "", 128);
        var decoder = codec.Decoder.init(&peer);
        for (0..8) |_| try decoder.feed(bytes, false);
        try decoder.feed(&.{}, true);
        decoder = codec.Decoder.init(&peer);
        for (0..8) |_| try decoder.feed(bytes, false);
        try std.testing.expectError(error.FieldLimit, decoder.feed(&.{ 2, 0x48, 0 }, true));
        decoder = codec.Decoder.init(&peer);
        try std.testing.expectError(error.FieldLimit, decoder.feed(fieldFrame(&frame, field, "", 129), true));
    }
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(&.{ 20, 0x48, 0, 0x49, 0, 0, 0, 0, 0, 0, 0, 0, 0x4d, 0, 0, 0, 0, 0x4a, 2, 1, 2 }, true);
}

test "identify repeated scalar fields use last valid occurrence and merge known protocols" {
    const peer = try identity();
    var frame: [1024]u8 = undefined;
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 6, "old", 1), false);
    try decoder.feed(fieldFrame(&frame, 6, "", 1), false);
    try decoder.feed(fieldFrame(&frame, 3, "/ipfs/id/1.0.0", 2), true);
    try std.testing.expectEqualStrings("", decoder.result().?.agent.?.slice());
    try std.testing.expect(decoder.result().?.protocols.contains(.identify));
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 6, "valid", 1), false);
    try std.testing.expectError(error.InvalidUtf8, decoder.feed(fieldFrame(&frame, 6, &.{0xff}, 1), true));
    try std.testing.expect(decoder.result() == null);
}

test "identify validates every key and bounds semantic key envelope" {
    const peer = try identity();
    const key = (try peer.publicKey()).encodeProtobuf();
    var frame: [codec.encoded_frame_max]u8 = undefined;
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 1, &key, 1), false);
    var wrong = key;
    wrong[4] = 3;
    try std.testing.expectError(error.IdentityMismatch, decoder.feed(fieldFrame(&frame, 1, &wrong, 1), false));
    try std.testing.expectError(error.Finished, decoder.feed(fieldFrame(&frame, 1, &key, 1), true));
    var envelope: [257]u8 = @splat(0);
    decoder = codec.Decoder.init(&peer);
    try std.testing.expectError(error.InvalidKey, decoder.feed(fieldFrame(&frame, 1, &envelope, 1), true));
    const pb = @import("../wire/protobuf.zig");
    var writer = pb.Writer.init(&envelope);
    for (0..14) |_| writer.varintField(9, 0);
    writer.bytesField(2, key[4..]);
    writer.varintField(1, 2);
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 1, writer.written(), 1), true);
    writer.varintField(9, 0);
    decoder = codec.Decoder.init(&peer);
    try std.testing.expectError(error.FieldLimit, decoder.feed(fieldFrame(&frame, 1, writer.written(), 1), true));
    writer = pb.Writer.init(&envelope);
    writer.varintField(1, 7);
    writer.bytesField(2, "invalid");
    writer.bytesField(2, key[4..]);
    writer.varintField(1, 2);
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 1, writer.written(), 1), true);
    writer.varintField(1, 3);
    decoder = codec.Decoder.init(&peer);
    try std.testing.expectError(error.InvalidKey, decoder.feed(fieldFrame(&frame, 1, writer.written(), 1), true));
}

test "identify encoder uses canonical identity copied binary QUIC addresses and receive only" {
    const peer = try identity();
    var addresses = [_]types.Address{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } }};
    var local = try codec.Local.init(&peer, "stock", "ipfs/0.1.0", &addresses);
    addresses[0].ip4.port = 1;
    var protocols: capabilities.Set = .initEmpty();
    protocols.insert(.identify);
    var frame: [codec.encoded_frame_max]u8 = undefined;
    const bytes = try local.encode(protocols, null, &frame);
    const expected = [_]u8{ 0x0a, 37 } ++ (try peer.publicKey()).encodeProtobuf() ++ [_]u8{ 0x12, 11, 4, 127, 0, 0, 1, 0x91, 2, 0x23, 0x28, 0xcd, 3, 0x1a, 14 } ++ "/ipfs/id/1.0.0".* ++ [_]u8{ 0x2a, 10 } ++ "ipfs/0.1.0".* ++ [_]u8{ 0x32, 5 } ++ "stock".*;
    try std.testing.expectEqualSlices(u8, &expected, bytes[1..]);
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(bytes, true);
    try std.testing.expectEqualStrings("stock", decoder.result().?.agent.?.slice());
    try std.testing.expectError(error.BufferTooSmall, local.encode(protocols, null, &.{}));
    const previous = local;
    try std.testing.expectError(error.InvalidAddress, local.setAddresses(&.{.{ .ip4 = .{ .octets = @splat(0), .port = 9000 } }}));
    try std.testing.expectEqualDeep(previous, local);
}

test "identify maximum key envelope and advertisement respect all exact local bounds" {
    const peer = try identity();
    const key = (try peer.publicKey()).encodeProtobuf();
    var envelope: [256]u8 = undefined;
    const pb = @import("../wire/protobuf.zig");
    var writer = pb.Writer.init(&envelope);
    writer.bytes(&key);
    writer.bytesField(9, &([_]u8{0} ** 216));
    try std.testing.expectEqual(@as(usize, 256), writer.len);
    var frame: [codec.encoded_frame_max]u8 = undefined;
    var decoder = codec.Decoder.init(&peer);
    try decoder.feed(fieldFrame(&frame, 1, writer.written(), 1), true);
    const malformed = [_]u8{ 8, 2, 18, 33 } ++ [_]u8{0} ** 33;
    decoder = codec.Decoder.init(&peer);
    try std.testing.expectError(error.InvalidKey, decoder.feed(fieldFrame(&frame, 1, &malformed, 1), true));
    const address: types.Address = .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 9000 } };
    const addresses: [9]types.Address = @splat(address);
    var local = try codec.Local.init(&peer, &([_]u8{'a'} ** 256), &([_]u8{'v'} ** 64), addresses[0..8]);
    var protocols: capabilities.Set = .initEmpty();
    protocols.insert(.identify);
    for (std.enums.values(protocol.Protocol)) |which| protocols.insert(.{ .reqresp = which });
    for (std.enums.values(protocol_mod.Version)) |version| protocols.insert(.{ .meshsub = version });
    const encoded = try local.encode(protocols, null, &frame);
    try std.testing.expect(encoded.len <= codec.encoded_frame_max);
    decoder = codec.Decoder.init(&peer);
    try decoder.feed(encoded, true);
    try std.testing.expectEqual(protocols, decoder.result().?.protocols);
    const previous = local;
    try std.testing.expectError(error.OccurrenceLimit, local.setAddresses(&addresses));
    try std.testing.expectEqualDeep(previous, local);
}

test "identify includes the current observed QUIC endpoint" {
    const peer = try identity();
    const local = try codec.Local.init(&peer, "stock", "ipfs/0.1.0", &.{});
    const endpoint: types.Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 10 }, .port = 9010 } };
    var frame: [codec.encoded_frame_max]u8 = undefined;
    const bytes = try local.encode(.initEmpty(), endpoint, &frame);
    var reader = protobuf.Reader.init(bytes);
    _ = try reader.varint();
    var observed: usize = 0;
    for (0..128) |_| {
        if (reader.atEnd()) break;
        const tag = try reader.tag();
        if (tag.field == 4) {
            const value = try Multiaddr.decode(try reader.lenDelimited());
            try std.testing.expect(value.address.eql(endpoint));
            observed += 1;
        } else try reader.skip(tag.wire);
    }
    try std.testing.expect(reader.atEnd());
    try std.testing.expectEqual(@as(usize, 1), observed);
}

test "identify rejects scoped listen and observed addresses without changing local advertisement" {
    const peer = try identity();
    const endpoint: types.Address = .{ .ip6 = .{ .octets = .{ 0xfe, 0x80 } ++ .{0} ** 13 ++ .{1}, .port = 9000, .interface = 7 } };
    var local = try codec.Local.init(&peer, "stock", "ipfs/0.1.0", &.{});
    const previous = local;
    try std.testing.expectError(error.InvalidAddress, codec.Local.validate("stock", "ipfs/0.1.0", &.{endpoint}));
    try std.testing.expectError(error.InvalidAddress, local.setAddresses(&.{endpoint}));
    try std.testing.expectEqualDeep(previous, local);
    var frame: [codec.encoded_frame_max]u8 = undefined;
    try std.testing.expectError(error.InvalidAddress, local.encode(.initEmpty(), endpoint, &frame));
}
