const std = @import("std");
const pb = @import("../wire/protobuf.zig");
const schema = @import("protobuf_schema.zig");
pub const Error = schema.Error;
pub const Reader = pb.Reader;
pub const fields_per_item_max = 1 + 2 * Reader.field_limit;
pub const Writer = pb.Writer;
pub const wire_varint = pb.wire_varint;
pub const wire_len = pb.wire_len;
pub const wire_i64 = pb.wire_i64;
pub const wire_i32 = pb.wire_i32;
pub const Tag = pb.Tag;
pub const varintLen = pb.varintLen;
const bytesFieldSize = pb.bytesFieldSize;
const varintFieldSize = pb.varintFieldSize;

/// A `SubOpts { subscribe = 1, topicid = 2 }` view into the message bytes.
pub const SubOpts = struct {
    subscribe: bool = false,
    topic: []const u8 = &.{},

    pub fn decode(data: []const u8) Error!SubOpts {
        try schema.validate(.subscription, data);
        var out: SubOpts = .{};
        var reader = Reader.init(data);
        while (!reader.atEnd()) {
            const t = try reader.tag();
            switch (t.field) {
                1 => out.subscribe = (try reader.varint()) == 1,
                2 => out.topic = try reader.lenDelimited(),
                else => try reader.skip(t.wire),
            }
        }
        return out;
    }
};

/// A `Message { data = 2, topic = 4 }` view (StrictNoSign omits the rest).
pub const Message = struct {
    data: []const u8 = &.{},
    topic: []const u8 = &.{},
    signed: bool = false,

    pub fn decode(bytes_in: []const u8) Error!Message {
        try schema.validate(.message, bytes_in);
        var out: Message = .{};
        var reader = Reader.init(bytes_in);
        while (!reader.atEnd()) {
            const t = try reader.tag();
            switch (t.field) {
                1, 3, 5, 6 => {
                    try reader.skip(t.wire);
                    out.signed = true;
                },
                2 => out.data = try reader.lenDelimited(),
                4 => out.topic = try reader.lenDelimited(),
                else => try reader.skip(t.wire),
            }
        }
        return out;
    }
};

/// Iterates the repeated `bytes` message ids in an IHAVE/IWANT/IDONTWANT body.
pub const IdIterator = struct {
    reader: Reader,
    field: u32,

    pub fn next(self: *IdIterator) Error!?[]const u8 {
        while (!self.reader.atEnd()) {
            const t = try self.reader.tag();
            if (t.field == self.field and t.wire == wire_len) return try self.reader.lenDelimited();
            try self.reader.skip(t.wire);
        }
        return null;
    }
};

fn topicOf(data: []const u8, field: u32) Error![]const u8 {
    var reader = Reader.init(data);
    var topic: []const u8 = &.{};
    while (!reader.atEnd()) {
        const t = try reader.tag();
        if (t.field == field and t.wire == wire_len)
            topic = try reader.lenDelimited()
        else
            try reader.skip(t.wire);
    }
    return topic;
}

pub const IHave = struct {
    topic: []const u8,
    body: []const u8,

    pub fn ids(self: *const IHave) IdIterator {
        return .{ .reader = Reader.init(self.body), .field = 2 };
    }
};

pub const IdList = struct {
    body: []const u8,

    pub fn ids(self: *const IdList) IdIterator {
        return .{ .reader = Reader.init(self.body), .field = 1 };
    }
};

pub const Prune = struct {
    topic: []const u8 = &.{},
    backoff: u64 = 0,

    pub fn decode(data: []const u8) Error!Prune {
        try schema.validate(.prune, data);
        var out: Prune = .{};
        var reader = Reader.init(data);
        while (!reader.atEnd()) {
            const t = try reader.tag();
            switch (t.field) {
                1 => out.topic = try reader.lenDelimited(),
                3 => out.backoff = try reader.varint(),
                else => try reader.skip(t.wire),
            }
        }
        return out;
    }
};

pub const Item = union(enum) {
    subscription: SubOpts,
    message: Message,
    ihave: IHave,
    iwant: IdList,
    graft: []const u8,
    prune: Prune,
    idontwant: IdList,
};

const receive = @import("receive_pool.zig");

const FrameCursor = @import("protobuf_cursor.zig").Cursor;

