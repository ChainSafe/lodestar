const std = @import("std");
const constants = @import("constants.zig");
const topic_mod = @import("topic.zig");
const Engine = @import("../quic/Engine.zig");
const index_list = @import("../index_list.zig");
const DeadlineHeap = @import("../deadline_heap.zig").DeadlineHeap;
const Options = @import("options.zig").Options;
const ControlScratch = @import("outbox.zig").ControlScratch;
const peer_session = @import("peer_session.zig");
const layout_mod = @import("layout.zig");
const receive_pool_mod = @import("receive_pool.zig");

const assert = std.debug.assert;
const Handle = Engine.Handle;
const StreamHandle = Engine.StreamHandle;
const MessageId = [constants.message_id_length]u8;
pub const PeerSet = std.StaticBitSet(constants.peers_cap);

pub const Version = @import("protocol.zig").Version;

pub const SessionRef = struct { index: u16, generation: u64 };

const ReceivePool = @import("receive_pool.zig").ReceivePool;
const DeliveryPool = @import("delivery.zig").Pool;
const PeerIo = @import("peer_io.zig").PeerIo;

const Session = @import("peer_session.zig").Session;

/// A `by_connection` entry with no session.
const no_session = std.math.maxInt(u16);

pub const Sessions = struct {
    rows: []Session,
    /// Sessions that can make progress now (see `Session.wants`), in the order they became ready.
    ready: index_list.List = .{},
    /// Active sessions keyed on their earliest IO deadline or outbound retry, in ms.
    deadlines: DeadlineHeap,
    /// Per engine connection index, the session on that connection or `no_session`.
    by_connection: []u16,
    /// Sessions taken from the ready list or the deadline heap. An idle mesh visits none.
    visits: u64 = 0,
    /// Stream writes attempted, and those QUIC did not take in full, which the readiness tests
    /// read to show a blocked stream is written again only after it gains capacity.
    writes: u64 = 0,
    blocked_writes: u64 = 0,
    delivery_changed: bool = false,
    io_arena: []u8,
    subscription_words: []usize,
    receive_pool: ReceivePool,
    decode_scratch: []u8,
    deliveries: *DeliveryPool,
    /// Control encoding storage every outbox's `submit` borrows for one call. A field rather than
    /// a local so ReleaseSafe does not fill it for every control frame.
    control_scratch: ControlScratch = undefined,

    /// Prefer frames below 25% completion, then reclaim the most pages within that band.
    /// Completion buys a preference, never a reservation or immunity from eviction.
    pub fn receiveVictim(self: *const Sessions, incoming: u16) ?u16 {
        var victim = incoming;
        for (self.rows, 0..) |*session, index| {
            const io = &session.io;
            if (!session.active or io.rpc != null or io.discarding or io.overflow.pages == 0) continue;
            const current = &self.rows[victim].io;
            const early = io.reader.filled * 4 < io.reader.declaredLen().?;
            const current_early = current.reader.filled * 4 < (current.reader.declaredLen() orelse 0);
            if (current.overflow.pages == 0 or
                (early and !current_early) or
                (early == current_early and io.overflow.pages > current.overflow.pages))
                victim = @intCast(index);
        }
        return if (victim == incoming) null else victim;
    }

    /// An opening or a close is ready work. Callers settle any other change.
    pub fn setOutbound(self: *Sessions, index: u16, outbound: peer_session.Outbound) void {
        assert(self.rows[index].active);
        self.rows[index].outbound = outbound;
        self.delivery_changed = true;
        if (outbound == .pending or outbound == .closing) self.markReady(index);
    }

    pub fn init(a: std.mem.Allocator, options: *const Options, layout: *const layout_mod.Layout) !Sessions {
        const rows = try a.alloc(Session, layout.sessions);
        errdefer a.free(rows);
        const words_per_peer = (@as(usize, layout.topics) + @bitSizeOf(usize) - 1) / @bitSizeOf(usize);
        const subscription_words = try a.alloc(usize, rows.len * words_per_peer);
        errdefer a.free(subscription_words);
        @memset(subscription_words, 0);
        const per_peer = layout.session_buffer_bytes;
        const arena = try a.alloc(u8, rows.len * per_peer);
        errdefer a.free(arena);
        const receive_pool = try ReceivePool.init(a, layout.receive_arena_bytes);
        errdefer {
            var pool = receive_pool;
            pool.deinit(a);
        }
        const decode_scratch = try a.alloc(u8, constants.GOSSIP_MAX_SIZE);
        errdefer a.free(decode_scratch);
        const by_connection = try a.alloc(u16, layout.connection_slots);
        errdefer a.free(by_connection);
        @memset(by_connection, no_session);
        var deadlines = try DeadlineHeap.init(a, @intCast(rows.len));
        errdefer deadlines.deinit(a);
        const deliveries = try a.create(DeliveryPool);
        errdefer a.destroy(deliveries);
        deliveries.* = try DeliveryPool.init(a, rows.len, layout.deliveries);
        deliveries.local_descriptors = constants.tx_local_descriptors;
        deliveries.kind_limits = options.deliveryKindLimits();
        for (rows, 0..) |*row, i| {
            row.* = .{ .io = PeerIo.init(arena[i * per_peer ..][0..per_peer], options, deliveries) };
            row.io.tx.subscription_dirty = .{ .bit_length = layout.topics, .masks = subscription_words[i * words_per_peer ..].ptr };
        }
        return .{ .rows = rows, .deadlines = deadlines, .by_connection = by_connection, .io_arena = arena, .subscription_words = subscription_words, .receive_pool = receive_pool, .decode_scratch = decode_scratch, .deliveries = deliveries };
    }

    pub fn metadataBytes(layout: *const layout_mod.Layout) usize {
        return @as(usize, layout.sessions) * (@sizeOf(Session) + @sizeOf(DeadlineHeap.Entry) + @sizeOf(u32)) + @sizeOf(DeliveryPool) +
            @as(usize, layout.connection_slots) * @sizeOf(u16) +
            @as(usize, layout.sessions) * ((@as(usize, layout.topics) + @bitSizeOf(usize) - 1) / @bitSizeOf(usize)) * @sizeOf(usize) +
            DeliveryPool.backingBytes(layout.deliveries) + layout.receive_arena_bytes / receive_pool_mod.page_bytes * @sizeOf(u32);
    }

    pub fn deinit(self: *Sessions, a: std.mem.Allocator) void {
        self.deliveries.deinit(a);
        self.deadlines.deinit(a);
        a.free(self.by_connection);
        a.destroy(self.deliveries);
        self.receive_pool.deinit(a);
        a.free(self.decode_scratch);
        a.free(self.rows);
        a.free(self.io_arena);
        a.free(self.subscription_words);
    }

    // Peers ------------------------------------------------------------------

    /// A connection index past `by_connection`, or one whose previous session was not yet
    /// retired, is refused like a full table.
    pub fn addPeer(self: *Sessions, conn: Handle) ?SessionRef {
        if (conn.index >= self.by_connection.len or self.by_connection[conn.index] != no_session) return null;
        const index = self.freePeer() orelse return null;
        const peer = &self.rows[index];
        peer.start(conn);
        self.by_connection[conn.index] = @intCast(index);
        self.delivery_changed = true;
        self.markReady(@intCast(index));
        return .{ .index = @intCast(index), .generation = peer.generation };
    }

    pub fn removePeer(self: *Sessions, index: u16) void {
        assert(index < self.rows.len);
        const row = &self.rows[index];
        if (!row.active) return;
        assert(row.io.overflow.pages == 0 and row.io.rpc == null and !row.io.tx.pending());
        self.setOutbound(index, .none);
        row.active = false;
        row.in_stream = null;
        assert(self.by_connection[row.conn.index] == index);
        self.by_connection[row.conn.index] = no_session;
        if (row.ready_link.linked) self.ready.remove(self.rows, "ready_link", index);
        self.deadlines.clear(index);
    }

    /// The session on the connection. O(1).
    pub fn find(self: *const Sessions, conn: Handle) ?u16 {
        if (conn.index >= self.by_connection.len) return null;
        const index = self.by_connection[conn.index];
        if (index == no_session) return null;
        const row = &self.rows[index];
        if (!row.active or !std.meta.eql(row.conn, conn)) return null;
        return index;
    }

    /// Queues the session for service. Idempotent.
    pub fn markReady(self: *Sessions, index: u16) void {
        assert(self.rows[index].active);
        _ = self.ready.insert(self.rows, "ready_link", index);
    }

    /// Brings the session's scheduling in line with its state: it joins the ready list when it
    /// wants service, and its heap key is its earliest deadline. Only servicing takes a session
    /// off the ready list. Every change to a session's streams, queues or timers ends here.
    pub fn settle(self: *Sessions, index: u16, options: *const Options) void {
        const row = &self.rows[index];
        if (!row.active) return;
        if (row.wants()) self.markReady(index);
        if (row.deadline(options)) |key| self.deadlines.set(index, key) else self.deadlines.clear(index);
    }

    /// Ends a session's service: it stays on the ready list, at the tail, only while it still
    /// wants service. A mark made during its own service by work that the service then finished
    /// is dropped.
    pub fn serviced(self: *Sessions, index: u16, options: *const Options) void {
        const row = &self.rows[index];
        if (!row.active) return;
        if (row.ready_link.linked and !row.wants()) self.ready.remove(self.rows, "ready_link", index);
        self.settle(index, options);
    }

    pub fn peerGeneration(self: *const Sessions, index: u16) u64 {
        return self.rows[index].generation;
    }

    pub fn ref(self: *const Sessions, index: u16) SessionRef {
        assert(self.rows[index].active);
        return .{ .index = index, .generation = self.rows[index].generation };
    }

    pub fn matches(self: *const Sessions, session: SessionRef) bool {
        return session.index < self.rows.len and self.rows[session.index].active and self.rows[session.index].generation == session.generation;
    }

    pub fn outStream(self: *const Sessions, index: u16) ?StreamHandle {
        return self.rows[index].outStream();
    }

    pub fn suppress(self: *Sessions, index: u16, id: MessageId, now: u64, ttl: u64) void {
        assert(self.rows[index].active);
        self.rows[index].suppress(id, now, ttl);
    }

    pub fn suppresses(self: *const Sessions, index: u16, id: MessageId, now: u64) bool {
        return self.rows[index].active and self.rows[index].suppresses(id, now);
    }

    pub fn receiveHandoff(self: *Sessions, index: u16, bytes: []const u8, fin: bool) bool {
        const io = &self.rows[index].io;
        if (bytes.len > io.unread.len - io.unread_end) return false;
        @memcpy(io.unread[io.unread_end..][0..bytes.len], bytes);
        io.unread_end += bytes.len;
        io.fin_seen = fin;
        io.rx_ready = true;
        return true;
    }

    pub fn finishFrame(self: *Sessions, peer_io: *PeerIo) bool {
        const released = peer_io.overflow.pages != 0;
        peer_io.rpc = null;
        self.receive_pool.release(&peer_io.overflow);
        peer_io.finishFrame();
        return released;
    }

    pub fn discardFrame(self: *Sessions, io: *PeerIo) void {
        if (io.rpc != null) {
            _ = self.finishFrame(io);
        } else {
            std.debug.assert(io.reader.declaredLen() != null);
            self.receive_pool.release(&io.overflow);
            io.discarding = true;
        }
        io.rx_ready = true;
    }

    pub fn resetRx(self: *Sessions, index: u16) bool {
        const io = &self.rows[index].io;
        const released = self.finishFrame(io);
        io.unread_start = 0;
        io.unread_end = 0;
        io.fin_seen = false;
        io.rx_ready = false;
        return released;
    }

    fn freePeer(self: *Sessions) ?usize {
        for (self.rows, 0..) |*peer, index| {
            if (!peer.active and peer.generation != std.math.maxInt(u64)) return index;
        }
        return null;
    }
};

test {
    _ = @import("sessions_test.zig");
}
