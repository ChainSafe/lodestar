//! Shared driver for the stateful gossip harnesses: one Gossipsub instance without a
//! transport, several sessions fed decoded RPC items, a bounded pending-validation sink,
//! and whole-table invariants checked between steps.
const std = @import("std");
const network = @import("network");
const snappy = @import("snappy");
const gossip = network.gossipsub;
const support = gossip.testing;
const topic_fixture = gossip.topic_fixture;
const Gossipsub = gossip.Gossipsub;
const protobuf = gossip.protobuf;
const Now = network.Now;
const PeerId = network.PeerId;
const Handle = network.Handle;
const assert = std.debug.assert;

pub const Credits = std.meta.Child(@typeInfo(@TypeOf(Gossipsub.receiveItem)).@"fn".params[4].type.?);
pub const Progress = @typeInfo(@TypeOf(Gossipsub.receiveItem)).@"fn".return_type.?;
pub const Verdict = Gossipsub.Verdict;
pub const MessageId = Gossipsub.MessageId;
pub const Store = @FieldType(@FieldType(Gossipsub, "messages"), "store");
pub const peers_max = 16;
pub const pending_max = 16;
pub const known_max = 32;
pub const payload_max = 8 * 1024;
pub const ids_max = gossip.constants.max_ihave_ids_per_heartbeat;

pub const topics = [_][]const u8{
    "/eth2/01020304/beacon_block/ssz_snappy",
    "/eth2/01020304/beacon_attestation_0/ssz_snappy",
    "/eth2/01020304/beacon_attestation_1/ssz_snappy",
    "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy",
    "/eth2/01020304/sync_committee_0/ssz_snappy",
    "/eth2/05060708/beacon_block/ssz_snappy",
    "/eth2/01020304/beacon_attestation_777/ssz_snappy",
    "/eth2/01020304/unknown_kind/ssz_snappy",
};
/// Topics the local node subscribes to at startup.
pub const local_topics = topics[0..4];
const topic_policies = [_]gossip.topic_policy.Boundary{topic_fixture.bytes(.{ 1, 2, 3, 4 })};

pub const Cursor = struct {
    bytes: []const u8,
    offset: usize = 0,

    pub fn next(self: *Cursor) ?u8 {
        if (self.offset == self.bytes.len) return null;
        self.offset += 1;
        return self.bytes[self.offset - 1];
    }

    /// Zero once the input is exhausted, so every parameter stays defined.
    pub fn byte(self: *Cursor) u8 {
        return self.next() orelse 0;
    }
};

pub const Overrides = struct {
    peers: u16 = 4,
    retained: u16 = 9,
    validation: usize = 8,
    heartbeat_ms: u64 = 20,
    followup_ms: u64 = 30,
};

pub fn options(o: Overrides) Gossipsub.Options {
    return .{
        .topic_policy = &topic_policies,
        .random_seed = 1,
        .connected_capacity = o.peers,
        .connection_slots = peers_max,
        .retained_capacity = o.retained,
        .retained_outbound_reserve = 1,
        .validation_capacity = o.validation,
        .mcache_capacity = 16,
        .seen_capacity = 64,
        .mcache_arena_bytes = gossip.constants.maxCompressedLen(gossip.constants.MAX_PAYLOAD_SIZE) + 64 * 1024,
        .body_buffer_bytes = 4096,
        .receive_arena_bytes = std.mem.alignForward(usize, gossip.constants.GOSSIP_MAX_SIZE, gossip.receive_pool.page_bytes),
        .validation_timeout_ms = 50,
        .validation_tombstone_ms = 50,
        .heartbeat_interval_ms = o.heartbeat_ms,
        .iwant_followup_ms = o.followup_ms,
        .seen_ttl_ms = 400,
        .active_send_timeout_ms = 40,
        .tx_timeout_ms = 120,
        .pressure_timeout_ms = 120,
        .large_frame_timeout_ms = 40,
        .retained_score_ms = 500,
        .active_send_items = @splat(2),
        .score_params = .{ .decay_interval_ms = 40 },
    };
}

