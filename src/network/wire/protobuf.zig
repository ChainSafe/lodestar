const std = @import("std");
const varint_mod = @import("varint.zig");

const assert = std.debug.assert;

pub const Error = error{ Truncated, Overflow, NonCanonical, InvalidField, BadWireType, FieldLimit };

pub const wire_varint: u3 = 0;
pub const wire_len: u3 = 2;
pub const wire_i64: u3 = 1;
pub const wire_i32: u3 = 5;

pub const Tag = struct {
    field: u32,
    wire: u3,

    pub fn decode(raw: u64) Error!Tag {
        const field = raw >> 3;
        if (field == 0 or field > std.math.maxInt(u29)) return error.InvalidField;
        const wire: u3 = @intCast(raw & 7);
        switch (wire) {
            wire_varint, wire_len, wire_i64, wire_i32 => {},
            else => return error.BadWireType,
        }
        return .{ .field = @intCast(field), .wire = wire };
    }
};

/// Network protobuf requires minimal varints and excludes deprecated groups.
/// The owning protocol must additionally enforce its schema and resource limits.
pub const Reader = struct {
    pub const field_limit = 8192;

    data: []const u8,
    pos: usize = 0,
    fields: usize = 0,

    pub fn init(data: []const u8) Reader {
        return .{ .data = data };
    }

    pub fn atEnd(self: *const Reader) bool {
        assert(self.pos <= self.data.len);
        return self.pos >= self.data.len;
    }

    pub fn varint(self: *Reader) Error!u64 {
        var result: u64 = 0;
        var count: usize = 0;
        while (count < 10) : (count += 1) {
            if (self.pos >= self.data.len) return error.Truncated;
            const byte = self.data[self.pos];
            self.pos += 1;
            if (count == 9 and byte > 1) return error.Overflow;
            const shift: u6 = @intCast(count * 7);
            result |= @as(u64, byte & 0x7f) << shift;
            if (byte & 0x80 == 0) {
                if (count > 0 and byte == 0) return error.NonCanonical;
                return result;
            }
        }
        return error.Overflow;
    }

    pub fn tag(self: *Reader) Error!Tag {
        if (self.fields == field_limit) return error.FieldLimit;
        self.fields += 1;
        const raw = try self.varint();
        return Tag.decode(raw);
    }

    pub fn lenDelimited(self: *Reader) Error![]const u8 {
        const len = try self.varint();
        if (len > self.data.len - self.pos) return error.Truncated;
        const start = self.pos;
        self.pos += @intCast(len);
        return self.data[start..self.pos];
    }

    pub fn skip(self: *Reader, wire: u3) Error!void {
        switch (wire) {
            wire_varint => _ = try self.varint(),
            wire_len => _ = try self.lenDelimited(),
            wire_i64 => self.pos = try self.advance(8),
            wire_i32 => self.pos = try self.advance(4),
            else => return error.BadWireType,
        }
    }

    fn advance(self: *Reader, n: usize) Error!usize {
        if (n > self.data.len - self.pos) return error.Truncated;
        return self.pos + n;
    }
};

pub const varintLen = varint_mod.encodedLength;

/// An append-only writer over a caller-provided buffer; never allocates and
/// asserts the buffer is large enough (callers size it from the `*Size` helpers).
pub const Writer = struct {
    buf: []u8,
    len: usize = 0,

    pub fn init(buf: []u8) Writer {
        return .{ .buf = buf };
    }

    pub fn written(self: *const Writer) []const u8 {
        return self.buf[0..self.len];
    }

    pub fn varint(self: *Writer, value: u64) void {
        assert(varintLen(value) <= self.buf.len - self.len);
        self.len += (varint_mod.encode(value, self.buf[self.len..]) catch unreachable).len;
    }

    pub fn tag(self: *Writer, field: u32, wire: u3) void {
        self.varint((@as(u64, field) << 3) | wire);
    }

    pub fn bytes(self: *Writer, data: []const u8) void {
        assert(self.len + data.len <= self.buf.len);
        @memcpy(self.buf[self.len..][0..data.len], data);
        self.len += data.len;
    }

    pub fn varintField(self: *Writer, field: u32, value: u64) void {
        self.tag(field, wire_varint);
        self.varint(value);
    }

    pub fn bytesField(self: *Writer, field: u32, data: []const u8) void {
        self.tag(field, wire_len);
        self.varint(data.len);
        self.bytes(data);
    }
};

fn keySize(field: u32) usize {
    return varintLen(@as(u64, field) << 3);
}

pub fn bytesFieldSize(field: u32, data_len: usize) usize {
    return keySize(field) + varintLen(data_len) + data_len;
}

pub fn varintFieldSize(field: u32, value: u64) usize {
    return keySize(field) + varintLen(value);
}

test {
    _ = @import("protobuf_test.zig");
}
