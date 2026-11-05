const std = @import("std");
const pb = @import("../wire/protobuf.zig");
const keys = @import("../wire/keys.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Protocol = @import("../protocol.zig").Protocol;
const Set = @import("../capabilities.zig").Set;
const Address = @import("udp").Address;
const multiaddr = @import("../wire/multiaddr.zig");

pub const frame_max = 8192;
pub const encoded_frame_max = frame_max + pb.varintLen(frame_max);
pub const frames_max = 10;
pub const aggregate_max = frame_max * frames_max;
pub const Error = pb.Error || error{ InvalidField, FrameLimit, StringLimit, OccurrenceLimit, InvalidUtf8, InvalidKey, IdentityMismatch, Finished, InvalidAddress, BufferTooSmall };

fn Text(comptime capacity: usize) type {
    return struct {
        bytes: [capacity]u8 = @splat(0),
        len: u16 = 0,
        pub fn init(bytes: []const u8) Error!@This() {
            if (bytes.len > capacity) return error.StringLimit;
            if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
            var result: @This() = .{};
            @memcpy(result.bytes[0..bytes.len], bytes);
            result.len = @intCast(bytes.len);
            return result;
        }
        pub fn slice(self: *const @This()) []const u8 {
            return self.bytes[0..self.len];
        }
    };
}
pub const Metadata = struct {
    agent: ?Text(256) = null,
    protocol_version: ?Text(64) = null,
    protocols: Set = .initEmpty(),
};

pub const Local = struct {
    public_key: [keys.protobuf_length]u8,
    agent: Text(256),
    protocol_version: Text(64),
    addresses: [8]EncodedAddress = @splat(.{}),
    address_count: u8 = 0,

    const EncodedAddress = struct { bytes: [multiaddr.binary_length_max]u8 = @splat(0), len: u8 = 0 };

    pub fn validate(agent: []const u8, version: []const u8, addresses: []const Address) Error!void {
        _ = try @FieldType(Local, "agent").init(agent);
        _ = try @FieldType(Local, "protocol_version").init(version);
        var encoded: @FieldType(Local, "addresses") = undefined;
        try encodeAddresses(addresses, &encoded);
    }

    pub fn init(peer: *const PeerId, agent: []const u8, version: []const u8, addresses: []const Address) Error!Local {
        const key = peer.publicKey() catch return error.InvalidKey;
        var local: Local = .{ .public_key = key.encodeProtobuf(), .agent = try .init(agent), .protocol_version = try .init(version) };
        try local.setAddresses(addresses);
        return local;
    }

    pub fn setAddresses(self: *Local, addresses: []const Address) Error!void {
        var copied = self.addresses;
        try encodeAddresses(addresses, &copied);
        self.addresses = copied;
        self.address_count = @intCast(addresses.len);
    }

    fn encodeAddresses(addresses: []const Address, copied: *@FieldType(Local, "addresses")) Error!void {
        if (addresses.len > copied.len) return error.OccurrenceLimit;
        for (addresses, 0..) |address, i| {
            if (!address.isUsable()) return error.InvalidAddress;
            const encoded = (multiaddr.Multiaddr{ .address = address }).encode(&copied[i].bytes) catch return error.InvalidAddress;
            copied[i].len = @intCast(encoded.len);
        }
    }

    pub fn encode(self: *const Local, receive: Set, observed: ?Address, out: []u8) Error![]const u8 {
        var observed_storage: [multiaddr.binary_length_max]u8 = undefined;
        const observed_bytes: ?[]const u8 = if (observed) |address|
            (multiaddr.Multiaddr{ .address = address }).encode(&observed_storage) catch return error.InvalidAddress
        else
            null;
        var size = pb.bytesFieldSize(1, self.public_key.len) + pb.bytesFieldSize(5, self.protocol_version.len) + pb.bytesFieldSize(6, self.agent.len);
        if (observed_bytes) |bytes| size += pb.bytesFieldSize(4, bytes.len);
        for (self.addresses[0..self.address_count]) |address| size += pb.bytesFieldSize(2, address.len);
        var protocols = receive.iterator();
        while (protocols.next()) |protocol| size += pb.bytesFieldSize(3, protocol.id().len);
        if (size > frame_max) return error.FrameLimit;
        if (out.len < pb.varintLen(size) + size) return error.BufferTooSmall;
        var writer = pb.Writer.init(out);
        writer.varint(size);
        writer.bytesField(1, &self.public_key);
        for (self.addresses[0..self.address_count]) |address| writer.bytesField(2, address.bytes[0..address.len]);
        protocols = receive.iterator();
        while (protocols.next()) |protocol| writer.bytesField(3, protocol.id());
        if (observed_bytes) |bytes| writer.bytesField(4, bytes);
        writer.bytesField(5, self.protocol_version.slice());
        writer.bytesField(6, self.agent.slice());
        std.debug.assert(writer.len == pb.varintLen(size) + size);
        return writer.written();
    }
};

/// Merges protobuf fields without retaining slices into the reusable frame.
const Merge = struct {
    expected: PeerId,
    metadata: Metadata = .{},
    fields: usize = 0,
    protocols: usize = 0,

    fn visit(self: *Merge, frame_fields: *usize) Error!void {
        if (frame_fields.* == 128 or self.fields == 1024) return error.FieldLimit;
        frame_fields.* += 1;
        self.fields += 1;
    }

    fn message(self: *Merge, bytes: []const u8) Error!void {
        if (bytes.len > frame_max) return error.FrameLimit;
        var reader = pb.Reader.init(bytes);
        var fields: usize = 0;
        while (!reader.atEnd()) {
            try self.visit(&fields);
            const tag = try reader.tag();
            if (tag.field == 0) return error.InvalidField;
            if (tag.field == 3) {
                if (self.protocols == 64) return error.OccurrenceLimit;
                self.protocols += 1;
            }
            if (tag.wire != pb.wire_len) {
                try reader.skip(tag.wire);
                continue;
            }
            const value = try reader.lenDelimited();
            switch (tag.field) {
                1 => try self.publicKey(value, &fields),
                // Address hints are not retained; frame and field budgets bound skipping them.
                2, 4 => if (value.len > 1024) {
                    return error.StringLimit;
                },
                3 => {
                    if (value.len > 256) return error.StringLimit;
                    if (!std.unicode.utf8ValidateSlice(value)) return error.InvalidUtf8;
                    if (Protocol.fromId(value)) |protocol| self.metadata.protocols.insert(protocol);
                },
                5 => self.metadata.protocol_version = try .init(value),
                6 => self.metadata.agent = try .init(value),
                else => {},
            }
        }
    }

    fn publicKey(self: *Merge, bytes: []const u8, frame_fields: *usize) Error!void {
        if (bytes.len > 256) return error.InvalidKey;
        var reader = pb.Reader.init(bytes);
        var key_type: ?u64 = null;
        var data: ?[]const u8 = null;
        for (0..16) |_| {
            if (reader.atEnd()) break;
            try self.visit(frame_fields);
            const tag = try reader.tag();
            if (tag.field == 0) return error.InvalidField;
            switch (tag.field) {
                1 => if (tag.wire == pb.wire_varint) {
                    key_type = try reader.varint();
                } else try reader.skip(tag.wire),
                2 => if (tag.wire == pb.wire_len) {
                    data = try reader.lenDelimited();
                } else try reader.skip(tag.wire),
                else => try reader.skip(tag.wire),
            }
        }
        if (!reader.atEnd()) return error.FieldLimit;
        if (key_type != 2) return error.InvalidKey;
        const raw = data orelse return error.InvalidKey;
        if (raw.len != 33 and raw.len != 65) return error.InvalidKey;
        const point = std.crypto.sign.ecdsa.EcdsaSecp256k1Sha256.PublicKey.fromSec1(raw) catch return error.InvalidKey;
        const canonical: keys.PublicKey = .{ .bytes = point.toCompressedSec1() };
        const peer = PeerId.fromPublicKey(&canonical);
        if (!self.expected.eql(&peer)) return error.IdentityMismatch;
    }
};

pub const Decoder = struct {
    frame: [frame_max]u8 = undefined,
    merge: Merge,
    prefix_value: u64 = 0,
    prefix_len: u4 = 0,
    body_len: ?usize = null,
    filled: usize = 0,
    frames: usize = 0,
    aggregate: usize = 0,
    finished: bool = false,
    failed: bool = false,

    pub fn init(peer: *const PeerId) Decoder {
        return .{ .merge = .{ .expected = peer.* } };
    }

    pub fn feed(self: *Decoder, bytes: []const u8, fin: bool) Error!void {
        if (self.finished or self.failed) return error.Finished;
        errdefer self.failed = true;
        if (bytes.len > aggregate_max + 10 * frames_max) return error.FrameLimit;
        var pos: usize = 0;
        while (pos < bytes.len) {
            if (self.body_len == null) {
                if (self.frames == frames_max) return error.FrameLimit;
                const byte = bytes[pos];
                pos += 1;
                if (self.prefix_len == 9 and byte > 1) return error.Overflow;
                self.prefix_value |= @as(u64, byte & 0x7f) << @as(u6, @intCast(@as(u8, self.prefix_len) * 7));
                self.prefix_len += 1;
                if (byte & 0x80 != 0) continue;
                if (self.prefix_value > frame_max or self.prefix_value > aggregate_max - self.aggregate) return error.FrameLimit;
                self.body_len = @intCast(self.prefix_value);
                self.aggregate += @intCast(self.prefix_value);
            }
            const len = self.body_len.?;
            const count = @min(len - self.filled, bytes.len - pos);
            @memcpy(self.frame[self.filled..][0..count], bytes[pos..][0..count]);
            self.filled += count;
            pos += count;
            if (self.filled == len) {
                try self.merge.message(self.frame[0..len]);
                self.frames += 1;
                self.body_len = null;
                self.filled = 0;
                self.prefix_len = 0;
                self.prefix_value = 0;
            }
        }
        if (fin) {
            if (self.frames == 0 or self.body_len != null or self.prefix_len != 0) return error.Truncated;
            self.finished = true;
        }
    }

    pub fn result(self: *const Decoder) ?Metadata {
        return if (self.finished and !self.failed) self.merge.metadata else null;
    }
};

test {
    _ = @import("codec_test.zig");
}
