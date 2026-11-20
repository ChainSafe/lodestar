const pb = @import("../wire/protobuf.zig");
const receive = @import("receive_pool.zig");

pub const Cursor = struct {
    cursor: receive.Cursor,
    end: usize,

    pub fn varint(self: *Cursor, view: *const receive.View) pb.Error!u64 {
        var bytes: [10]u8 = undefined;
        for (&bytes, 0..) |*byte, index| {
            if (self.cursor.pos == self.end) return error.Truncated;
            byte.* = view.segment(self.cursor)[0];
            view.advance(&self.cursor, 1);
            if (byte.* & 0x80 == 0) {
                var reader = pb.Reader.init(bytes[0 .. index + 1]);
                return reader.varint();
            }
        }
        return error.Overflow;
    }

    pub fn tag(self: *Cursor, view: *const receive.View) pb.Error!pb.Tag {
        return pb.Tag.decode(try self.varint(view));
    }

    pub fn skip(self: *Cursor, view: *const receive.View, wire: u3) pb.Error!void {
        switch (wire) {
            pb.wire_varint => _ = try self.varint(view),
            pb.wire_len => {
                const len = try self.varint(view);
                if (len > self.end - self.cursor.pos) return error.Truncated;
                _ = try self.range(view, @intCast(len));
            },
            pb.wire_i32 => _ = try self.range(view, 4),
            pb.wire_i64 => _ = try self.range(view, 8),
            else => return error.BadWireType,
        }
    }

    pub fn range(self: *Cursor, view: *const receive.View, len: usize) pb.Error!receive.Range {
        if (len > self.end - self.cursor.pos) return error.Truncated;
        const result: receive.Range = .{ .start = self.cursor, .len = len };
        view.advance(&self.cursor, len);
        return result;
    }
};
