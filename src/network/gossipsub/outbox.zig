const std = @import("std");
const storage = @import("message_store.zig");
const active_send = @import("active_send.zig");
const protobuf = @import("protobuf.zig");
const constants = @import("constants.zig");
const topic = @import("topic.zig");
const trace = @import("trace.zig");
const assert = std.debug.assert;
const ItemKind = std.meta.Tag(protobuf.Item);
const delivery = @import("delivery.zig");
const frame = @import("frame.zig");
const test_support = @import("test_support.zig");
const wire = @import("../wire/protobuf.zig");
const RpcCounts = @import("protobuf_schema.zig").RpcCounts;
const RpcCounters = @import("metrics.zig").RpcCounters;
pub const data_capacity = delivery.per_peer_limit;
pub const control_frames = 128;
pub const critical_frames = 2 * constants.topics_cap;
pub const critical_bytes = critical_frames * (32 + topic.topic_max_len);
pub const QueueResult = enum { queued, full };
pub const DropReason = enum { data_descriptors, data_pool, data_bytes, control_frames, control_bytes, critical_frames, critical_bytes, token_exhausted, active_capacity, data_kind_descriptors, data_kind_bytes };
pub const drop_reason_count = @typeInfo(DropReason).@"enum".fields.len;
/// Storage for encoding one control frame, which the gossip owner shares across its outboxes.
pub const ControlScratch = [32 + topic.topic_max_len + constants.gossip_ids_max * (constants.message_id_length + 2)]u8;

pub const Control = union(enum) {
    subscription: struct { topic: []const u8, subscribed: bool },
    graft: []const u8,
    prune: struct { topic: []const u8, backoff_s: u64 },
    ihave: struct { topic: []const u8, ids: []const topic.MessageId },
    iwant: []const topic.MessageId,
    idontwant: []const topic.MessageId,

    fn encode(self: *const Control, bytes: []u8) []const u8 {
        var writer = protobuf.Writer.init(bytes);
        switch (self.*) {
            .subscription => |sub| {
                assert(sub.topic.len <= topic.topic_max_len);
                writer.varint(protobuf.subscriptionSize(sub.topic));
                protobuf.writeSubscription(&writer, sub.subscribed, sub.topic);
            },
            .graft => |name| {
                assert(name.len <= topic.topic_max_len);
                writer.varint(protobuf.graftRpcSize(name));
                protobuf.writeGraftRpc(&writer, name);
            },
            .prune => |prune| {
                assert(prune.topic.len <= topic.topic_max_len);
                writer.varint(protobuf.pruneRpcSize(prune.topic, prune.backoff_s));
                protobuf.writePruneRpc(&writer, prune.topic, prune.backoff_s);
            },
            .ihave => |have| {
                assert(have.topic.len <= topic.topic_max_len and have.ids.len <= constants.gossip_ids_max);
                writer.varint(protobuf.ihaveRpcSize(have.topic, have.ids.len, constants.message_id_length));
                protobuf.beginIhaveRpc(&writer, have.topic, have.ids.len, constants.message_id_length);
                for (have.ids) |id| protobuf.writeIhaveId(&writer, &id);
            },
            .iwant => |ids| {
                assert(ids.len <= constants.gossip_ids_max);
                writer.varint(protobuf.iwantRpcSize(ids.len, constants.message_id_length));
                protobuf.beginIwantRpc(&writer, ids.len, constants.message_id_length);
                for (ids) |id| protobuf.writeIwantId(&writer, &id);
            },
            .idontwant => |ids| {
                assert(ids.len <= constants.gossip_ids_max);
                writer.varint(protobuf.idontwantRpcSize(ids.len, constants.message_id_length));
                protobuf.beginIdontwantRpc(&writer, ids.len, constants.message_id_length);
                for (ids) |id| protobuf.writeIdontwantId(&writer, &id);
            },
        }
        return writer.written();
    }
};

pub const ControlReceipt = struct { token: u64 };
pub const Completion = union(enum) {
    control: ControlReceipt,
    data: delivery.Receipt,
};

pub const ControlQueue = FrameQueue(control_frames);

