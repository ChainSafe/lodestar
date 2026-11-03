//! The packet codec handles header masking, the three packet forms, and AES-GCM sealing.
//! Decoding checks structure only and never proves who sent a packet.

const std = @import("std");
const constants = @import("constants.zig");
const types = @import("../types.zig");

const Aes128 = std.crypto.core.aes.Aes128;
const Aes128Gcm = std.crypto.aead.aes_gcm.Aes128Gcm;
const protocol_id = "discv5";
const version: u16 = 1;

pub const Error = error{
    BufferTooSmall,
    DecryptionFailed,
    InvalidAuthdata,
    InvalidFlag,
    InvalidPacket,
    InvalidProtocolId,
    UnsupportedVersion,
};

pub const Flag = enum(u8) {
    message = 0,
    whoareyou = 1,
    handshake = 2,
};

pub const StaticHeader = struct {
    flag: Flag,
    nonce: [constants.nonce_size]u8,
    authdata_size: u16,
};

pub const HandshakeAuthdata = struct {
    source_id: types.NodeId,
    id_signature: *const [constants.id_signature_size]u8,
    ephemeral_key: *const [constants.ephemeral_key_size]u8,
    enr: ?[]const u8,
};

pub const Form = union(Flag) {
    message: struct { source_id: types.NodeId },
    whoareyou: struct {
        id_nonce: [constants.id_nonce_size]u8,
        enr_sequence: u64,
    },
    handshake: HandshakeAuthdata,
};

pub const Packet = struct {
    masking_iv: [constants.masking_iv_size]u8,
    header: []const u8,
    static_header: StaticHeader,
    ciphertext: []const u8,
    form: Form,
};

pub const DecodeScratch = struct {
    header: [constants.header_size_max]u8 = undefined,
};

pub const DecryptScratch = struct {
    associated_data: [constants.associated_data_size_max]u8 = undefined,
    plaintext: [constants.ordinary_plaintext_size_max]u8 = undefined,
};

pub const MessageArgs = struct {
    masking_iv: *const [constants.masking_iv_size]u8,
    recipient_id: *const types.NodeId,
    nonce: *const [constants.nonce_size]u8,
    write_key: *const [16]u8,
    plaintext: []const u8,
};

pub const OrdinaryArgs = struct {
    packet: MessageArgs,
    source_id: *const types.NodeId,
};

pub const HandshakeArgs = struct {
    packet: MessageArgs,
    authdata: []const u8,
};

pub const WhoareyouArgs = struct {
    masking_iv: *const [constants.masking_iv_size]u8,
    recipient_id: *const types.NodeId,
    request_nonce: *const [constants.nonce_size]u8,
    id_nonce: *const [constants.id_nonce_size]u8,
    enr_sequence: u64,
};

pub const HandshakeAuthdataArgs = struct {
    source_id: *const types.NodeId,
    id_signature: *const [constants.id_signature_size]u8,
    ephemeral_key: *const [constants.ephemeral_key_size]u8,
    enr: []const u8,
};

/// Input must not overlap scratch. The result borrows raw and scratch until either is reused.
/// Every call may overwrite scratch, including calls that fail.
pub fn decode(
    raw: []const u8,
    recipient_id: *const types.NodeId,
    scratch: *DecodeScratch,
) Error!Packet {
    try validatePacketSize(raw.len);
    const masking_iv = raw[0..constants.masking_iv_size].*;
    var static_header_bytes: [constants.static_header_size]u8 = undefined;
    @memcpy(
        &static_header_bytes,
        raw[constants.masking_iv_size..][0..constants.static_header_size],
    );
    aesCtr(recipient_id[0..constants.masking_iv_size], &masking_iv, &static_header_bytes);
    const static_header = try parseStaticHeader(&static_header_bytes);
    const header_size = std.math.add(
        usize,
        constants.static_header_size,
        static_header.authdata_size,
    ) catch return error.InvalidPacket;
    if (header_size > constants.header_size_max) return error.InvalidAuthdata;
    const message_offset = constants.masking_iv_size + header_size;
    if (message_offset > raw.len) return error.InvalidPacket;

    const header = &scratch.header;
    @memcpy(header[0..header_size], raw[constants.masking_iv_size..message_offset]);
    aesCtr(recipient_id[0..constants.masking_iv_size], &masking_iv, header[0..header_size]);
    const authdata = header[constants.static_header_size..header_size];
    const ciphertext = raw[message_offset..];
    try validateForm(static_header.flag, authdata, ciphertext.len, raw.len);

    return .{
        .masking_iv = masking_iv,
        .header = scratch.header[0..header_size],
        .static_header = static_header,
        .ciphertext = ciphertext,
        .form = parseForm(static_header.flag, authdata),
    };
}