/// Admits candidates while it has room and keeps their handles for later verdicts.
pub const Sink = struct {
    sink: Gossipsub.MessageSink = undefined,
    handles: [pending_max]Gossipsub.ValidationHandle = undefined,
    ids: [pending_max]MessageId = undefined,
    len: usize = 0,
    refuse: bool = false,
    admitted: u64 = 0,

    fn attach(self: *Sink, g: *Gossipsub) void {
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        g.message_sink = &self.sink;
    }

    fn hasCapacity(context: *anyopaque, _: gossip.topic.Kind, _: usize) bool {
        const self: *Sink = @ptrCast(@alignCast(context));
        return !self.refuse and self.len < pending_max;
    }

    fn admit(context: *anyopaque, candidate: *Gossipsub.MessageAdmission) bool {
        const self: *Sink = @ptrCast(@alignCast(context));
        if (self.refuse or self.len == pending_max or !candidate.sourceRoom()) return false;
        const room = candidate.room();
        if (!candidate.fits(&room)) return false;
        candidate.commit();
        self.handles[self.len] = candidate.event.handle;
        self.ids[self.len] = candidate.event.id;
        self.len += 1;
        self.admitted += 1;
        return true;
    }

    pub fn take(self: *Sink, at: usize) ?Gossipsub.ValidationHandle {
        if (self.len == 0) return null;
        const index = at % self.len;
        const handle = self.handles[index];
        self.len -= 1;
        self.handles[index] = self.handles[self.len];
        self.ids[index] = self.ids[self.len];
        return handle;
    }
};