fn FrameQueue(comptime capacity: usize) type {
    return struct {
        const Queue = @This();
        bytes: []u8,
        frames: [capacity]Frame = undefined,

        head: usize = 0,
        count: usize = 0,
        read_at: usize = 0,
        write_at: usize = 0,
        used: usize = 0,

        const Frame = struct {
            remaining: u32,
            token: u64,
            enqueued_ms: u64,
        };

        pub fn append(self: *Queue, bytes: []const u8, token: u64, now_ms: u64) QueueResult {
            if (self.count == capacity or bytes.len > self.bytes.len - self.used) return .full;
            assert(bytes.len > 0);
            const n = @min(bytes.len, self.bytes.len - self.write_at);
            @memcpy(self.bytes[self.write_at..][0..n], bytes[0..n]);
            @memcpy(self.bytes[0 .. bytes.len - n], bytes[n..]);
            const slot = (self.head + self.count) % capacity;
            self.frames[slot] = .{ .remaining = @intCast(bytes.len), .token = token, .enqueued_ms = now_ms };
            self.count += 1;
            self.used += bytes.len;
            self.write_at = (self.write_at + bytes.len) % self.bytes.len;
            return .queued;
        }
        pub fn segment(self: *const Queue) []const u8 {
            if (self.count == 0) return &.{};
            return self.bytes[self.read_at..][0..@min(self.frames[self.head].remaining, self.bytes.len - self.read_at)];
        }
        pub fn advance(self: *Queue, len: usize) ?ControlReceipt {
            assert(len > 0 and len <= self.segment().len);
            self.frames[self.head].remaining -= @intCast(len);
            self.used -= len;
            self.read_at = (self.read_at + len) % self.bytes.len;
            if (self.frames[self.head].remaining != 0) return null;
            const receipt: ControlReceipt = .{ .token = self.frames[self.head].token };
            self.head = (self.head + 1) % capacity;
            self.count -= 1;
            return receipt;
        }
        pub fn reset(self: *Queue) void {
            self.* = .{ .bytes = self.bytes };
        }
    };
}

pub const encodePrefix = storage.encodePrefix;

