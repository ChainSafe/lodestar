//! A minimal RLP codec over caller-owned buffers. The writer reserves three bytes for each list
//! prefix and shifts the payload back once the length is known, so nothing is encoded twice.

const std = @import("std");

pub const Error = error{
    BufferTooSmall,
    InvalidEncoding,
    Overflow,
    UnexpectedType,
};

const list_prefix_reserve: usize = 3;

pub const ListMark = struct {
    offset: usize,
};

pub const Writer = struct {
    buffer: []u8,
    length: usize = 0,

    pub fn init(buffer: []u8) Writer {
        std.debug.assert(buffer.len <= std.math.maxInt(u16));
        return .{ .buffer = buffer };
    }

    pub fn bytes(self: *const Writer) []const u8 {
        std.debug.assert(self.length <= self.buffer.len);
        return self.buffer[0..self.length];
    }

    pub fn beginList(self: *Writer) Error!ListMark {
        try self.ensureUnused(list_prefix_reserve);
        const mark = ListMark{ .offset = self.length };
        self.length += list_prefix_reserve;
        return mark;
    }

    pub fn finishList(self: *Writer, mark: ListMark) void {
        std.debug.assert(mark.offset + list_prefix_reserve <= self.length);
        const content_start = mark.offset + list_prefix_reserve;
        const content_length = self.length - content_start;
        var prefix: [9]u8 = undefined;
        const prefix_length = listPrefix(&prefix, content_length);
        std.debug.assert(prefix_length <= list_prefix_reserve);

        const shift = list_prefix_reserve - prefix_length;
        if (shift > 0) {
            @memmove(
                self.buffer[mark.offset + prefix_length .. self.length - shift],
                self.buffer[content_start..self.length],
            );
            self.length -= shift;
        }
        @memcpy(self.buffer[mark.offset..][0..prefix_length], prefix[0..prefix_length]);
    }

    pub fn writeBytes(self: *Writer, data: []const u8) Error!void {
        if (data.len == 1 and data[0] < 0x80) {
            try self.ensureUnused(1);
            self.buffer[self.length] = data[0];
            self.length += 1;
            return;
        }

        var prefix: [9]u8 = undefined;
        const prefix_length = encodeLengthPrefix(&prefix, 0x80, 0xb7, data.len);
        const encoded_length = std.math.add(usize, prefix_length, data.len) catch
            return error.Overflow;
        try self.ensureUnused(encoded_length);
        @memcpy(self.buffer[self.length..][0..prefix_length], prefix[0..prefix_length]);
        self.length += prefix_length;
        @memcpy(self.buffer[self.length..][0..data.len], data);
        self.length += data.len;
    }

    pub fn writeRawItem(self: *Writer, encoded: []const u8) Error!void {
        var reader = Reader.init(encoded);
        _ = try reader.readRawItem();
        if (!reader.atEnd()) return error.InvalidEncoding;
        try self.ensureUnused(encoded.len);
        @memcpy(self.buffer[self.length..][0..encoded.len], encoded);
        self.length += encoded.len;
    }

    pub fn writeUint(self: *Writer, value: u64) Error!void {
        var integer_bytes: [8]u8 = undefined;
        if (value == 0) return self.writeBytes(integer_bytes[0..0]);
        std.mem.writeInt(u64, &integer_bytes, value, .big);
        var first: usize = 0;
        while (first < integer_bytes.len - 1 and integer_bytes[first] == 0) : (first += 1) {}
        return self.writeBytes(integer_bytes[first..]);
    }

    fn ensureUnused(self: *const Writer, count: usize) Error!void {
        std.debug.assert(self.length <= self.buffer.len);
        if (count > self.buffer.len - self.length) return error.BufferTooSmall;
    }
};

