const std = @import("std");
const constants = @import("constants.zig");
const packet = @import("packet.zig");

test "ordinary packets round-trip without mutating input during decode" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const source_id = [_]u8{0x22} ** constants.node_id_size;
    const masking_iv = [_]u8{0x33} ** constants.masking_iv_size;
    const nonce = [_]u8{0x44} ** constants.nonce_size;
    const key = [_]u8{0x55} ** 16;
    var raw: [constants.packet_size_max]u8 = undefined;
    const encoded = try packet.encodeOrdinary(&raw, .{
        .packet = .{
            .masking_iv = &masking_iv,
            .recipient_id = &recipient_id,
            .nonce = &nonce,
            .write_key = &key,
            .plaintext = "bounded plaintext",
        },
        .source_id = &source_id,
    });
    var before: [constants.packet_size_max]u8 = undefined;
    @memcpy(before[0..encoded.len], encoded);

    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(encoded, &recipient_id, &decode_scratch);
    try std.testing.expectEqualSlices(u8, before[0..encoded.len], encoded);
    try std.testing.expectEqual(packet.Flag.message, decoded.static_header.flag);
    try std.testing.expectEqual(source_id, decoded.form.message.source_id);

    var decrypt_scratch: packet.DecryptScratch = .{};
    const plaintext = try packet.decrypt(&decoded, &key, &decrypt_scratch);
    try std.testing.expectEqualSlices(u8, "bounded plaintext", plaintext);
}

test "WHOAREYOU returns the unmasked challenge data" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const masking_iv = [_]u8{0x22} ** constants.masking_iv_size;
    const request_nonce = [_]u8{0x33} ** constants.nonce_size;
    const id_nonce = [_]u8{0x44} ** constants.id_nonce_size;
    var raw: [constants.whoareyou_packet_size]u8 = undefined;
    var challenge: [constants.whoareyou_packet_size]u8 = undefined;
    const encoded = try packet.encodeWhoareyou(&raw, .{
        .masking_iv = &masking_iv,
        .recipient_id = &recipient_id,
        .request_nonce = &request_nonce,
        .id_nonce = &id_nonce,
        .enr_sequence = 7,
    }, &challenge);
    try std.testing.expectEqualSlices(u8, &masking_iv, challenge[0..16]);
    try std.testing.expectEqualSlices(u8, "discv5", challenge[16..22]);
    try std.testing.expect(!std.mem.eql(u8, challenge[16..], encoded[16..]));

    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(encoded, &recipient_id, &decode_scratch);
    try std.testing.expectEqual(packet.Flag.whoareyou, decoded.static_header.flag);
    try std.testing.expectEqual(id_nonce, decoded.form.whoareyou.id_nonce);
    try std.testing.expectEqual(@as(u64, 7), decoded.form.whoareyou.enr_sequence);
}

test "handshake authdata and optional ENR round-trip" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const source_id = [_]u8{0x22} ** constants.node_id_size;
    const signature = [_]u8{0x33} ** constants.id_signature_size;
    const ephemeral_key = [_]u8{0x44} ** constants.ephemeral_key_size;
    const masking_iv = [_]u8{0x55} ** constants.masking_iv_size;
    const nonce = [_]u8{0x66} ** constants.nonce_size;
    const key = [_]u8{0x77} ** 16;
    const enr = [_]u8{ 0x83, 'e', 'n', 'r' };
    var authdata_buffer: [constants.handshake_authdata_size_max]u8 = undefined;
    const authdata = try packet.buildHandshakeAuthdata(&authdata_buffer, .{
        .source_id = &source_id,
        .id_signature = &signature,
        .ephemeral_key = &ephemeral_key,
        .enr = &enr,
    });
    var raw: [constants.packet_size_max]u8 = undefined;
    const encoded = try packet.encodeHandshake(&raw, .{
        .packet = .{
            .masking_iv = &masking_iv,
            .recipient_id = &recipient_id,
            .nonce = &nonce,
            .write_key = &key,
            .plaintext = "handshake message",
        },
        .authdata = authdata,
    });

    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(encoded, &recipient_id, &decode_scratch);
    try std.testing.expectEqual(source_id, decoded.form.handshake.source_id);
    try std.testing.expectEqual(signature, decoded.form.handshake.id_signature.*);
    try std.testing.expectEqual(ephemeral_key, decoded.form.handshake.ephemeral_key.*);
    try std.testing.expectEqualSlices(u8, &enr, decoded.form.handshake.enr.?);
    raw[constants.masking_iv_size + constants.static_header_size + constants.node_id_size] ^= 1;
    try std.testing.expectError(error.InvalidAuthdata, packet.decode(encoded, &recipient_id, &decode_scratch));
}