/// Only cursors and ranges survive a processing turn. Decoded items borrow the caller's workspace.
pub const RpcReader = struct {
    view: receive.View,
    top: FrameCursor,
    control: ?FrameCursor = null,
    validator: schema.Validator,

    pub fn init(data: []const u8) RpcReader {
        return initView(receive.View.contiguous(data));
    }

    pub fn initView(view: receive.View) RpcReader {
        return .{ .view = view, .top = .{ .cursor = .{ .page = view.first }, .end = view.len }, .validator = schema.Validator.init(.rpc, &view) };
    }

    pub const ItemRange = struct {
        kind: std.meta.Tag(Item),
        bytes: receive.Range,

        pub fn fieldCost(self: *const ItemRange) usize {
            return bodyFieldCost(self.bytes.len);
        }
    };

    fn bodyFieldCost(len: usize) usize {
        return 1 + @as(usize, @min(len, Reader.field_limit)) * 2;
    }
    pub const Step = union(enum) { item: ItemRange, skipped, end, deferred };

    pub fn step(self: *RpcReader, fields: *usize) Error!Step {
        if (!try self.validator.advance(&self.view, fields)) return .deferred;
        if (fields.* == 0) return .deferred;
        const nested = self.control != null;
        var reader = self.control orelse self.top;
        if (reader.cursor.pos == reader.end) {
            if (nested) {
                self.control = null;
                return .skipped;
            }
            return .end;
        }
        const start = reader.cursor.pos;
        const tag = try reader.tag(&self.view);
        const field = tag.field;
        const known = if (nested) field >= 1 and field <= 5 else field >= 1 and field <= 3;
        if (!known) {
            try reader.skip(&self.view, tag.wire);
            const cost = 21 + (reader.cursor.pos - start) / receive.page_bytes;
            if (cost > fields.*) return .deferred;
            fields.* -= cost;
            if (nested) self.control = reader else self.top = reader;
            return .skipped;
        }
        std.debug.assert(tag.wire == wire_len);
        const len = try reader.varint(&self.view);
        if (len > reader.end - reader.cursor.pos) return error.Truncated;
        const bytes = try reader.range(&self.view, @intCast(len));
        const cost = if (!nested and field == 3) 1 else bodyFieldCost(bytes.len);
        if (cost > fields.*) return .deferred;
        fields.* -= cost;
        if (nested) self.control = reader else self.top = reader;
        if (!nested and field == 3) {
            self.control = .{ .cursor = bytes.start, .end = bytes.start.pos + bytes.len };
            return .skipped;
        }
        const kind: std.meta.Tag(Item) = if (nested) switch (field) {
            1 => .ihave,
            2 => .iwant,
            3 => .graft,
            4 => .prune,
            5 => .idontwant,
            else => unreachable,
        } else switch (field) {
            1 => .subscription,
            2 => .message,
            else => unreachable,
        };
        return .{ .item = .{ .kind = kind, .bytes = bytes } };
    }

    pub fn decode(self: *const RpcReader, item: ItemRange, scratch: []u8) Error!Item {
        std.debug.assert(self.validator.depth == 0);
        const bytes = self.view.materialize(item.bytes, scratch);
        return switch (item.kind) {
            .subscription => .{ .subscription = try SubOpts.decode(bytes) },
            .message => .{ .message = try Message.decode(bytes) },
            .ihave => .{ .ihave = .{ .topic = try topicOf(bytes, 1), .body = bytes } },
            .iwant => .{ .iwant = .{ .body = bytes } },
            .graft => .{ .graft = try topicOf(bytes, 1) },
            .prune => .{ .prune = try Prune.decode(bytes) },
            .idontwant => .{ .idontwant = .{ .body = bytes } },
        };
    }

    pub fn next(self: *RpcReader) Error!?Item {
        std.debug.assert(self.view.len == self.view.prefix.len);
        var budget: usize = std.math.maxInt(usize);
        for (0..schema.fields_per_rpc + 2) |_| {
            switch (try self.step(&budget)) {
                .item => |item| return try self.decode(item, &.{}),
                .end => return null,
                .skipped => {},
                .deferred => unreachable,
            }
        }
        return error.FieldLimit;
    }
};

pub fn subscriptionSize(topic: []const u8) usize {
    const content = varintFieldSize(1, 1) + bytesFieldSize(2, topic.len);
    return bytesFieldSize(1, content);
}

pub fn writeSubscription(w: *Writer, subscribe: bool, topic: []const u8) void {
    const content = varintFieldSize(1, 1) + bytesFieldSize(2, topic.len);
    w.tag(1, wire_len);
    w.varint(content);
    w.varintField(1, @intFromBool(subscribe));
    w.bytesField(2, topic);
}