pub const Reader = struct {
    data: []const u8,
    position: usize = 0,

    pub fn init(data: []const u8) Reader {
        return .{ .data = data };
    }

    pub fn atEnd(self: *const Reader) bool {
        std.debug.assert(self.position <= self.data.len);
        return self.position == self.data.len;
    }

    pub fn readBytes(self: *Reader) Error![]const u8 {
        const item = try self.readItem();
        if (item.kind != .string) return error.UnexpectedType;
        return self.data[item.payload_start..item.payload_end];
    }

    pub fn readList(self: *Reader) Error!Reader {
        const item = try self.readItem();
        if (item.kind != .list) return error.UnexpectedType;
        return Reader.init(self.data[item.payload_start..item.payload_end]);
    }

    pub fn readRawItem(self: *Reader) Error![]const u8 {
        const start = self.position;
        _ = try self.readItem();
        return self.data[start..self.position];
    }

    pub fn readUint(self: *Reader) Error!u64 {
        const bytes = try self.readBytes();
        if (bytes.len == 0) return 0;
        if (bytes.len > @sizeOf(u64)) return error.Overflow;
        if (bytes[0] == 0) return error.InvalidEncoding;

        var value: u64 = 0;
        for (bytes) |byte| value = (value << 8) | byte;
        return value;
    }

    const Kind = enum { string, list };

    const Item = struct {
        kind: Kind,
        payload_start: usize,
        payload_end: usize,
    };

    // Non-canonical forms are rejected. That covers a prefixed single byte, a long form for a
    // payload under 56 bytes, and a length with leading zeros.
    fn readItem(self: *Reader) Error!Item {
        if (self.position == self.data.len) return error.InvalidEncoding;
        const prefix = self.data[self.position];
        if (prefix < 0x80) return self.readSingleByte();
        if (prefix < 0xb8) return self.readShort(.string, prefix - 0x80);
        if (prefix < 0xc0) return self.readLong(.string, prefix - 0xb7);
        if (prefix < 0xf8) return self.readShort(.list, prefix - 0xc0);
        return self.readLong(.list, prefix - 0xf7);
    }

    fn readSingleByte(self: *Reader) Item {
        const start = self.position;
        self.position += 1;
        return .{ .kind = .string, .payload_start = start, .payload_end = start + 1 };
    }

    fn readShort(self: *Reader, kind: Kind, payload_length_u8: u8) Error!Item {
        const payload_length: usize = payload_length_u8;
        const payload_start = self.position + 1;
        if (payload_length > self.data.len - payload_start) return error.InvalidEncoding;
        const payload_end = payload_start + payload_length;
        if (kind == .string and payload_length == 1) {
            if (self.data[payload_start] < 0x80) return error.InvalidEncoding;
        }
        self.position = payload_end;
        return .{ .kind = kind, .payload_start = payload_start, .payload_end = payload_end };
    }

    fn readLong(self: *Reader, kind: Kind, length_size_u8: u8) Error!Item {
        const length_size: usize = length_size_u8;
        const length_start = self.position + 1;
        if (length_size == 0) return error.InvalidEncoding;
        if (length_size > @sizeOf(usize)) return error.InvalidEncoding;
        if (length_size > self.data.len - length_start) return error.InvalidEncoding;
        const length_bytes = self.data[length_start..][0..length_size];
        if (length_bytes[0] == 0) return error.InvalidEncoding;

        const payload_length = try readLength(length_bytes);
        if (payload_length < 56) return error.InvalidEncoding;
        const payload_start = length_start + length_size;
        if (payload_length > self.data.len - payload_start) return error.InvalidEncoding;
        const payload_end = payload_start + payload_length;
        self.position = payload_end;
        return .{ .kind = kind, .payload_start = payload_start, .payload_end = payload_end };
    }
};

pub fn listPrefix(out: *[9]u8, payload_length: usize) usize {
    return encodeLengthPrefix(out, 0xc0, 0xf7, payload_length);
}

fn encodeLengthPrefix(
    out: *[9]u8,
    short_base: u8,
    long_base: u8,
    payload_length: usize,
) usize {
    if (payload_length <= 55) {
        out[0] = short_base + @as(u8, @intCast(payload_length));
        return 1;
    }

    const length_size = encodedLengthSize(payload_length);
    out[0] = long_base + @as(u8, @intCast(length_size));
    var remaining = payload_length;
    for (0..length_size) |index| {
        out[length_size - index] = @intCast(remaining & 0xff);
        remaining >>= 8;
    }
    return length_size + 1;
}

fn encodedLengthSize(payload_length: usize) usize {
    std.debug.assert(payload_length > 0);
    var value = payload_length;
    var size: usize = 0;
    while (value > 0) : (value >>= 8) size += 1;
    return size;
}

fn readLength(bytes: []const u8) Error!usize {
    std.debug.assert(bytes.len > 0);
    std.debug.assert(bytes.len <= @sizeOf(usize));
    var value: usize = 0;
    for (bytes) |byte| {
        value = std.math.mul(usize, value, 256) catch return error.Overflow;
        value = std.math.add(usize, value, @as(usize, byte)) catch return error.Overflow;
    }
    return value;
}

test {
    _ = @import("rlp_test.zig");
}
