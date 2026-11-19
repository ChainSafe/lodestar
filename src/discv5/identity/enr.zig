//! An EIP-778 node record is bounded to 300 bytes. Only the identity scheme, key, IP, and UDP
//! pairs are interpreted. Every other pair is checked for order and kept as signed bytes.

const std = @import("std");
const crypto = @import("crypto.zig");
const types = @import("../types.zig");
const constants = @import("../wire/constants.zig");
const rlp = @import("../wire/rlp.zig");

const Keccak256 = std.crypto.hash.sha3.Keccak256;
const field_pairs_max: usize = constants.enr_size_max / 2;

pub const Error = rlp.Error || crypto.Error || error{
    InvalidRecord,
    TooManyFields,
    UnsupportedScheme,
};

pub const Field = struct {
    key: []const u8,
    value: Value,
    pub const Value = union(enum) { bytes: []const u8, uint: u64, raw: []const u8 };
};

/// An immutable authenticated ENR. Construct with init/initText for hostile bytes, or
/// create/createFields for local signing. Trusted callers must preserve bytes and cached fields
/// together; a copied Record retains the same contract. Authentication does not imply reachability.
pub const Record = struct {
    bytes: [constants.enr_size_max]u8,
    length: u16,
    sequence: u64,
    public_key: [33]u8,
    node_id: types.NodeId,
    ip4: ?[4]u8,
    ip6: ?[16]u8,
    udp: ?u16,
    udp6: ?u16,

    pub fn create(
        key_pair: *const crypto.KeyPair,
        sequence: u64,
        endpoint_value: types.Address,
    ) Error!Record {
        if (!endpoint_value.isUsable()) return error.InvalidRecord;
        const public_key = crypto.compressedPublicKey(key_pair);

        var content_buffer: [constants.enr_size_max]u8 = undefined;
        var content_writer = rlp.Writer.init(&content_buffer);
        const content = try content_writer.beginList();
        try writeFields(&content_writer, sequence, endpoint_value, &public_key);
        content_writer.finishList(content);
        var digest: [32]u8 = undefined;
        Keccak256.hash(content_writer.bytes(), &digest, .{});
        const signature = try crypto.sign(&digest, key_pair);

        var record_buffer: [constants.enr_size_max]u8 = undefined;
        var record_writer = rlp.Writer.init(&record_buffer);
        const record = try record_writer.beginList();
        try record_writer.writeBytes(&signature);
        try writeFields(&record_writer, sequence, endpoint_value, &public_key);
        record_writer.finishList(record);
        return fromSigned(record_writer.bytes(), key_pair);
    }

    /// Borrows a complete sorted field list, including id and secp256k1, for this call.
    pub fn createFields(key_pair: *const crypto.KeyPair, sequence: u64, fields: []const Field) Error!Record {
        if (fields.len > field_pairs_max) return error.TooManyFields;
        var content_buffer: [constants.enr_size_max]u8 = undefined;
        var content_writer = rlp.Writer.init(&content_buffer);
        const content = try content_writer.beginList();
        try writeGenericFields(&content_writer, sequence, fields);
        content_writer.finishList(content);
        var digest: [32]u8 = undefined;
        Keccak256.hash(content_writer.bytes(), &digest, .{});
        const signature = try crypto.sign(&digest, key_pair);
        var buffer: [constants.enr_size_max]u8 = undefined;
        var writer = rlp.Writer.init(&buffer);
        const outer = try writer.beginList();
        try writer.writeBytes(&signature);
        try writeGenericFields(&writer, sequence, fields);
        writer.finishList(outer);
        return fromSigned(writer.bytes(), key_pair);
    }

    /// Returns one encoded RLP value borrowed until this record is released.
    pub fn field(self: *const Record, key: []const u8) Error!?[]const u8 {
        var outer = rlp.Reader.init(self.slice());
        var list = try outer.readList();
        _ = try list.readBytes();
        _ = try list.readUint();
        for (0..field_pairs_max) |_| {
            if (list.atEnd()) return null;
            const name = try list.readBytes();
            const value = try list.readRawItem();
            switch (std.mem.order(u8, name, key)) {
                .eq => return value,
                .gt => return null,
                .lt => {},
            }
        }
        return error.TooManyFields;
    }

    pub fn fieldBytes(self: *const Record, key: []const u8) Error!?[]const u8 {
        return try decodeFieldBytes((try self.field(key)) orelse return null);
    }

    /// Parses and verifies a signed record. Keys must be unique and sorted, and the signature
    /// covers the RLP list of everything after it.
    pub fn init(data: []const u8) Error!Record {
        const parsed = try parse(data);
        var digest: [32]u8 = undefined;
        hashSignedPayload(parsed.signed_payload, &digest);
        const key = try crypto.verifyAndDecode(&digest, &parsed.signature, &parsed.public_key);
        return fromParsed(data, &parsed, &key);
    }

    /// Derives the claimed identity without authenticating the record. Only use it to reject
    /// irrelevant records before init; accepting one still requires signature verification.
    pub fn unverifiedNodeId(data: []const u8) Error!types.NodeId {
        const parsed = try parse(data);
        const key = crypto.PublicKey.fromSec1(&parsed.public_key) catch return error.InvalidPublicKey;
        const uncompressed = key.toUncompressedSec1();
        var node_id: types.NodeId = undefined;
        Keccak256.hash(uncompressed[1..], &node_id, .{});
        return node_id;
    }

    fn fromSigned(data: []const u8, key_pair: *const crypto.KeyPair) Error!Record {
        const parsed = try parse(data);
        if (!std.mem.eql(u8, &parsed.public_key, &crypto.compressedPublicKey(key_pair)))
            return error.InvalidSignature;
        return fromParsed(data, &parsed, &key_pair.public_key);
    }

    fn fromParsed(data: []const u8, parsed: *const Parsed, key: *const crypto.PublicKey) Record {
        const uncompressed = key.toUncompressedSec1();
        var node_id: types.NodeId = undefined;
        Keccak256.hash(uncompressed[1..], &node_id, .{});
        var record = Record{
            .bytes = [_]u8{0} ** constants.enr_size_max,
            .length = @intCast(data.len),
            .sequence = parsed.sequence,
            .public_key = parsed.public_key,
            .node_id = node_id,
            .ip4 = parsed.ip4,
            .ip6 = parsed.ip6,
            .udp = parsed.udp,
            .udp6 = parsed.udp6,
        };
        @memcpy(record.bytes[0..data.len], data);
        return record;
    }

    pub fn initText(text: []const u8) Error!Record {
        if (!std.mem.startsWith(u8, text, "enr:")) return error.InvalidRecord;
        const encoded = text[4..];
        const decoded_size = std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(encoded) catch
            return error.InvalidRecord;
        if (decoded_size > constants.enr_size_max) return error.InvalidRecord;
        var decoded: [constants.enr_size_max]u8 = undefined;
        std.base64.url_safe_no_pad.Decoder.decode(decoded[0..decoded_size], encoded) catch
            return error.InvalidRecord;
        return Record.init(decoded[0..decoded_size]);
    }

    pub fn slice(self: *const Record) []const u8 {
        std.debug.assert(self.length <= self.bytes.len);
        return self.bytes[0..self.length];
    }

    pub fn contentHash(self: *const Record) Error![32]u8 {
        var outer = rlp.Reader.init(self.slice());
        var fields = try outer.readList();
        _ = try fields.readBytes();
        var digest: [32]u8 = undefined;
        hashSignedPayload(fields.data[fields.position..], &digest);
        return digest;
    }

    /// Prefers the IPv4 endpoint. An IPv6 record uses `udp6` and falls back to `udp`, as the
    /// spec allows.
    pub fn endpoint(self: *const Record) ?types.Address {
        return self.endpointFor(.dual);
    }

    pub fn endpointFor(self: *const Record, mode: types.Mode) ?types.Address {
        for (self.endpoints()) |candidate| if (candidate) |address| {
            if (mode.supports(address) and address.isUsable()) return address;
        };
        return null;
    }

    pub fn endpoints(self: *const Record) [2]?types.Address {
        var result: [2]?types.Address = .{ null, null };
        if (self.ip4) |ip| if (self.udp) |port| {
            result[0] = .{ .ip4 = .{ .octets = ip, .port = port } };
        };
        if (self.ip6) |ip| if (self.udp6 orelse self.udp) |port| {
            if (!types.Address.isIp4Mapped(ip)) result[1] = .{ .ip6 = .{ .octets = ip, .port = port } };
        };
        return result;
    }
};