pub const Harness = struct {
    g: Gossipsub,
    sink: Sink = .{},
    now_ms: u64 = 1,
    generations: [peers_max]u32 = @splat(0),
    conns: [peers_max]?Handle = @splat(null),
    counter: u64 = 0,
    known: [known_max]MessageId = undefined,
    known_len: usize = 0,
    payload: [payload_max]u8 = undefined,
    compressed: [payload_max + payload_max / 6 + 64]u8 = undefined,
    ids: [ids_max]MessageId = undefined,
    body: [ids_max * 24]u8 = undefined,

    pub fn init(self: *Harness, allocator: std.mem.Allocator, o: Overrides) !void {
        self.* = .{ .g = try support.init(allocator, options(o)) };
        errdefer self.g.deinit();
        self.g.clock = .{ .userdata = self, .vtable = &clock_vtable };
        self.sink.attach(&self.g);
        for (local_topics) |topic| try support.subscribe(&self.g, topic);
    }

    /// Closes every peer and drains the engine, then checks that every pooled resource came
    /// back. A fork child stops here: the kernel reclaims its copy of the snapshot, whereas
    /// freeing it fills a hundred megabytes with undefined bytes and copies every page.
    pub fn settle(self: *Harness) void {
        const g = &self.g;
        for (0..peers_max) |index| self.closePeer(index);
        g.messages.validation.clear(&g.messages.store, &g.peers);
        g.recovery.clear(&g.peers);
        for (0..g.overlay.rows.len) |_| {
            if (!g.cycle.isActive()) break;
            g.maintainTopics(self.now());
        }
        assert(!g.cycle.isActive());
        for (0..gossip.constants.mcache_len + 1) |_| support.ageHistory(g);
        assert(g.messages.store.used_entries == 0);
        assert(g.messages.store.free_pages == g.messages.store.next.len);
        for (g.peers.rows) |peer| assert(peer.pins == 0);
        assert(g.recovery.len == 0);
        assert(g.sessions.deliveries.available == g.sessions.deliveries.slots.len);
        assert(g.sessions.receive_pool.free_pages == g.sessions.receive_pool.next.len);
    }

    pub fn deinit(self: *Harness) void {
        self.settle();
        self.g.message_sink = null;
        self.g.deinit();
    }

    const clock_vtable: std.Io.VTable = blk: {
        var vtable = std.Io.failing.vtable.*;
        vtable.now = readClock;
        break :blk vtable;
    };

    fn readClock(context: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
        const self: *const Harness = @ptrCast(@alignCast(context.?));
        return .fromNanoseconds(@as(i96, self.now_ms) * std.time.ns_per_ms);
    }

    pub fn now(self: *const Harness) Now {
        return Now.fromMilliseconds(.{ .mono_ms = self.now_ms, .unix_s = 1 });
    }

    pub fn identity(index: usize) PeerId {
        var id: PeerId = .{ .bytes = @splat(0) };
        id.bytes[0] = @intCast(index + 1);
        return id;
    }

    pub fn addPeer(self: *Harness, index: usize) bool {
        const slot = index % self.g.options.connected_capacity;
        if (self.conns[slot] != null) return false;
        self.generations[slot] += 1;
        const conn: Handle = .{ .index = @intCast(slot), .generation = self.generations[slot] };
        const metadata: @typeInfo(@TypeOf(Gossipsub.addPeer)).@"fn".params[2].type.? = &.{
            .identity = identity(slot),
            .address = .unspecified,
            .direction = if (slot % 2 == 0) .inbound else .outbound,
        };
        switch (self.g.addPeer(conn, metadata, self.now())) {
            .admitted => |peer| {
                self.g.sessions.setOutbound(peer.index, .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } });
                self.g.sendSubscriptions(peer.index);
                self.conns[slot] = conn;
                return true;
            },
            else => return false,
        }
    }

    pub fn closePeer(self: *Harness, index: usize) void {
        const slot = index % self.g.options.connected_capacity;
        const conn = self.conns[slot] orelse return;
        self.g.connectionClosed(conn);
        self.conns[slot] = null;
    }

    pub fn session(self: *const Harness, index: usize) ?u16 {
        const conn = self.conns[index % self.g.options.connected_capacity] orelse return null;
        return self.g.sessions.find(conn);
    }

    /// Delivers one decoded control item as the session's RPC would.
    pub fn control(self: *Harness, index: usize, item: protobuf.Item) Progress {
        const session_index = self.session(index) orelse return .done;
        const io = &self.g.sessions.rows[session_index].io;
        if (io.rpc != null) return .done;
        io.startRpc(&.{});
        defer io.rpc = null;
        var turn = self.g.beginPump(self.now());
        var credits = Credits.peer(&self.g.options);
        return self.g.receiveItem(self.g.sessions.ref(session_index), item, &turn, &credits);
    }

    /// Delivers one message whose payload is `len` bytes seeded by `seed`; a repeated seed repeats the id.
    pub fn message(self: *Harness, index: usize, topic: []const u8, len: usize, seed: u64) Progress {
        const size = @min(len, payload_max);
        @memset(self.payload[0..size], @truncate(seed));
        if (size >= 8) std.mem.writeInt(u64, self.payload[0..8], seed, .little);
        return self.deliver(index, topic, self.payload[0..size]);
    }

    /// Delivers `payload` as a snappy-compressed message from the session.
    pub fn deliver(self: *Harness, index: usize, topic: []const u8, payload: []const u8) Progress {
        const session_index = self.session(index) orelse return .done;
        assert(payload.len <= payload_max);
        const compressed_len = snappy.raw.compress(payload, &self.compressed) catch unreachable;
        var turn = self.g.beginPump(self.now());
        var credits = Credits.peer(&self.g.options);
        return self.g.receiveItem(self.g.sessions.ref(session_index), .{ .message = .{ .data = self.compressed[0..compressed_len], .topic = topic } }, &turn, &credits);
    }

    /// The id the message `message(.., topic, len, seed)` will carry, for IHAVE announcements.
    pub fn plannedId(self: *Harness, topic: []const u8, len: usize, seed: u64) MessageId {
        const size = @min(len, payload_max);
        @memset(self.payload[0..size], @truncate(seed));
        if (size >= 8) std.mem.writeInt(u64, self.payload[0..8], seed, .little);
        return gossip.topic.validMessageId(topic, self.payload[0..size], self.g.options.message_id_policy);
    }

    pub fn cancelPromises(self: *Harness, index: usize, local_pressure: bool) void {
        const session_index = self.session(index) orelse return;
        _ = self.g.cancelPromises(session_index, local_pressure);
    }

    pub fn publish(self: *Harness, topic: []const u8, len: usize, seed: u64) void {
        const size = @min(len, payload_max);
        @memset(self.payload[0..size], @truncate(seed));
        if (size >= 8) std.mem.writeInt(u64, self.payload[0..8], seed, .little);
        _ = self.g.publish(topic, self.payload[0..size], self.now()) catch {};
    }

    /// Remembers an id the harness can refer to in later IHAVE, IWANT and IDONTWANT items.
    pub fn remember(self: *Harness, id: MessageId) void {
        self.known[self.counter % known_max] = id;
        if (self.known_len < known_max) self.known_len += 1;
        self.counter += 1;
    }

    /// Fills `count` ids: known ones when `fresh` is false, otherwise unseen ones.
    pub fn fillIds(self: *Harness, count: usize, fresh: bool, seed: u64) []const MessageId {
        const n = @min(count, ids_max);
        for (self.ids[0..n], 0..) |*id, i| {
            if (!fresh and self.known_len > 0) {
                id.* = self.known[(seed + i) % self.known_len];
            } else {
                id.* = @splat(0);
                std.mem.writeInt(u64, id[0..8], seed *% 1_000_003 +% i, .little);
                id[8] = 0xff;
            }
        }
        return self.ids[0..n];
    }

    /// Encodes ids as the repeated bytes field `field` of a control message body.
    pub fn idBody(self: *Harness, field: u32, ids: []const MessageId) []const u8 {
        var writer = protobuf.Writer.init(&self.body);
        for (ids) |*id| writer.bytesField(field, id);
        return writer.written();
    }

    pub fn drain(self: *Harness, index: usize, take: usize) void {
        const session_index = self.session(index) orelse return;
        const ref = self.g.sessions.ref(session_index);
        const segment = self.g.writeSegment(ref);
        if (segment.len == 0) return;
        self.g.advanceWrite(ref, @max(1, @min(take, segment.len)), self.now_ms);
    }

    pub fn cancelWrites(self: *Harness, index: usize) void {
        const session_index = self.session(index) orelse return;
        self.g.cancelWrites(self.g.sessions.ref(session_index));
    }

    pub fn penalize(self: *Harness, index: usize, amount: f64) void {
        const session_index = self.session(index) orelse return;
        self.g.peers.scores.penalize(self.g.logical(session_index).index, amount);
    }

    pub fn report(self: *Harness, at: usize, verdict: Verdict) void {
        const handle = self.sink.take(at) orelse return;
        _ = self.g.report(handle, verdict, self.now());
    }

    pub fn advance(self: *Harness, ms: u64) void {
        self.now_ms += ms;
        _ = self.g.beginPump(self.now());
        if (self.g.tick(self.now())) self.g.expirePromises(self.now_ms);
        self.g.finishPump(self.now());
    }

    pub fn checkInvariants(self: *Harness) void {
        const g = &self.g;
        g.checkScheduling();
        const store = &g.messages.store;
        const validation = &g.messages.validation;
        var senders: [4096]u16 = @splat(0);
        assert(store.entries.len <= senders.len);
        var queued: usize = 0;
        var protected: usize = 0;
        for (g.sessions.rows) |*row| {
            const tx = &row.io.tx;
            if (tx.active == .data and tx.active.data == .shared) {
                const shared = tx.active.data.shared.message;
                assert(store.get(shared) != null);
                senders[shared.index] += 1;
            }
            queued += tx.data.count;
            const local = tx.data.origins[@intFromEnum(gossip.delivery.Origin.publication)];
            protected += @max(gossip.delivery.per_peer_reserve -| tx.data.count, g.sessions.deliveries.local_descriptors -| local);
        }
        var entries: usize = 0;
        var pages: usize = 0;
        var history: usize = 0;
        var pending: usize = 0;
        for (store.entries, 0..) |entry, i| {
            assert(entry.senders == senders[i]);
            if (!entry.active) continue;
            assert(!entry.provisional);
            assert(entry.validation or entry.history or entry.senders > 0);
            entries += 1;
            pages += Store.pagesFor(entry.len);
            history += @intFromBool(entry.history);
            pending += @intFromBool(entry.validation);
        }
        assert(entries == store.used_entries);
        assert(pages + store.free_pages == store.next.len);
        assert(history == g.messages.history.count);
        const deliveries = g.sessions.deliveries;
        assert(queued + deliveries.available == deliveries.slots.len);
        assert(protected == deliveries.protected and deliveries.available >= protected);
        var pins: [gossip.constants.retained_peers_cap]u32 = @splat(0);
        var records: usize = 0;
        for (validation.recent) |record| {
            if (record.state != .pending) continue;
            records += 1;
            assert(g.messages.known(record.id, self.now_ms));
            assert(!g.messages.seen.contains(record.id, self.now_ms));
            assert(g.peers.matches(record.source));
            pins[record.source.index] += 1;
            for (record.duplicates[0..record.duplicate_len]) |duplicate| {
                assert(g.peers.matches(duplicate.peer));
                pins[duplicate.peer.index] += 1;
            }
        }
        assert(records == pending);
        for (g.recovery.batches[0..g.recovery.batch_len]) |batch| {
            assert(g.peers.matches(batch.peer));
            pins[batch.peer.index] += 1;
        }
        var pinned: u16 = 0;
        for (g.peers.rows, 0..) |peer, i| {
            assert(peer.pins == pins[i]);
            pinned += @intFromBool(pins[i] > 0);
        }
        assert(g.peers.pinned == pinned and pinned <= g.peers.pin_limit);
        assert(g.recovery.len <= gossip.constants.promises_cap);
        assert(g.recovery.available() == gossip.constants.promises_cap - g.recovery.len);
        for (g.sessions.rows) |*row| {
            if (!row.active) continue;
            assert(std.math.isFinite(g.peers.snapshot(row.logical, self.now_ms)));
        }
        const snapshot = g.resourceSnapshot();
        assert(snapshot.queued_descriptors == queued);
        assert(snapshot.promises == g.recovery.len);
        assert(snapshot.pending_validations == pending);
    }
};