/// Packet storage must not overlap scratch. Only success publishes authenticated plaintext.
/// Every call may overwrite scratch and invalidates previously returned plaintext.
pub fn decrypt(
    packet: *const Packet,
    read_key: *const [16]u8,
    scratch: *DecryptScratch,
) Error![]const u8 {
    if (packet.static_header.flag == .whoareyou) return error.InvalidPacket;
    if (packet.ciphertext.len < constants.gcm_tag_size) return error.DecryptionFailed;
    const plaintext_length = packet.ciphertext.len - constants.gcm_tag_size;
    if (plaintext_length > constants.ordinary_plaintext_size_max) return error.InvalidPacket;
    const associated_data_length = constants.masking_iv_size + packet.header.len;
    if (associated_data_length > scratch.associated_data.len) return error.InvalidPacket;

    const associated_data = scratch.associated_data[0..associated_data_length];
    @memcpy(associated_data[0..constants.masking_iv_size], &packet.masking_iv);
    @memcpy(associated_data[constants.masking_iv_size..], packet.header);
    const ciphertext = packet.ciphertext[0..plaintext_length];
    const tag = packet.ciphertext[plaintext_length..][0..constants.gcm_tag_size].*;
    const plaintext = scratch.plaintext[0..plaintext_length];
    errdefer std.crypto.secureZero(u8, plaintext);
    Aes128Gcm.decrypt(
        plaintext,
        ciphertext,
        tag,
        associated_data,
        packet.static_header.nonce,
        read_key.*,
    ) catch return error.DecryptionFailed;
    return plaintext;
}

pub fn encodeOrdinary(out: []u8, args: OrdinaryArgs) Error![]u8 {
    return encodeMessage(out, .message, args.source_id, args.packet);
}

pub fn ordinaryPacketLength(plaintext_length: usize) Error!usize {
    if (plaintext_length > constants.ordinary_plaintext_size_max)
        return error.InvalidPacket;
    return constants.ordinary_packet_overhead + plaintext_length;
}

pub fn encodeHandshake(out: []u8, args: HandshakeArgs) Error![]u8 {
    try validateHandshakeAuthdata(args.authdata);
    return encodeMessage(out, .handshake, args.authdata, args.packet);
}

pub fn handshakePlaintextCapacity(enr_length: usize) Error!usize {
    if (enr_length > constants.enr_size_max) return error.InvalidAuthdata;
    return constants.handshake_plaintext_size_max - enr_length;
}

/// Writes the packet before masking into `challenge_data_out`, because both sides feed those
/// bytes into key agreement and the identity proof.
pub fn encodeWhoareyou(
    out: []u8,
    args: WhoareyouArgs,
    challenge_data_out: ?*[constants.whoareyou_packet_size]u8,
) Error![]u8 {
    var authdata: [constants.whoareyou_authdata_size]u8 = undefined;
    @memcpy(authdata[0..constants.id_nonce_size], args.id_nonce);
    std.mem.writeInt(
        u64,
        authdata[constants.id_nonce_size..constants.whoareyou_authdata_size],
        args.enr_sequence,
        .big,
    );
    try validateForm(.whoareyou, &authdata, 0, constants.whoareyou_packet_size);
    if (out.len < constants.whoareyou_packet_size) return error.BufferTooSmall;
    const encoded = out[0..constants.whoareyou_packet_size];
    @memcpy(encoded[0..constants.masking_iv_size], args.masking_iv);
    const header = encoded[constants.masking_iv_size..];
    writeHeader(header, .whoareyou, args.request_nonce, &authdata);
    if (challenge_data_out) |challenge_data| @memcpy(challenge_data, encoded);
    aesCtr(args.recipient_id[0..constants.masking_iv_size], args.masking_iv, header);
    return encoded;
}