pub const Outbox = struct {
    control: ControlQueue,
    gossip: []u8 = &.{},
    gossip_len: usize = 0,
    gossip_ids: usize = 0,
    gossip_entries: u32 = 0,
    rpc_sent: RpcCounters = .{},
    critical: FrameQueue(critical_frames),
    data: delivery.Queue,
    active: union(enum) { none, critical, control, data: active_send.Frame } = .none,
    small_frame: [active_send.small_frame_bytes]u8 = undefined,
    active_deadline_ms: ?u64 = null,
    active_send_timeout_ms: u64 = 6_000,
    queue_timeout_ms: u64 = 30_000,
    control_burst: u8 = 0,
    sequence: u64 = 0,
    /// The out stream takes writes: a new stream or a writable event sets it, and a write that
    /// blocks clears it. Queueing never sets it, so a blocked stream waits for its writable event.
    ready: bool = true,
    /// When the last write blocked, until a writable event.
    blocked_since: ?u64 = null,
    subscription_since: ?u64 = null,
    /// Borrows the session owner's startup-sized words; resets preserve this slice.
    subscription_dirty: std.DynamicBitSetUnmanaged = .{},
    subscription_cursor: usize = 0,
    drops: [drop_reason_count]u64 = @splat(0),
    pressure_pending: bool = false,
    pressure_log_due_ms: u64 = 0,
    last_drop: DropReason = .data_descriptors,
    last_drop_kind: ?topic.Kind = null,

    pub fn subscriptionChanged(self: *Outbox, index: usize, now: u64) void {
        self.subscription_dirty.set(index);
        self.subscription_since = self.subscription_since orelse now;
    }

    /// Starts a new out stream, which takes writes, with a full subscription snapshot.
    pub fn synchronize(self: *Outbox, now: u64) void {
        self.subscription_since = if (self.subscription_dirty.count() == 0) null else self.subscription_since orelse now;
        self.ready = true;
        self.blocked_since = null;
    }

    /// A write took fewer bytes than offered; the engine armed write interest.
    pub fn blocked(self: *Outbox, now: u64) void {
        self.ready = false;
        self.blocked_since = self.blocked_since orelse now;
    }

    /// A writable event: the stream's send capacity reached the armed watermark.
    pub fn writable(self: *Outbox) void {
        self.ready = true;
        self.blocked_since = null;
    }

    pub fn nextSubscription(self: *Outbox) ?u16 {
        if (self.subscription_dirty.count() == 0) return null;
        for (0..self.subscription_dirty.bit_length) |_| {
            const index = self.subscription_cursor;
            if (self.subscription_dirty.isSet(index)) return @intCast(index);
            self.subscription_cursor = (index + 1) % self.subscription_dirty.bit_length;
        }
        return null;
    }

    pub fn announce(self: *Outbox, index: u16, name: []const u8, subscribed: bool, scratch: *ControlScratch, now: u64) bool {
        assert(self.subscription_dirty.isSet(index));
        if (self.submit(&.{ .subscription = .{ .topic = name, .subscribed = subscribed } }, scratch, now) == null) return false;
        self.subscription_dirty.unset(index);
        self.subscription_cursor = (index + 1) % self.subscription_dirty.bit_length;
        if (self.subscription_dirty.count() == 0) self.subscription_since = null;
        return true;
    }

    /// Encodes `control` into `scratch` and queues a copy, so `scratch` is free again on return.
    pub fn submit(self: *Outbox, control: *const Control, scratch: *ControlScratch, now_ms: u64) ?u64 {
        const critical = switch (control.*) {
            .subscription, .graft, .prune => true,
            else => false,
        };
        const bytes = control.encode(scratch);
        const token = self.appendControl(bytes, critical, now_ms) orelse return null;
        const counts: RpcCounts = switch (control.*) {
            .subscription => .{ .subscription = 1 },
            .graft => .{ .control = 1, .graft = 1 },
            .prune => .{ .control = 1, .prune = 1 },
            .ihave => .{ .control = 1, .ihave = 1 },
            .iwant => .{ .control = 1, .iwant = 1 },
            .idontwant => .{ .control = 1, .idontwant = 1 },
        };
        self.countRpc(bytes, &counts);
        return token;
    }

    /// Accumulates the heartbeat's topic advertisements into one control RPC per peer.
    /// Returns false when this advertisement exceeds the heartbeat's byte or ID budget.
    pub fn gossipTopic(self: *Outbox, name: []const u8, ids: []const topic.MessageId) bool {
        assert(name.len <= topic.topic_max_len and ids.len <= constants.gossip_ids_max);
        const body_len = wire.bytesFieldSize(1, name.len) + ids.len * wire.bytesFieldSize(2, constants.message_id_length);
        const entry_len = wire.bytesFieldSize(1, body_len);
        const rpc_len = wire.bytesFieldSize(3, self.gossip_len + entry_len);
        const frame_len = protobuf.varintLen(rpc_len) + rpc_len;
        if (self.gossip_ids + ids.len > constants.max_ihave_ids_per_heartbeat or
            frame_len > self.control.bytes.len or
            self.gossip.len < 10 or entry_len > self.gossip.len - 10 - self.gossip_len) return false;
        var writer = protobuf.Writer.init(self.gossip[10 + self.gossip_len ..]);
        writer.tag(1, protobuf.wire_len);
        writer.varint(body_len);
        writer.bytesField(1, name);
        for (ids) |id| protobuf.writeIhaveId(&writer, &id);
        self.gossip_len += writer.len;
        self.gossip_ids += ids.len;
        self.gossip_entries += 1;
        return true;
    }

    pub fn finishGossip(self: *Outbox, now_ms: u64) bool {
        if (self.gossip_len == 0) return false;
        var prefix: [10]u8 = undefined;
        var writer = protobuf.Writer.init(&prefix);
        const rpc_len = wire.bytesFieldSize(3, self.gossip_len);
        writer.varint(rpc_len);
        writer.tag(3, protobuf.wire_len);
        writer.varint(self.gossip_len);
        const begin = 10 - writer.len;
        @memcpy(self.gossip[begin..10], writer.written());
        assert(writer.len + self.gossip_len <= self.control.bytes.len);
        const result = self.appendControl(self.gossip[begin .. 10 + self.gossip_len], false, now_ms);
        if (result != null) self.rpc_sent.record(rpc_len, &.{ .control = 1, .ihave = self.gossip_entries });
        self.gossip_len = 0;
        self.gossip_ids = 0;
        self.gossip_entries = 0;
        return result != null;
    }

    pub fn inject(self: *Outbox, bytes: []const u8, now_ms: u64) bool {
        comptime assert(@import("builtin").is_test);
        return self.appendControl(bytes, false, now_ms) != null;
    }

    pub fn injectFrame(self: *Outbox, bytes: []const u8, critical: bool, now_ms: u64) ?u64 {
        comptime assert(@import("builtin").is_test);
        return self.appendControl(bytes, critical, now_ms);
    }

    fn appendControl(self: *Outbox, bytes: []const u8, critical: bool, now_ms: u64) ?u64 {
        if (self.sequence == std.math.maxInt(u64)) {
            self.dropped(.token_exhausted);
            return null;
        }
        const token = self.sequence + 1;
        const result = if (critical) self.critical.append(bytes, token, now_ms) else self.control.append(bytes, token, now_ms);
        if (result == .full) {
            self.dropped(if (critical)
                (if (self.critical.count == critical_frames) .critical_frames else .critical_bytes)
            else
                (if (self.control.count == control_frames) .control_frames else .control_bytes));
            return null;
        }
        self.sequence = token;
        return token;
    }

    /// A refusal leaves its reason in `last_drop`.
    pub fn queueData(self: *Outbox, store: *const storage.Store, h: storage.Handle, origin: delivery.Origin, limits: delivery.Limits, now_ms: u64) QueueResult {
        self.data.append(store, h, origin, limits, now_ms) catch |err| {
            self.dropped(switch (err) {
                error.Descriptors => .data_descriptors,
                error.PoolFull => .data_pool,
                error.Bytes => .data_bytes,
                error.KindDescriptors => .data_kind_descriptors,
                error.KindBytes => .data_kind_bytes,
            });
            const entry = store.get(h).?;
            self.last_drop_kind = entry.kind;
            if (self.data.trace_connection) |conn| if (trace.selected(entry.kind, entry.id)) {
                std.log.scoped(.network_gossip_trace).info("queue_refused message_id={x} kind={s} connection={d}:{d} reason={s}", .{ entry.id, @tagName(entry.kind), conn.index, conn.generation, @errorName(err) });
            };
            return .full;
        };
        self.countRpc(&store.get(h).?.frame, &.{ .message = 1 });
        return .queued;
    }
    fn countRpc(self: *Outbox, bytes: []const u8, counts: *const RpcCounts) void {
        var reader = protobuf.Reader.init(bytes);
        self.rpc_sent.record(@intCast(reader.varint() catch unreachable), counts);
    }
    fn dropped(self: *Outbox, reason: DropReason) void {
        self.drops[@intFromEnum(reason)] +|= 1;
        self.pressure_pending = true;
        self.last_drop = reason;
        self.last_drop_kind = null;
    }
    pub fn pending(self: *const Outbox) bool {
        return self.data.count != 0 or self.control.count != 0 or self.critical.count != 0;
    }
    pub fn segment(self: *Outbox, store: *storage.Store, now_ms: u64) []const u8 {
        for (0..data_capacity + 2) |_| {
            if (self.active == .none) {
                const data_first = self.data.count > 0 and self.control_burst >= 4;
                if (!data_first and self.critical.count > 0) {
                    self.active = .critical;
                } else if (!data_first and self.control.count > 0) {
                    self.active = .control;
                } else if (self.data.next(store, now_ms, self.queue_timeout_ms)) |tx| {
                    const acquired = active_send.Frame.acquire(store, tx.message, &self.small_frame, now_ms, self.active_send_timeout_ms) orelse {
                        const receipt = self.data.refuseActive();
                        self.dropped(.active_capacity);
                        self.last_drop_kind = receipt.kind;
                        self.control_burst = 0;
                        continue;
                    };
                    self.active = .{ .data = acquired.frame };
                    self.data.traceStarted();
                    self.active_deadline_ms = acquired.deadline_ms;
                } else if (self.critical.count > 0 or self.control.count > 0) {
                    self.control_burst = 0;
                    continue;
                } else return &.{};
                self.active_deadline_ms = self.active_deadline_ms orelse now_ms +| self.active_send_timeout_ms;
            }
            return switch (self.active) {
                .none => unreachable,
                .critical => self.critical.segment(),
                .control => self.control.segment(),
                .data => |*data| data.segment(&self.small_frame),
            };
        }
        unreachable;
    }
    pub fn advance(self: *Outbox, len: usize) ?Completion {
        const completion: Completion = switch (self.active) {
            .none => unreachable,
            .critical, .control => blk: {
                const receipt = (if (self.active == .critical) self.critical.advance(len) else self.control.advance(len)) orelse return null;
                self.control_burst +|= 1;
                break :blk .{ .control = receipt };
            },
            .data => |*data| blk: {
                if (!data.advance(len)) return null;
                data.deinit();
                self.control_burst = 0;
                break :blk .{ .data = self.data.complete() };
            },
        };
        self.active = .none;
        self.active_deadline_ms = null;
        return completion;
    }
    pub fn oldest(self: *const Outbox) ?u64 {
        var first = self.data.oldest();
        if (self.control.count > 0) first = @min(first orelse std.math.maxInt(u64), self.control.frames[self.control.head].enqueued_ms);
        if (self.critical.count > 0) first = @min(first orelse std.math.maxInt(u64), self.critical.frames[self.critical.head].enqueued_ms);
        return first;
    }

    pub fn controlOldest(self: *const Outbox) ?u64 {
        var first: ?u64 = null;
        if (self.control.count > 0) first = self.control.frames[self.control.head].enqueued_ms;
        if (self.critical.count > 0) first = @min(first orelse std.math.maxInt(u64), self.critical.frames[self.critical.head].enqueued_ms);
        return first;
    }

    pub fn startSession(self: *Outbox) void {
        assert(!self.pending() and self.data.count == 0);
        // Receipt tokens can still identify sent recovery promises on the same transport.
        self.* = .{
            .control = self.control,
            .gossip = self.gossip,
            .critical = self.critical,
            .data = self.data,
            .sequence = self.sequence,
            .active_send_timeout_ms = self.active_send_timeout_ms,
            .queue_timeout_ms = self.queue_timeout_ms,
            .subscription_dirty = self.subscription_dirty,
            .drops = self.drops,
            .rpc_sent = self.rpc_sent,
            .pressure_log_due_ms = self.pressure_log_due_ms,
            .last_drop = self.last_drop,
            .last_drop_kind = self.last_drop_kind,
            .ready = false,
        };
        self.subscription_dirty.setRangeValue(.{ .start = 0, .end = self.subscription_dirty.bit_length }, false);
        self.control.reset();
        self.critical.reset();
        self.gossip_len = 0;
        self.gossip_ids = 0;
        self.gossip_entries = 0;
    }

    pub fn cancelStream(self: *Outbox) void {
        if (self.active == .data) self.active.data.deinit();
        self.active_deadline_ms = null;
        self.subscription_dirty.setRangeValue(.{ .start = 0, .end = self.subscription_dirty.bit_length }, false);
        self.subscription_since = null;
        self.subscription_cursor = 0;
        self.control_burst = 0;
        self.data.reset();
        self.pressure_pending = false;
        self.active = .none;
        self.control.reset();
        self.critical.reset();
        self.gossip_len = 0;
        self.gossip_ids = 0;
        self.gossip_entries = 0;
        self.ready = false;
        self.blocked_since = null;
    }
};