fn writeGenericFields(writer: *rlp.Writer, sequence: u64, fields: []const Field) Error!void {
    try writer.writeUint(sequence);
    var previous: ?[]const u8 = null;
    for (fields) |field_value| {
        if (previous) |key| {
            if (std.mem.order(u8, key, field_value.key) != .lt) return error.InvalidRecord;
        }
        previous = field_value.key;
        try writer.writeBytes(field_value.key);
        switch (field_value.value) {
            .bytes => |value| try writer.writeBytes(value),
            .uint => |value| try writer.writeUint(value),
            .raw => |value| {
                try validateRawItem(value);
                try writer.writeRawItem(value);
            },
        }
    }
}

// A byte bounds each entered item and each list exit. End offsets retain nesting without
// recursion; all offsets fit because a complete ENR has at most 300 bytes.
fn validateRawItem(encoded: []const u8) Error!void {
    if (encoded.len == 0 or encoded.len > constants.enr_size_max) return error.InvalidRecord;
    var outer = rlp.Reader.init(encoded);
    _ = outer.readRawItem() catch return error.InvalidRecord;
    if (!outer.atEnd()) return error.InvalidRecord;
    var ends: [constants.enr_size_max]u16 = undefined;
    ends[0] = @intCast(encoded.len);
    var depth: usize = 1;
    var position: usize = 0;
    for (0..2 * constants.enr_size_max + 1) |_| {
        if (depth == 0) return;
        const end = ends[depth - 1];
        std.debug.assert(position <= end);
        if (position == end) {
            depth -= 1;
            continue;
        }
        var reader = rlp.Reader.init(encoded[position..end]);
        const item = reader.readRawItem() catch return error.InvalidRecord;
        position += item.len;
        if (item[0] < 0xc0) continue;
        var list_reader = rlp.Reader.init(item);
        const children = list_reader.readList() catch return error.InvalidRecord;
        if (depth == ends.len) return error.InvalidRecord;
        ends[depth] = @intCast(position);
        depth += 1;
        position -= children.data.len;
    }
    return error.InvalidRecord;
}