pub fn messageSize(data: []const u8, topic: []const u8) usize {
    const content = bytesFieldSize(2, data.len) + bytesFieldSize(4, topic.len);
    return bytesFieldSize(2, content);
}

pub fn writeMessage(w: *Writer, data: []const u8, topic: []const u8) void {
    const content = bytesFieldSize(2, data.len) + bytesFieldSize(4, topic.len);
    w.tag(2, wire_len);
    w.varint(content);
    w.bytesField(2, data);
    w.bytesField(4, topic);
}

/// Writes a whole RPC carrying one GRAFT control message for `topic`.
pub fn graftRpcSize(topic: []const u8) usize {
    const graft = bytesFieldSize(1, topic.len);
    return bytesFieldSize(3, bytesFieldSize(3, graft));
}

pub fn writeGraftRpc(w: *Writer, topic: []const u8) void {
    const graft = bytesFieldSize(1, topic.len);
    const control = bytesFieldSize(3, graft);
    w.tag(3, wire_len);
    w.varint(control);
    w.tag(3, wire_len);
    w.varint(graft);
    w.bytesField(1, topic);
}

/// Writes a whole RPC carrying one PRUNE control message with a backoff in
/// seconds (Ethereum sends no peer-exchange records).
pub fn pruneRpcSize(topic: []const u8, backoff_s: u64) usize {
    const prune = bytesFieldSize(1, topic.len) + varintFieldSize(3, backoff_s);
    return bytesFieldSize(3, bytesFieldSize(4, prune));
}

pub fn writePruneRpc(w: *Writer, topic: []const u8, backoff_s: u64) void {
    const prune = bytesFieldSize(1, topic.len) + varintFieldSize(3, backoff_s);
    const control = bytesFieldSize(4, prune);
    w.tag(3, wire_len);
    w.varint(control);
    w.tag(4, wire_len);
    w.varint(prune);
    w.bytesField(1, topic);
    w.varintField(3, backoff_s);
}

/// Size of a whole RPC carrying one IHAVE for `topic` and `id_count` ids.
pub fn ihaveRpcSize(topic: []const u8, id_count: usize, id_len: usize) usize {
    const ihave = bytesFieldSize(1, topic.len) + id_count * bytesFieldSize(2, id_len);
    return bytesFieldSize(3, bytesFieldSize(1, ihave));
}

/// Begins an IHAVE RPC; the caller appends each id with `writeIhaveId` in order.
pub fn beginIhaveRpc(w: *Writer, topic: []const u8, id_count: usize, id_len: usize) void {
    const ihave = bytesFieldSize(1, topic.len) + id_count * bytesFieldSize(2, id_len);
    w.tag(3, wire_len);
    w.varint(bytesFieldSize(1, ihave));
    w.tag(1, wire_len);
    w.varint(ihave);
    w.bytesField(1, topic);
}

pub fn writeIhaveId(w: *Writer, id: []const u8) void {
    w.bytesField(2, id);
}

/// Size of a whole RPC carrying one IWANT for `id_count` ids.
pub fn iwantRpcSize(id_count: usize, id_len: usize) usize {
    const iwant = id_count * bytesFieldSize(1, id_len);
    return bytesFieldSize(3, bytesFieldSize(2, iwant));
}

pub fn beginIwantRpc(w: *Writer, id_count: usize, id_len: usize) void {
    const iwant = id_count * bytesFieldSize(1, id_len);
    w.tag(3, wire_len);
    w.varint(bytesFieldSize(2, iwant));
    w.tag(2, wire_len);
    w.varint(iwant);
}

pub fn writeIwantId(w: *Writer, id: []const u8) void {
    w.bytesField(1, id);
}

/// Size of a whole RPC carrying one IDONTWANT for `id_count` ids.
pub fn idontwantRpcSize(id_count: usize, id_len: usize) usize {
    const idontwant = id_count * bytesFieldSize(1, id_len);
    return bytesFieldSize(3, bytesFieldSize(5, idontwant));
}

pub fn beginIdontwantRpc(w: *Writer, id_count: usize, id_len: usize) void {
    const idontwant = id_count * bytesFieldSize(1, id_len);
    w.tag(3, wire_len);
    w.varint(bytesFieldSize(5, idontwant));
    w.tag(5, wire_len);
    w.varint(idontwant);
}

pub fn writeIdontwantId(w: *Writer, id: []const u8) void {
    w.bytesField(1, id);
}

test {
    _ = @import("protobuf_test.zig");
}
