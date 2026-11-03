const std = @import("std");
const pb = @import("../wire/protobuf.zig");
const trace = @import("../stream_trace.zig");
const Protocol = @import("../protocol.zig").Protocol;
const multiaddr = @import("../wire/multiaddr.zig");
const Multiaddr = multiaddr.Multiaddr;
const PeerId = @import("../wire/peer_id.zig").PeerId;

pub const version = 3;
pub const frame_max = trace.chunk_max + 1024;
pub const hello_max = 4096;
pub const Error = pb.Error || error{ InvalidHandshake, UnsupportedCollector };

// Leave room for the outer frame and envelope, then prepend their actual lengths.
pub const Frame = struct {
    storage: [frame_max]u8 = undefined,
    payload: pb.Writer = undefined,

    pub fn begin(self: *Frame) *pb.Writer {
        self.payload = pb.Writer.init(self.storage[64..]);
        return &self.payload;
    }

    pub fn finish(self: *Frame, kind: u32, sequence: u64, observed: u64) []const u8 {
        var prefix: [64]u8 = undefined;
        var envelope = pb.Writer.init(&prefix);
        if (sequence != 0) envelope.varintField(1, sequence);
        if (observed != 0) envelope.varintField(2, observed);
        envelope.tag(kind, pb.wire_len);
        envelope.varint(self.payload.len);
        var framing: [8]u8 = undefined;
        var header = pb.Writer.init(&framing);
        header.bytes(&.{3});
        header.varint(envelope.len + self.payload.len);
        const start = 64 - envelope.len - header.len;
        @memcpy(self.storage[start..][0..header.len], header.written());
        @memcpy(self.storage[start + header.len ..][0..envelope.len], envelope.written());
        return self.storage[start .. 64 + self.payload.len];
    }

    pub fn hello(self: *Frame, identity: *const PeerId, client: []const u8, boot: *const [16]u8, started: u64) []const u8 {
        const out = self.begin();
        out.varintField(1, version);
        out.bytesField(2, &identity.bytes);
        out.bytesField(3, client);
        out.bytesField(4, boot);
        out.varintField(5, started);
        var prefix: [8]u8 = undefined;
        var header = pb.Writer.init(&prefix);
        header.bytes(&.{1});
        header.varint(out.len);
        const start = 64 - header.len;
        @memcpy(self.storage[start..64], header.written());
        return self.storage[start .. 64 + out.len];
    }

    pub fn string(self: *Frame, index: u32) []const u8 {
        const out = self.begin();
        out.varintField(1, index);
        out.bytesField(2, switch (index) {
            1 => "quic-v1",
            2 => "tls",
            else => Protocol.fromIndex(@intCast(index - 3)).id(),
        });
        return self.finish(20, 0, 0);
    }

    pub fn peer(self: *Frame, value: *const trace.Event, sequence: u64) []const u8 {
        const conn = &value.payload.connection;
        const out = self.begin();
        out.varintField(1, conn.peer_alias);
        out.bytesField(2, &conn.peer.bytes);
        return self.finish(21, sequence, value.observed_at_ns);
    }

    pub fn event(self: *Frame, value: *const trace.Event, data: []const u8, sequence: u64, incomplete: bool) []const u8 {
        const out = self.begin();
        const kind: u32 = switch (value.payload) {
            .connection => |*conn| blk: {
                out.varintField(1, conn.id);
                out.varintField(2, conn.peer_alias);
                var buffer: [multiaddr.text_length_max]u8 = undefined;
                const remote: Multiaddr = .{ .address = conn.remote };
                out.bytesField(3, remote.toText(&buffer) catch unreachable);
                const local: Multiaddr = .{ .address = conn.local };
                out.bytesField(4, local.toText(&buffer) catch unreachable);
                out.varintField(5, if (conn.direction == .inbound) 1 else 2);
                out.varintField(6, 1);
                out.varintField(7, 2);
                out.varintField(8, 1);
                out.varintField(9, value.observed_at_ns);
                break :blk 22;
            },
            .stream => |stream| blk: {
                out.varintField(1, stream.id);
                out.varintField(2, stream.connection);
                out.varintField(3, if (stream.direction == .inbound) 1 else 2);
                out.varintField(4, @as(u32, stream.protocol.index()) + 3);
                out.varintField(5, value.observed_at_ns);
                if (incomplete) out.varintField(6, 1);
                break :blk 24;
            },
            .data => |chunk| blk: {
                out.varintField(1, chunk.stream);
                out.varintField(2, if (chunk.direction == .inbound) 1 else 2);
                out.bytesField(3, data[chunk.offset..][0..chunk.length]);
                break :blk 26;
            },
            .stream_closed => |closed| blk: {
                out.varintField(1, closed.stream);
                out.varintField(2, value.observed_at_ns);
                out.varintField(3, if (closed.reset) 2 else 1);
                break :blk 25;
            },
            .connection_closed => |conn| blk: {
                out.varintField(1, conn);
                out.varintField(2, value.observed_at_ns);
                break :blk 23;
            },
        };
        return self.finish(kind, sequence, value.observed_at_ns);
    }

    pub fn snapshot(self: *Frame, end: ?u64) []const u8 {
        const out = self.begin();
        if (end) |sequence| out.varintField(1, sequence);
        return self.finish(if (end == null) 11 else 12, 0, 0);
    }
};

pub fn serverHello(bytes: []const u8) Error!u64 {
    var reader = pb.Reader.init(bytes);
    var protocol: u64 = 0;
    var cursor: u64 = 0;
    var gaps = false;
    while (!reader.atEnd()) {
        const tag = try reader.tag();
        switch (tag.field) {
            1, 3, 4 => {
                if (tag.wire != pb.wire_varint) return error.InvalidHandshake;
                const value = try reader.varint();
                switch (tag.field) {
                    1 => protocol = value,
                    3 => cursor = value,
                    4 => gaps = value != 0,
                    else => unreachable,
                }
            },
            else => try reader.skip(tag.wire),
        }
    }
    if (protocol != version or !gaps) return error.UnsupportedCollector;
    return cursor;
}

test {
    _ = @import("wire_test.zig");
}