fn writeFields(
    writer: *rlp.Writer,
    sequence: u64,
    endpoint_value: types.Address,
    public_key: *const [33]u8,
) rlp.Error!void {
    try writer.writeUint(sequence);
    try writer.writeBytes("id");
    try writer.writeBytes("v4");
    switch (endpoint_value) {
        .ip4 => |address| {
            try writer.writeBytes("ip");
            try writer.writeBytes(&address.octets);
        },
        .ip6 => |address| {
            try writer.writeBytes("ip6");
            try writer.writeBytes(&address.octets);
        },
    }
    try writer.writeBytes("secp256k1");
    try writer.writeBytes(public_key);
    switch (endpoint_value) {
        .ip4 => |address| {
            try writer.writeBytes("udp");
            try writer.writeUint(address.port);
        },
        .ip6 => |address| {
            try writer.writeBytes("udp6");
            try writer.writeUint(address.port);
        },
    }
}

const Parsed = struct {
    signature: [64]u8,
    signed_payload: []const u8,
    sequence: u64,
    public_key: [33]u8,
    ip4: ?[4]u8 = null,
    ip6: ?[16]u8 = null,
    udp: ?u16 = null,
    udp6: ?u16 = null,
};

fn parse(data: []const u8) Error!Parsed {
    if (data.len > constants.enr_size_max) return error.InvalidRecord;
    var outer = rlp.Reader.init(data);
    var list = outer.readList() catch return error.InvalidRecord;
    if (!outer.atEnd()) return error.InvalidRecord;
    const signature_bytes = list.readBytes() catch return error.InvalidRecord;
    if (signature_bytes.len != 64) return error.InvalidRecord;
    const signed_payload = list.data[list.position..];
    const sequence = list.readUint() catch return error.InvalidRecord;
    var parsed = Parsed{ .signature = signature_bytes[0..64].*, .signed_payload = signed_payload, .sequence = sequence, .public_key = undefined };
    var saw_public_key = false;
    var saw_v4 = false;
    var previous_key: ?[]const u8 = null;

    var fields: usize = 0;
    while (!list.atEnd() and fields < field_pairs_max) : (fields += 1) {
        const key = list.readBytes() catch return error.InvalidRecord;
        const value = list.readRawItem() catch return error.InvalidRecord;
        try validateRawItem(value);
        if (previous_key) |previous| {
            if (std.mem.order(u8, previous, key) != .lt) return error.InvalidRecord;
        }
        previous_key = key;
        try parseField(&parsed, key, value, &saw_public_key, &saw_v4);
    }
    if (!list.atEnd()) return error.TooManyFields;
    if (!saw_v4) return error.UnsupportedScheme;
    if (!saw_public_key) return error.InvalidRecord;

    return parsed;
}