test "authentication failure does not publish plaintext" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const source_id = [_]u8{0x22} ** constants.node_id_size;
    const masking_iv = [_]u8{0x33} ** constants.masking_iv_size;
    const nonce = [_]u8{0x44} ** constants.nonce_size;
    const key = [_]u8{0x55} ** 16;
    const wrong_key = [_]u8{0x56} ** 16;
    var raw: [constants.packet_size_max]u8 = undefined;
    const encoded = try packet.encodeOrdinary(&raw, .{
        .packet = .{
            .masking_iv = &masking_iv,
            .recipient_id = &recipient_id,
            .nonce = &nonce,
            .write_key = &key,
            .plaintext = "secret",
        },
        .source_id = &source_id,
    });
    var decode_scratch: packet.DecodeScratch = .{};
    const decoded = try packet.decode(encoded, &recipient_id, &decode_scratch);
    var decrypt_scratch: packet.DecryptScratch = .{};

    try std.testing.expectError(
        error.DecryptionFailed,
        packet.decrypt(&decoded, &wrong_key, &decrypt_scratch),
    );
    try std.testing.expectEqualStrings("secret", try packet.decrypt(&decoded, &key, &decrypt_scratch));
}

test "packet decode recovers after invalid framing" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const masking_iv = [_]u8{0x22} ** constants.masking_iv_size;
    const request_nonce = [_]u8{0x33} ** constants.nonce_size;
    const id_nonce = [_]u8{0x44} ** constants.id_nonce_size;
    var raw: [constants.whoareyou_packet_size]u8 = undefined;
    _ = try packet.encodeWhoareyou(&raw, .{
        .masking_iv = &masking_iv,
        .recipient_id = &recipient_id,
        .request_nonce = &request_nonce,
        .id_nonce = &id_nonce,
        .enr_sequence = 7,
    }, null);
    raw[constants.masking_iv_size] ^= 1;
    var decode_scratch: packet.DecodeScratch = .{};

    try std.testing.expectError(
        error.InvalidProtocolId,
        packet.decode(&raw, &recipient_id, &decode_scratch),
    );
    raw[constants.masking_iv_size] ^= 1;
    const valid = try packet.decode(&raw, &recipient_id, &decode_scratch);
    try std.testing.expectEqual(@as(u64, 7), valid.form.whoareyou.enr_sequence);
}

test "packet size and handshake bounds fail before output mutation" {
    const recipient_id = [_]u8{0x11} ** constants.node_id_size;
    const source_id = [_]u8{0x22} ** constants.node_id_size;
    const masking_iv = [_]u8{0x33} ** constants.masking_iv_size;
    const nonce = [_]u8{0x44} ** constants.nonce_size;
    const key = [_]u8{0x55} ** 16;
    const oversized = [_]u8{0} ** (constants.ordinary_plaintext_size_max + 1);
    var raw = [_]u8{0xa5} ** constants.packet_size_max;
    const before = raw;

    try std.testing.expectError(error.InvalidPacket, packet.encodeOrdinary(&raw, .{
        .packet = .{
            .masking_iv = &masking_iv,
            .recipient_id = &recipient_id,
            .nonce = &nonce,
            .write_key = &key,
            .plaintext = &oversized,
        },
        .source_id = &source_id,
    }));
    try std.testing.expectEqualSlices(u8, &before, &raw);
}

test "handshake plaintext capacity accounts for the transmitted ENR" {
    try std.testing.expectEqual(
        constants.handshake_plaintext_size_max,
        try packet.handshakePlaintextCapacity(0),
    );
    try std.testing.expectEqual(
        @as(usize, 794),
        try packet.handshakePlaintextCapacity(constants.enr_size_max),
    );
    try std.testing.expectError(
        error.InvalidAuthdata,
        packet.handshakePlaintextCapacity(constants.enr_size_max + 1),
    );
}
