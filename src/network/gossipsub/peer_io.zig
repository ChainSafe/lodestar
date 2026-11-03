const std = @import("std");
const frame = @import("frame.zig");
const protobuf = @import("protobuf.zig");
const constants = @import("constants.zig");
const assert = std.debug.assert;
const receive = @import("receive_pool.zig");
const Outbox = @import("outbox.zig").Outbox;
const options_mod = @import("options.zig");
const delivery = @import("delivery.zig");

pub const TimeoutReason = enum { active_send, subscriptions, receive_frame, send_queue };

pub const ActiveRpc = struct {
    completed_ms: ?u64 = null,
    reader: protobuf.RpcReader,
    ihave_allowed: ?bool = null,
    item: ?protobuf.RpcReader.ItemRange = null,
    pub fn consumeItem(self: *ActiveRpc) void {
        self.item = null;
    }
};

pub const Deadlines = struct {
    values: [@typeInfo(TimeoutReason).@"enum".fields.len]?u64 = @splat(null),

    pub fn next(self: *const Deadlines) ?u64 {
        var result: ?u64 = null;
        for (self.values) |value| if (value) |deadline| {
            result = @min(result orelse deadline, deadline);
        };
        return result;
    }

    pub fn expired(self: *const Deadlines, now_ms: u64) ?TimeoutReason {
        for (self.values, 0..) |value, index| if (value) |deadline| {
            if (now_ms >= deadline) return @enumFromInt(index);
        };
        return null;
    }
};

pub const PeerIo = struct {
    pub fn bufferBytes(options: *const options_mod.Options) usize {
        return 2 * options.control_bytes + 10 + options.critical_bytes + options.body_buffer_bytes + constants.read_scratch_len;
    }

    pub fn init(bytes: []u8, options: *const options_mod.Options, deliveries: *delivery.Pool) PeerIo {
        assert(bytes.len == bufferBytes(options));
        const critical = options.control_bytes;
        const gossip = critical + options.critical_bytes;
        const body = gossip + options.control_bytes + 10;
        const unread = body + options.body_buffer_bytes;
        return .{ .tx = .{ .active_send_timeout_ms = options.active_send_timeout_ms, .queue_timeout_ms = options.tx_timeout_ms, .data = .{ .pool = deliveries }, .control = .{ .bytes = bytes[0..critical] }, .critical = .{ .bytes = bytes[critical..gossip] }, .gossip = bytes[gossip..body] }, .body = bytes[body..unread], .unread = bytes[unread..] };
    }

    write_first: bool = false,
    write_zero: u64 = 0,
    write_budget_deferred: u64 = 0,
    tx: Outbox,
    body: []u8,
    unread: []u8,
    unread_start: usize = 0,
    unread_end: usize = 0,
    reader: frame.Reader = .{},
    rpc: ?ActiveRpc = null,
    discarding: bool = false,
    fin_seen: bool = false,
    overflow: receive.Chain = .{},
    progress_ms: u64 = 0,
    frame_since: ?u64 = null,
    rx_ready: bool = true,
    ihave_recv: u16 = 0,
    iwant_ids_sent: u16 = 0,
    idontwant_recv: u16 = 0,

    pub fn startSession(self: *PeerIo) void {
        assert(self.overflow.pages == 0 and self.rpc == null);
        self.tx.startSession();
        self.* = .{ .tx = self.tx, .body = self.body, .unread = self.unread, .rx_ready = false };
    }

    pub fn feedUnread(self: *PeerIo, pool: *receive.ReceivePool, limit: usize, now_ms: u64) (frame.Error || error{ReceiveCapacity})!struct { consumed: usize, complete: bool } {
        assert(self.rpc == null);
        assert(limit > 0 and limit <= self.unread_end - self.unread_start);
        const input = self.unread[self.unread_start..][0..limit];
        var consumed: usize = 0;
        if (self.reader.declared == null) {
            consumed = try self.reader.readPrefix(input);
        }
        if (self.reader.declared != null and self.reader.filled < self.reader.declared.? and consumed < input.len) {
            var take = @min(input.len - consumed, self.reader.declared.? - self.reader.filled);
            if (!self.discarding) {
                const overflow = self.reader.filled >= self.body.len;
                const target = if (overflow) pool.writable(&self.overflow) orelse return error.ReceiveCapacity else self.body[self.reader.filled..];
                take = @min(take, target.len);
                @memcpy(target[0..take], input[consumed..][0..take]);
                if (overflow) self.overflow.len += take;
            }
            assert(take > 0);
            self.reader.filled += take;
            consumed += take;
        }
        if (consumed > 0) {
            if (self.frame_since == null) self.frame_since = now_ms;
            self.progress_ms = now_ms;
            self.unread_start += consumed;
        }
        const complete = self.reader.declared != null and self.reader.filled == self.reader.declared.?;
        if (complete and !self.discarding) self.rpc = .{ .completed_ms = now_ms, .reader = protobuf.RpcReader.initView(.{
            .prefix = self.body[0..@min(self.reader.filled, self.body.len)],
            .pool = pool,
            .first = self.overflow.first,
            .len = self.reader.filled,
        }) };
        return .{ .consumed = consumed, .complete = complete };
    }

    pub fn startRpc(self: *PeerIo, bytes: []const u8) void {
        assert(self.rpc == null);
        self.rpc = .{ .reader = protobuf.RpcReader.init(bytes) };
    }

    pub fn finishFrame(self: *PeerIo) void {
        assert(self.overflow.pages == 0);
        self.rpc = null;
        self.discarding = false;
        self.reader = .{};
        self.frame_since = null;
    }

    pub fn resetHeartbeat(self: *PeerIo) void {
        self.ihave_recv = 0;
        self.iwant_ids_sent = 0;
        self.idontwant_recv = 0;
    }
    pub fn deadlines(self: *const PeerIo, options: *const options_mod.Options) Deadlines {
        var result: Deadlines = .{};
        if (self.tx.subscription_since) |since| result.values[@intFromEnum(TimeoutReason.subscriptions)] = since +| options.pressure_timeout_ms;
        if (self.frame_since) |since| {
            result.values[@intFromEnum(TimeoutReason.receive_frame)] = if (self.rpc == null)
                @min(since +| (if ((self.reader.declaredLen() orelse 0) > self.body.len) options.large_frame_timeout_ms else options.pressure_timeout_ms), self.progress_ms +| options.large_frame_timeout_ms)
            else
                since +| options.pressure_timeout_ms;
        }
        if (self.tx.controlOldest()) |since| {
            result.values[@intFromEnum(TimeoutReason.send_queue)] = since +| options.tx_timeout_ms;
        }
        result.values[@intFromEnum(TimeoutReason.active_send)] = self.tx.active_deadline_ms;
        return result;
    }
};

test {
    _ = @import("peer_io_test.zig");
}