test "gossip segmented prefix agrees with independent JS varint oracles" {
    const vectors = .{
        .{ @as(usize, 127), "ac0112a901127f" },
        .{ @as(usize, 128), "ae0112ab01128001" },
        .{ @as(usize, 16383), "ae800112aa800112ff7f" },
        .{ @as(usize, 16384), "b0800112ac800112808001" },
        .{ @as(usize, 12233418), "fcd5ea0512f7d5ea0512cad5ea05" },
    };
    inline for (vectors) |v| {
        var prefix: [32]u8 = undefined;
        var trailer: [128]u8 = undefined;
        const lens = encodePrefix(&prefix, &trailer, v[0], "/eth2/01000000/beacon_block/ssz_snappy");
        var expected: [32]u8 = undefined;
        const bytes = try std.fmt.hexToBytes(&expected, v[1]);
        try std.testing.expectEqualSlices(u8, bytes, prefix[0..lens.prefix]);
        try std.testing.expectEqualStrings("\x22\x26/eth2/01000000/beacon_block/ssz_snappy", trailer[0..lens.trailer]);
    }
}

test "gossip transmit never interleaves control into partial data" {
    var store = try storage.Store.init(std.testing.allocator, 2, 8192);
    defer store.deinit(std.testing.allocator);
    var normal: [64]u8 = undefined;
    var critical: [64]u8 = undefined;
    var deliveries = try delivery.Pool.init(std.testing.allocator, 1, data_capacity);
    defer deliveries.deinit(std.testing.allocator);
    var io: Outbox = .{ .data = .{ .pool = &deliveries }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    const h = store.put(.beacon_block, [_]u8{1} ** 20, "topic", "payload").?;
    store.retainHistory(h);
    store.seal(h);
    try std.testing.expectEqual(QueueResult.queued, io.queueData(&store, h, .forward, .{ .bytes = 8192 }, 0));
    var out: [128]u8 = undefined;
    var n: usize = 0;
    out[n] = (io.segment(&store, 0))[0];
    n += 1;
    _ = io.advance(1);
    const token = io.appendControl("\x01x", true, 0).?;
    for (0..127) |_| {
        const segment = io.segment(&store, 0);
        if (segment.len == 0) break;
        out[n] = segment[0];
        n += 1;
        if (io.advance(1)) |done| switch (done) {
            .control => |receipt| try std.testing.expectEqual(token, receipt.token),
            .data => try std.testing.expectEqual(@as(usize, 1), store.used_entries),
        };
    }
    try std.testing.expect(!io.pending());
    store.releaseHistory(h);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    var expected: [128]u8 = undefined;
    var writer = protobuf.Writer.init(&expected);
    writer.varint(protobuf.messageSize("payload", "topic"));
    protobuf.writeMessage(&writer, "payload", "topic");
    writer.bytes("\x01x");
    try std.testing.expectEqualSlices(u8, writer.written(), out[0..n]);
}

test "gossip critical capacity and data queue pressure are independent and release on reset" {
    var store = try storage.Store.init(std.testing.allocator, 1, 4096);
    defer store.deinit(std.testing.allocator);
    var normal: [8]u8 = undefined;
    var critical: [8]u8 = undefined;
    var deliveries = try delivery.Pool.init(std.testing.allocator, 1, data_capacity);
    defer deliveries.deinit(std.testing.allocator);
    var io: Outbox = .{ .data = .{ .pool = &deliveries }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    const h = store.put(.beacon_block, [_]u8{1} ** 20, "t", "x").?;
    store.retainHistory(h);
    store.seal(h);
    for (0..data_capacity) |_| try std.testing.expectEqual(QueueResult.queued, io.queueData(&store, h, .forward, .{ .bytes = 8192 }, 0));
    try std.testing.expectEqual(QueueResult.full, io.queueData(&store, h, .forward, .{ .bytes = 8192 }, 0));
    try std.testing.expect(io.inject("12345678", 0));
    try std.testing.expect(!io.inject("x", 0));
    try std.testing.expect(io.appendControl("critical", true, 0) != null);
    store.releaseHistory(h);
    io.cancelStream();
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(@as(usize, 1), store.free_pages);
    try std.testing.expectEqual(@as(u64, 1), io.drops[@intFromEnum(DropReason.data_descriptors)]);
    try std.testing.expectEqual(@as(u64, 1), io.drops[@intFromEnum(DropReason.control_bytes)]);
    try std.testing.expect(!io.pressure_pending);
}

test "gossip queues a full validation burst in order and preserves byte bounds" {
    const burst = 64;
    var store = try storage.Store.init(std.testing.allocator, burst, burst * 4096);
    defer store.deinit(std.testing.allocator);
    var normal: [8]u8 = undefined;
    var critical: [8]u8 = undefined;
    var deliveries = try delivery.Pool.init(std.testing.allocator, 1, data_capacity);
    defer deliveries.deinit(std.testing.allocator);
    var io: Outbox = .{ .data = .{ .pool = &deliveries }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    defer io.cancelStream();
    var expected: [4096]u8 = undefined;
    var writer = protobuf.Writer.init(&expected);
    for (0..burst) |i| {
        const payload = [_]u8{@intCast(i)};
        const h = store.put(.beacon_block, [_]u8{@intCast(i)} ** 20, "topic", &payload).?;
        store.retainHistory(h);
        store.seal(h);
        try std.testing.expectEqual(QueueResult.queued, io.queueData(&store, h, .forward, .{ .bytes = burst }, 0));
        writer.varint(protobuf.messageSize(&payload, "topic"));
        protobuf.writeMessage(&writer, &payload, "topic");
        if (i == burst - 1) try std.testing.expectEqual(QueueResult.full, io.queueData(&store, h, .forward, .{ .bytes = burst }, 0));
    }
    var actual: [4096]u8 = undefined;
    var used: usize = 0;
    for (0..burst * 3) |_| {
        const segment = io.segment(&store, 0);
        if (segment.len == 0) break;
        @memcpy(actual[used..][0..segment.len], segment);
        used += segment.len;
        _ = io.advance(segment.len);
    }
    try std.testing.expect(!io.pending());
    try std.testing.expectEqualSlices(u8, writer.written(), actual[0..used]);
    try std.testing.expectEqual(@as(usize, burst), store.used_entries);
    try std.testing.expectEqual(@as(usize, burst), store.free_pages);
    try std.testing.expectEqual(@as(u64, 1), io.drops[@intFromEnum(DropReason.data_bytes)]);
    try std.testing.expectEqual(@as(u64, 0), io.drops[@intFromEnum(DropReason.data_descriptors)]);
}

test "gossip control receipts survive partial writes ring reuse and refused frames" {
    var store = try storage.Store.init(std.testing.allocator, 1, 4096);
    defer store.deinit(std.testing.allocator);
    var normal: [4]u8 = undefined;
    var critical: [4]u8 = undefined;
    var deliveries = try delivery.Pool.init(std.testing.allocator, 1, data_capacity);
    defer deliveries.deinit(std.testing.allocator);
    var io: Outbox = .{ .data = .{ .pool = &deliveries }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    for (0..control_frames * 6) |_| {
        const token = io.appendControl("abc", false, 1).?;
        try std.testing.expect(io.appendControl("ab", false, 1) == null);
        for (0..3) |byte| {
            _ = io.segment(&store, 0);
            const receipt = io.advance(1);
            if (byte < 2) try std.testing.expect(receipt == null) else try std.testing.expectEqual(token, receipt.?.control.token);
        }
    }
    _ = io.appendControl("abc", false, 1).?;
    _ = io.segment(&store, 0);
    try std.testing.expect(io.advance(1) == null);
    io.cancelStream();
    try std.testing.expect(!io.pending());
}

test "gossip typed controls preserve maximum ID lists and completion kinds" {
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const ids: [constants.gossip_ids_max]topic.MessageId = @splat(@splat(7));
    const controls = [_]Control{
        .{ .subscription = .{ .topic = name, .subscribed = true } },
        .{ .graft = name },
        .{ .prune = .{ .topic = name, .backoff_s = std.math.maxInt(u64) } },
        .{ .ihave = .{ .topic = name, .ids = &ids } },
        .{ .iwant = &ids },
        .{ .idontwant = &ids },
    };
    var bytes: [8192]u8 = undefined;
    var deliveries = try delivery.Pool.init(std.testing.allocator, 1, data_capacity);
    defer deliveries.deinit(std.testing.allocator);
    var outbox: Outbox = .{ .data = .{ .pool = &deliveries }, .control = .{ .bytes = bytes[0..4096] }, .critical = .{ .bytes = bytes[4096..] } };
    var store = try storage.Store.init(std.testing.allocator, 1, 4096);
    defer store.deinit(std.testing.allocator);
    var scratch: ControlScratch = undefined;
    for (&controls) |*control| {
        const token = outbox.submit(control, &scratch, 1).?;
        var reader: frame.Reader = .{};
        var body: [4096]u8 = undefined;
        var received: ?[]const u8 = null;
        var completion: ?Completion = null;
        for (0..2) |_| {
            const segment = outbox.segment(&store, 0);
            if (segment.len == 0) break;
            const parsed = try reader.feed(segment, &body);
            received = parsed.frame;
            completion = outbox.advance(segment.len);
            if (completion != null) break;
        }
        var rpc = protobuf.RpcReader.init(received.?);
        const item = (try rpc.next()).?;
        const expected: ItemKind = switch (control.*) {
            inline else => |_, tag| @field(ItemKind, @tagName(tag)),
        };
        try std.testing.expectEqual(expected, @as(ItemKind, item));
        var iterator: ?protobuf.IdIterator = switch (item) {
            .ihave => |have| have.ids(),
            .iwant, .idontwant => |want| want.ids(),
            else => null,
        };
        if (iterator) |*it| {
            for (ids) |id| try std.testing.expectEqualSlices(u8, &id, (try it.next()).?);
            try std.testing.expect(try it.next() == null);
        }
        try std.testing.expect(try rpc.next() == null);
        try std.testing.expectEqual(token, completion.?.control.token);
        try std.testing.expect(!outbox.pending());
    }
}

test "gossip outboxes sharing one control scratch each queue a copy of their own frame" {
    var sessions = try test_support.sessions(std.testing.allocator, 2);
    defer sessions.deinit(std.testing.allocator);
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const ids: [constants.gossip_ids_max]topic.MessageId = @splat(@splat(7));
    const controls = [_]Control{ .{ .ihave = .{ .topic = name, .ids = &ids } }, .{ .graft = name } };
    for (&controls, sessions.rows[0..2]) |*control, *row| try std.testing.expect(row.io.tx.submit(control, &sessions.control_scratch, 1) != null);
    @memset(&sessions.control_scratch, 0xa5);
    var expected: ControlScratch = undefined;
    try std.testing.expectEqualSlices(u8, controls[0].encode(&expected), sessions.rows[0].io.tx.control.segment());
    try std.testing.expectEqual(@as(usize, 0), sessions.rows[0].io.tx.critical.count);
    try std.testing.expectEqualSlices(u8, controls[1].encode(&expected), sessions.rows[1].io.tx.critical.segment());
    try std.testing.expectEqual(@as(usize, 0), sessions.rows[1].io.tx.control.count);
}

test "gossip critical queue holds a full subscription snapshot and full PRUNE burst" {
    var sessions = try test_support.sessions(std.testing.allocator, 1);
    defer sessions.deinit(std.testing.allocator);
    const tx = &sessions.rows[0].io.tx;
    const name = "/eth2/01020304/sync_committee_contribution_and_proof/ssz_snappy";
    try std.testing.expectEqual(topic.topic_max_len, name.len);
    for (0..constants.topics_cap) |_| {
        try std.testing.expect(tx.submit(&.{ .subscription = .{ .topic = name, .subscribed = true } }, &sessions.control_scratch, 1) != null);
    }
    for (0..constants.topics_cap) |_| {
        try std.testing.expect(tx.submit(&.{ .prune = .{ .topic = name, .backoff_s = std.math.maxInt(u64) } }, &sessions.control_scratch, 2) != null);
    }
    try std.testing.expectEqual(critical_frames, tx.critical.count);
    try std.testing.expect(tx.submit(&.{ .prune = .{ .topic = name, .backoff_s = 60 } }, &sessions.control_scratch, 3) == null);
    try std.testing.expectEqual(@as(u64, 1), tx.drops[@intFromEnum(DropReason.critical_frames)]);
    for (0..critical_frames) |_| {
        const first = tx.critical.segment();
        try std.testing.expect(tx.critical.advance(1) == null);
        const rest = tx.critical.segment();
        try std.testing.expectEqual(first.len - 1, rest.len);
        try std.testing.expect(tx.critical.advance(rest.len) != null);
    }
    try std.testing.expectEqual(@as(usize, 0), tx.critical.used);
}

test "gossip full stale delivery queue yields to waiting control and returns every descriptor" {
    const a = std.testing.allocator;
    var pool = try delivery.Pool.init(a, 1, delivery.Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    var normal: [32]u8 = undefined;
    var critical: [32]u8 = undefined;
    var outbox: Outbox = .{ .data = .{ .pool = &pool }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    defer outbox.cancelStream();
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    for (0..data_capacity) |i| try outbox.data.append(&store, message, if (i % 2 == 0) .publication else .iwant, .{ .bytes = 1 << 20 }, 1);
    const token = outbox.appendControl("control", false, 2).?;
    outbox.control_burst = 4;
    store.releaseHistory(message);
    try std.testing.expectEqualStrings("control", outbox.segment(&store, 0));
    try std.testing.expectEqual(@as(usize, 0), outbox.data.count);
    try std.testing.expectEqual(@as(usize, 0), outbox.data.bytes);
    try std.testing.expectEqual(@as(usize, 0), outbox.data.local_bytes);
    for (outbox.data.origins) |count| try std.testing.expectEqual(@as(usize, 0), count);
    try std.testing.expectEqual(pool.slots.len, pool.available);
    try std.testing.expectEqual(@as(usize, delivery.per_peer_reserve), pool.protected);
    try std.testing.expectEqual(token, outbox.advance(7).?.control.token);
    try std.testing.expect(!outbox.pending());
}

test "gossip active capacity refusal drops pending data and immediately serves controls" {
    const a = std.testing.allocator;
    var pool = try delivery.Pool.init(a, 1, delivery.Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, 20 * storage.page_bytes);
    defer store.deinit(a);
    var normal: [32]u8 = undefined;
    var critical: [32]u8 = undefined;
    var tx: Outbox = .{ .data = .{ .pool = &pool }, .control = .{ .bytes = &normal }, .critical = .{ .bytes = &critical } };
    defer tx.cancelStream();
    const message = store.put(.beacon_block, @splat(1), "topic", &([_]u8{9} ** 70_000)).?;
    store.retainHistory(message);
    store.seal(message);
    try tx.data.append(&store, message, .publication, .{ .bytes = 100_000 }, 1);
    _ = tx.appendControl("control", true, 1).?;
    tx.control_burst = 4;
    try std.testing.expectEqualStrings("control", tx.segment(&store, 2));
    try std.testing.expectEqual(@as(usize, 0), tx.data.count);
    try std.testing.expectEqual(@as(u64, 1), tx.drops[@intFromEnum(DropReason.active_capacity)]);
    try std.testing.expectEqual(@as(?topic.Kind, .beacon_block), tx.last_drop_kind);
    try std.testing.expectEqual(@as(u16, 0), store.get(message).?.senders);
    try std.testing.expectEqual(@as(?u64, 6002), tx.active_deadline_ms);
    _ = tx.advance(7).?;
    try std.testing.expect(tx.active_deadline_ms == null);
    store.releaseHistory(message);
}