pub fn buildHandshakeAuthdata(
    out: []u8,
    args: HandshakeAuthdataArgs,
) Error![]u8 {
    if (args.enr.len > constants.enr_size_max) return error.InvalidAuthdata;
    const total = constants.handshake_authdata_size_min + args.enr.len;
    if (out.len < total) return error.BufferTooSmall;
    const authdata = out[0..total];
    @memcpy(authdata[0..constants.node_id_size], args.source_id);
    authdata[constants.node_id_size] = constants.id_signature_size;
    authdata[constants.node_id_size + 1] = constants.ephemeral_key_size;
    const signature_end = constants.handshake_authdata_head_size +
        constants.id_signature_size;
    @memcpy(
        authdata[constants.handshake_authdata_head_size..signature_end],
        args.id_signature,
    );
    const ephemeral_key_end = signature_end + constants.ephemeral_key_size;
    @memcpy(authdata[signature_end..ephemeral_key_end], args.ephemeral_key);
    @memcpy(authdata[ephemeral_key_end..], args.enr);
    return authdata;
}

fn encodeMessage(
    out: []u8,
    flag: Flag,
    authdata: []const u8,
    args: MessageArgs,
) Error![]u8 {
    const header_size = constants.static_header_size + authdata.len;
    const message_offset = constants.masking_iv_size + header_size;
    const tag_offset = std.math.add(usize, message_offset, args.plaintext.len) catch
        return error.InvalidPacket;
    const packet_size = std.math.add(usize, tag_offset, constants.gcm_tag_size) catch
        return error.InvalidPacket;
    const ciphertext_size = std.math.add(
        usize,
        args.plaintext.len,
        constants.gcm_tag_size,
    ) catch return error.InvalidPacket;
    try validateForm(flag, authdata, ciphertext_size, packet_size);
    if (out.len < packet_size) return error.BufferTooSmall;

    const encoded = out[0..packet_size];
    @memcpy(encoded[0..constants.masking_iv_size], args.masking_iv);
    const header = encoded[constants.masking_iv_size..message_offset];
    writeHeader(header, flag, args.nonce, authdata);
    const ciphertext = encoded[message_offset..tag_offset];
    var tag: [constants.gcm_tag_size]u8 = undefined;
    Aes128Gcm.encrypt(
        ciphertext,
        &tag,
        args.plaintext,
        encoded[0..message_offset],
        args.nonce.*,
        args.write_key.*,
    );
    @memcpy(encoded[tag_offset..], &tag);
    aesCtr(args.recipient_id[0..constants.masking_iv_size], args.masking_iv, header);
    return encoded;
}

fn parseStaticHeader(bytes: *const [constants.static_header_size]u8) Error!StaticHeader {
    if (!std.mem.eql(u8, bytes[0..protocol_id.len], protocol_id))
        return error.InvalidProtocolId;
    if (std.mem.readInt(u16, bytes[6..8], .big) != version)
        return error.UnsupportedVersion;
    const flag: Flag = switch (bytes[8]) {
        0 => .message,
        1 => .whoareyou,
        2 => .handshake,
        else => return error.InvalidFlag,
    };
    return .{
        .flag = flag,
        .nonce = bytes[9..21].*,
        .authdata_size = std.mem.readInt(u16, bytes[21..23], .big),
    };
}

fn validateForm(
    flag: Flag,
    authdata: []const u8,
    ciphertext_size: usize,
    packet_size: usize,
) Error!void {
    try validatePacketSize(packet_size);
    switch (flag) {
        .message => {
            if (authdata.len != constants.node_id_size) return error.InvalidAuthdata;
            if (ciphertext_size < constants.gcm_tag_size) return error.InvalidPacket;
        },
        .whoareyou => {
            if (authdata.len != constants.whoareyou_authdata_size)
                return error.InvalidAuthdata;
            if (ciphertext_size != 0) return error.InvalidPacket;
        },
        .handshake => {
            try validateHandshakeAuthdata(authdata);
            if (ciphertext_size < constants.gcm_tag_size) return error.InvalidPacket;
        },
    }
}