fn parseField(
    parsed: *Parsed,
    key: []const u8,
    value: []const u8,
    saw_public_key: *bool,
    saw_v4: *bool,
) Error!void {
    if (std.mem.eql(u8, key, "id")) {
        const decoded = try decodeFieldBytes(value);
        if (!std.mem.eql(u8, decoded, "v4")) return error.UnsupportedScheme;
        saw_v4.* = true;
    } else if (std.mem.eql(u8, key, "secp256k1")) {
        const decoded = try decodeFieldBytes(value);
        if (decoded.len != 33) return error.InvalidRecord;
        parsed.public_key = decoded[0..33].*;
        saw_public_key.* = true;
    } else if (std.mem.eql(u8, key, "ip")) {
        const decoded = try decodeFieldBytes(value);
        if (decoded.len != 4) return error.InvalidRecord;
        parsed.ip4 = decoded[0..4].*;
    } else if (std.mem.eql(u8, key, "ip6")) {
        const decoded = try decodeFieldBytes(value);
        if (decoded.len != 16) return error.InvalidRecord;
        parsed.ip6 = decoded[0..16].*;
    } else if (std.mem.eql(u8, key, "udp")) {
        parsed.udp = try parsePort(try decodeFieldBytes(value));
    } else if (std.mem.eql(u8, key, "udp6")) {
        parsed.udp6 = try parsePort(try decodeFieldBytes(value));
    }
}

fn decodeFieldBytes(encoded: []const u8) Error![]const u8 {
    var reader = rlp.Reader.init(encoded);
    const decoded = reader.readBytes() catch return error.InvalidRecord;
    if (!reader.atEnd()) return error.InvalidRecord;
    return decoded;
}

fn parsePort(bytes: []const u8) Error!u16 {
    if (bytes.len > 2) return error.InvalidRecord;
    if (bytes.len > 0 and bytes[0] == 0) return error.InvalidRecord;
    var value: u16 = 0;
    for (bytes) |byte| value = (value << 8) | byte;
    return value;
}

// The signed content is the record list without its signature, so the list prefix has to be
// rebuilt for the shorter payload.
fn hashSignedPayload(payload: []const u8, digest: *[32]u8) void {
    std.debug.assert(payload.len <= constants.enr_size_max);
    var prefix: [9]u8 = undefined;
    const prefix_length = rlp.listPrefix(&prefix, payload.len);
    var hasher = Keccak256.init(.{});
    hasher.update(prefix[0..prefix_length]);
    hasher.update(payload);
    hasher.final(digest);
}

comptime {
    std.debug.assert(field_pairs_max == 150);
    std.debug.assert(@sizeOf(Record) <= 448);
}

test {
    _ = @import("enr_test.zig");
}