fn validateHandshakeAuthdata(authdata: []const u8) Error!void {
    if (authdata.len < constants.handshake_authdata_size_min)
        return error.InvalidAuthdata;
    if (authdata.len > constants.handshake_authdata_size_max)
        return error.InvalidAuthdata;
    if (authdata[constants.node_id_size] != constants.id_signature_size)
        return error.InvalidAuthdata;
    if (authdata[constants.node_id_size + 1] != constants.ephemeral_key_size)
        return error.InvalidAuthdata;
}

fn parseForm(flag: Flag, authdata: []const u8) Form {
    return switch (flag) {
        .message => .{ .message = .{ .source_id = authdata[0..32].* } },
        .whoareyou => .{ .whoareyou = .{
            .id_nonce = authdata[0..constants.id_nonce_size].*,
            .enr_sequence = std.mem.readInt(
                u64,
                authdata[constants.id_nonce_size..constants.whoareyou_authdata_size],
                .big,
            ),
        } },
        .handshake => .{ .handshake = parseHandshakeAuthdata(authdata) },
    };
}

fn parseHandshakeAuthdata(authdata: []const u8) HandshakeAuthdata {
    const signature_start = constants.handshake_authdata_head_size;
    const signature_end = signature_start + constants.id_signature_size;
    const ephemeral_key_end = signature_end + constants.ephemeral_key_size;
    return .{
        .source_id = authdata[0..constants.node_id_size].*,
        .id_signature = authdata[signature_start..][0..constants.id_signature_size],
        .ephemeral_key = authdata[signature_end..][0..constants.ephemeral_key_size],
        .enr = if (authdata.len == ephemeral_key_end) null else authdata[ephemeral_key_end..],
    };
}

fn validatePacketSize(packet_size: usize) Error!void {
    if (packet_size < constants.packet_size_min) return error.InvalidPacket;
    if (packet_size > constants.packet_size_max) return error.InvalidPacket;
}

fn writeHeader(
    out: []u8,
    flag: Flag,
    nonce: *const [constants.nonce_size]u8,
    authdata: []const u8,
) void {
    const header_size = constants.static_header_size + authdata.len;
    std.debug.assert(header_size <= out.len);
    std.debug.assert(authdata.len <= std.math.maxInt(u16));
    @memcpy(out[0..protocol_id.len], protocol_id);
    std.mem.writeInt(u16, out[6..8], version, .big);
    out[8] = @intFromEnum(flag);
    @memcpy(out[9..21], nonce);
    std.mem.writeInt(u16, out[21..23], @intCast(authdata.len), .big);
    @memcpy(out[constants.static_header_size..header_size], authdata);
}

// Header masking is AES-128-CTR keyed by the first 16 bytes of the recipient's node ID. It hides
// the packet structure from anyone who does not know the destination node.
fn aesCtr(key: *const [16]u8, iv: *const [16]u8, bytes: []u8) void {
    std.debug.assert(bytes.len <= constants.header_size_max);
    const aes = Aes128.initEnc(key.*);
    var counter = iv.*;
    var offset: usize = 0;
    while (offset < bytes.len) {
        var keystream: [16]u8 = undefined;
        aes.encrypt(&keystream, &counter);
        incrementCounter(&counter);
        const block_size = @min(keystream.len, bytes.len - offset);
        for (bytes[offset..][0..block_size], keystream[0..block_size]) |*byte, mask| {
            byte.* ^= mask;
        }
        offset += block_size;
    }
    std.debug.assert(offset == bytes.len);
}

fn incrementCounter(counter: *[16]u8) void {
    var index: usize = counter.len;
    while (index > 0) {
        index -= 1;
        counter[index] +%= 1;
        if (counter[index] != 0) break;
    }
}

comptime {
    std.debug.assert(@sizeOf(Packet) <= 160);
    std.debug.assert(@sizeOf(Form) <= 96);
    std.debug.assert(@sizeOf(DecodeScratch) < 512);
    std.debug.assert(@sizeOf(DecryptScratch) < 2 * 1_024);
}

test {
    _ = @import("packet_test.zig");
}
