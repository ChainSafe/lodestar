const std = @import("std");
const time = @import("../time.zig");
const session_io = @import("session_io.zig");
const rpc_handler = @import("rpc_handler.zig");
const Router = @import("../router.zig").Router;
const index_list = @import("../index_list.zig");
const snappy = @import("snappy");
const constants = @import("constants.zig");
const topic_policy = @import("topic_policy.zig");
const local_intent = @import("local_intent.zig");
const topic_mod = @import("topic.zig");
const storage = @import("message_store.zig");
const validation_mod = @import("validation.zig");
const Recovery = @import("recovery.zig").Recovery;
const overlay_mod = @import("overlay.zig");
const peers_mod = @import("peer_book.zig");
const sessions_mod = @import("sessions.zig");
const Engine = @import("../quic/Engine.zig");
const types = @import("../types.zig");
const messages_mod = @import("messages.zig");
const heartbeat_cycle = @import("heartbeat_cycle.zig");
const outbox_mod = @import("outbox.zig");
const metrics = @import("metrics.zig");
const logging = @import("../logging.zig");
const delivery = @import("delivery.zig");
const trace = @import("trace.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Handle = Engine.Handle;
const Now = types.Now;
const timing = @import("../metrics/timing.zig");
const Sessions = sessions_mod.Sessions;

allocator: Allocator,
options: Options,
memory: MemoryPlan,
sessions: *Sessions,
peers: peers_mod.PeerBook,
messages: messages_mod.Messages,
/// The sink and its context must outlive every pump that uses them.
message_sink: ?*const MessageSink = null,
trace_gossip: bool = false,
cycle: heartbeat_cycle.Cycle,
/// The clock that bounds each maintenance slice.
clock: std.Io = std.Io.Threaded.global_single_threaded.io(),
retired_queue_drops: [outbox_mod.drop_reason_count]u64 = @splat(0),
overlay: *overlay_mod.Overlay,
heartbeat_at: u64 = 0,
opportunistic_at: u64 = 0,
last_now_ms: u64 = 0,
msg_scratch: []u8,
recovery: Recovery,
counters: Counters = .{},
topic_metrics: metrics.Topics = .{},
rpc_received: metrics.RpcCounters = .{},
retired_rpc_sent: metrics.RpcCounters = .{},
iwant_outcomes: [metrics.iwant_outcome_count]u64 = @splat(0),
delivery_metrics: metrics.Delivery = .{},
validation_time: metrics.ValidationTime = .{},
receive_timeouts: [constants.peers_cap]ReceiveTimeout = undefined,
receive_timeouts_len: u16 = 0,

pub const Options = @import("options.zig").Options;

pub const InitError = Allocator.Error || error{InvalidLimits} || topic_policy.Error;

pub const ReceiveTimeout = struct { identity: PeerId, origin: types.PeerOrigin };

pub const MessageId = topic_mod.MessageId;

pub const Verdict = validation_mod.Verdict;
pub const ValidationHandle = validation_mod.Handle;
pub const ReportOutcome = validation_mod.Outcome;
pub const MessageAdmission = @import("message_admission.zig").Admission;
pub const MessageEvent = @import("messages.zig").MessageEvent;
pub const MessageSink = @import("messages.zig").MessageSink;

const turn_mod = @import("turn.zig");
const Turn = turn_mod.Turn;
const Layout = @import("layout.zig").Layout;
pub const MemoryPlan = @import("layout.zig").Plan;

/// Live occupancy for bounded host supervision and deterministic test baselines. This scans fixed
/// startup capacities: peers, topics, validation entries and store entries.
pub const ResourceSnapshot = struct {
    receive_pages: usize = 0,
    receive_page_capacity: usize = 0,
    validation_capacity: usize = 0,
    attribution_capacity: usize = 0,
    resolved_attributions: usize = 0,
    delivery_descriptors_capacity: usize = 0,
    delivery_descriptors_available: usize = 0,
    admitted_peers: usize = 0,
    remote_subscriptions: usize = 0,
    mesh_members: usize = 0,
    queued_descriptors: usize = 0,
    queued_bytes: usize = 0,
    held_frames: usize = 0,
    store_entries: usize = 0,
    store_pages: usize = 0,
    pending_validations: usize = 0,
    promises: usize = 0,
};

const Gossipsub = @This();

pub const ConnectionAdmission = enum { admitted, duplicate, capacity, unauthenticated };
pub const Delivery = enum { unavailable, pending, available, send_timeout };
pub const peerConnected = session_io.peerConnected;
pub const transportEvents = session_io.transportEvents;
pub const retireConnection = session_io.retireConnection;
pub const negotiationResult = session_io.negotiationResult;
pub const streamReady = session_io.streamReady;

/// Brings the session's ready membership and deadline key in line with its state after a
/// change to its streams, queues or timers.
pub fn settle(self: *Gossipsub, index: u16) void {
    self.sessions.settle(index, &self.options);
}

pub fn deliveryChanged(self: *const Gossipsub) bool {
    return self.sessions.delivery_changed;
}

/// Call after evaluating peer policy against the current delivery state.
pub fn clearDeliveryChanged(self: *Gossipsub) void {
    self.sessions.delivery_changed = false;
}

pub fn localSubscriptions(self: *const Gossipsub, digest: [4]u8) topic_policy.Subnets {
    return self.overlay.subnetSubscriptions(null, digest);
}

pub fn graylistThreshold(self: *const Gossipsub) f64 {
    return self.options.score_params.graylist_threshold;
}

pub fn coverageSubscriptions(self: *Gossipsub, conn: Handle, digest: [4]u8, local: *const topic_policy.Subnets, now: Now) topic_policy.Subnets {
    const index = self.sessions.find(conn) orelse return .{};
    if (self.sessions.rows[index].outStream() == null) return .{};
    var result = self.overlay.subnetSubscriptions(index, digest);
    if (self.peers.rows[self.logical(index).index].direct) return result;
    const value = self.peerScore(index, now.millis());
    if (value < self.options.score_params.publish_threshold) return .{};
    if (value < 0) {
        result.attnets &= ~local.attnets;
        result.syncnets &= ~local.syncnets;
        result.columns = result.columns.differenceWith(local.columns);
    }
    return result;
}

pub const ReceiveDiscard = enum { capacity, timeout, unattributed_timeout };

/// Cumulative protocol events, independent of session lifetimes.
pub const Counters = struct {
    pump_budget_exhausted: [turn_mod.budget_count]u64 = @splat(0),
    receive_discards: [std.meta.fields(ReceiveDiscard).len]u64 = @splat(0),
    broken_promises: u64 = 0,
    ihave_budget_skipped: u64 = 0,
    local_pressure_resets: u64 = 0,
    malformed_rpcs: u64 = 0,
    negotiation_started: u64 = 0,
};

/// Borrowed until the next pump. Consume once after the protocol pass.
pub fn receiveTimeouts(self: *const Gossipsub) []const ReceiveTimeout {
    return self.receive_timeouts[0..self.receive_timeouts_len];
}

pub fn init(allocator: Allocator, options: Options) InitError!Gossipsub {
    try options.validate();
    const layout = Layout.init(&options);
    const memory = layout.plan();
    const sessions = try allocator.create(Sessions);
    errdefer allocator.destroy(sessions);
    sessions.* = try Sessions.init(allocator, &options, &layout);
    errdefer sessions.deinit(allocator);

    const overlay = try allocator.create(overlay_mod.Overlay);
    errdefer allocator.destroy(overlay);
    overlay.* = try overlay_mod.Overlay.init(allocator, options.random_seed.?, options.topic_policy);
    errdefer overlay.deinit(allocator);
    overlay.slot = options.initial_slot;

    var peers = try peers_mod.PeerBook.init(allocator, &options, layout.topics);
    errdefer peers.deinit(allocator);

    const topic_order = try allocator.alloc(u16, layout.topics);
    errdefer allocator.free(topic_order);

    var messages = try messages_mod.Messages.init(allocator, &options, &layout);
    errdefer messages.deinit(allocator, &peers);
    const msg_scratch = try allocator.alloc(u8, constants.GOSSIP_MAX_SIZE);
    errdefer allocator.free(msg_scratch);
    var recovery = try Recovery.init(allocator);
    errdefer recovery.deinit(allocator, &peers);
    recovery.seed = options.random_seed.? ^ 5;

    var result: Gossipsub = .{
        .allocator = allocator,
        .options = options,
        .memory = memory,
        .sessions = sessions,
        .peers = peers,
        .cycle = .{ .order = topic_order },
        .messages = messages,
        .msg_scratch = msg_scratch,
        .recovery = recovery,
        .overlay = overlay,
    };
    result.options.ip_allowlist = &.{};
    result.options.topic_policy = &.{};
    return result;
}

pub fn deinit(self: *Gossipsub) void {
    for (self.sessions.rows) |*peer| if (peer.active) self.connectionClosed(peer.conn);
    self.recovery.deinit(self.allocator, &self.peers);
    self.allocator.free(self.msg_scratch);
    self.messages.deinit(self.allocator, &self.peers);
    self.allocator.free(self.cycle.order);
    self.peers.deinit(self.allocator);
    self.overlay.deinit(self.allocator);
    self.allocator.destroy(self.overlay);
    self.sessions.deinit(self.allocator);
    self.allocator.destroy(self.sessions);
    self.* = undefined;
}

// Subscriptions ----------------------------------------------------------

pub fn prepareSubscriptions(self: *Gossipsub, subscriptions: []const local_intent.Boundary, workspace: *local_intent.Workspace, now: Now, slot: u64) local_intent.Error!bool {
    const context = self.overlayContext(self.last_now_ms);
    return self.overlay.prepareSubscriptions(&context, subscriptions, workspace, now.millis(), slot);
}

pub fn commitSubscriptions(self: *Gossipsub, workspace: *local_intent.Workspace) void {
    self.last_now_ms = workspace.now_ms;
    const context = self.overlayContext(self.last_now_ms);
    self.overlay.commitSubscriptions(&context, workspace);
}

// Peer lifecycle ---------------------------------------------------------

pub const PeerAdmission = union(enum) { admitted: sessions_mod.SessionRef, duplicate, capacity };

/// Metadata must come from an authenticated transport connection. Refusal leaves transport usable.
pub fn addPeer(self: *Gossipsub, conn: Handle, metadata: *const peers_mod.Metadata, now: Now) PeerAdmission {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    if (self.sessions.find(conn)) |index| return .{ .admitted = .{ .index = index, .generation = self.sessions.peerGeneration(index) } };
    if (self.peers.find(&metadata.identity)) |ref| {
        if (self.peers.rows[ref.index].connection != null) return .duplicate;
    }
    const handle = self.sessions.addPeer(conn) orelse return .capacity;
    const admission_result = self.peers.admit(conn, metadata, now.millis());
    if (admission_result != .admitted) {
        self.sessions.removePeer(handle.index);
        return if (admission_result == .duplicate) .duplicate else .capacity;
    }
    const ref = admission_result.admitted.peer;
    self.sessions.rows[handle.index].logical = ref;
    self.sessions.rows[handle.index].io.tx.data.trace_connection = if (self.trace_gossip) conn else null;
    return .{ .admitted = handle };
}

pub fn logical(self: *const Gossipsub, index: u16) peers_mod.Ref {
    assert(self.sessions.rows[index].active);
    return self.sessions.rows[index].logical;
}

pub fn connectionClosed(self: *Gossipsub, conn: Handle) void {
    const index = self.sessions.find(conn) orelse return;
    _ = self.sessions.resetRx(index);
    self.cancelWrites(self.sessions.ref(index));
    const ref = self.logical(index);
    self.peers.disconnect(ref, self.last_now_ms);
    const context = self.overlayContext(self.last_now_ms);
    self.overlay.peerDisconnected(&context, index);
    for (&self.retired_queue_drops, self.sessions.rows[index].io.tx.drops) |*total, value| total.* +|= value;
    self.sessions.rows[index].io.tx.drops = @splat(0);
    self.retired_rpc_sent.add(&self.sessions.rows[index].io.tx.rpc_sent);
    self.sessions.rows[index].io.tx.rpc_sent = .{};
    self.sessions.removePeer(index);
}

pub fn cancelWrites(self: *Gossipsub, session: sessions_mod.SessionRef) void {
    if (!self.sessions.matches(session)) return;
    const tx = &self.sessions.rows[session.index].io.tx;
    self.delivery_metrics.cancelled(&tx.data.origins);
    tx.cancelStream();
    _ = self.cancelPromises(session.index, false);
}

pub fn sendSubscriptions(self: *Gossipsub, index: u16) void {
    self.overlay.synchronize(&self.sessions.rows[index].io.tx, self.last_now_ms);
    self.settle(index);
}

pub const PublishOptions = struct { allow_zero_peers: bool = true, ignore_duplicate: bool = false, flood: bool = false };
pub const PublishError = error{ PayloadTooSmall, PayloadTooLarge, UnknownTopic, CompressFailed, ResourceExhausted, Duplicate, NoPeersSubscribedToTopic };
pub const PublishOutcome = struct { queued: u16 = 0, pressured: u16 = 0, selected: u16 = 0, unavailable: u16 = 0, duplicate: bool = false };

pub fn publish(self: *Gossipsub, topic_str: []const u8, ssz: []const u8, now: Now) PublishError!PublishOutcome {
    return self.publishWithOptions(topic_str, ssz, .{}, now);
}

/// Admits one shared history payload; queued counts live stream queue admissions.
pub fn publishWithOptions(self: *Gossipsub, topic_str: []const u8, ssz: []const u8, options: PublishOptions, now: Now) PublishError!PublishOutcome {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    const now_ms = self.last_now_ms;
    if (ssz.len > constants.MAX_PAYLOAD_SIZE) return error.PayloadTooLarge;
    const match = self.overlay.namespace.lookup(topic_str) orelse return error.UnknownTopic;
    if (ssz.len < match.rule.ssz_min) return error.PayloadTooSmall;
    if (ssz.len > match.rule.ssz_max) return error.PayloadTooLarge;
    const id = topic_mod.validMessageId(topic_str, ssz, self.options.message_id_policy);
    if (self.messages.known(id, now_ms)) {
        if (options.ignore_duplicate) return .{ .duplicate = true };
        return error.Duplicate;
    }
    const topic = match.ordinal;
    const context = self.overlayContext(now_ms);
    self.overlay.activateTopic(&context, topic);
    const recipients = self.overlay.publicationRecipients(&context, topic, options.flood);
    if (recipients.count() == 0 and !options.allow_zero_peers) return error.NoPeersSubscribedToTopic;
    const clen = snappy.raw.compress(ssz, self.msg_scratch) catch return error.CompressFailed;
    const h = self.messages.publish(id, topic, match.kind, topic_str, self.msg_scratch[0..clen], now_ms, self.cycle.epoch) orelse return error.ResourceExhausted;
    self.topic_metrics.get(topic_str).published +|= 1;
    _ = self.recovery.resolve(&self.peers, id);
    const result = self.deliver(&recipients, h, null, now_ms);
    self.topic_metrics.get(topic_str).published_bytes +|= @as(u64, result.queued) * @as(u64, clen);
    return result;
}

pub fn messageContext(self: *Gossipsub) messages_mod.Context {
    return .{ .overlay = self.overlay, .peers = &self.peers, .options = &self.options, .epoch = self.cycle.epoch, .topic_metrics = &self.topic_metrics, .validation_time = &self.validation_time };
}

pub fn report(self: *Gossipsub, handle: ValidationHandle, verdict: Verdict, now: Now) ReportOutcome {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    const now_ms = self.last_now_ms;
    const context = self.messageContext();
    const result = self.messages.report(&context, handle, verdict, now_ms);
    if (result == .applied) {
        const applied = &result.applied;
        if (self.trace_gossip) if (topic_mod.parseCanonical(applied.topicString())) |topic| {
            if (trace.selected(topic.name.kind, applied.id)) std.log.scoped(.network_gossip_trace).info("validation message_id={x} kind={s} verdict={s} admitted_ms={d}", .{ applied.id, @tagName(topic.name.kind), @tagName(applied.verdict), applied.admitted_ms });
        };
        if (applied.forward) |forward| {
            if (self.deliver(self.overlay.mesh(forward.topic), forward.message, forward.source, now_ms).queued > 0) self.topic_metrics.get(applied.topicString()).forwarded +|= 1;
        }
    }
    return result.outcome();
}

pub fn cancel(self: *Gossipsub, handle: ValidationHandle, now: Now) bool {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    return self.messages.cancel(&self.peers, handle, self.last_now_ms);
}

fn deliver(self: *Gossipsub, peers: *const sessions_mod.PeerSet, h: storage.Handle, source: ?validation_mod.PeerRef, now_ms: u64) PublishOutcome {
    const id = self.messages.store.get(h).?.id;
    const attribution = if (source != null) self.messages.validation.find(id, now_ms) else null;
    var result: PublishOutcome = .{};
    const origin: delivery.Origin = if (source == null) .publication else .forward;
    var recipients = peers.*;
    const topic = self.overlay.findTopic(self.messages.store.get(h).?.topicString()).?;
    if (source != null) for (self.sessions.rows, 0..) |*row, peer| {
        if (row.active and self.peers.rows[row.logical.index].direct and self.overlay.subscribers(topic).isSet(peer)) recipients.set(peer);
    };
    var it = recipients.iterator(.{});
    next_peer: while (it.next()) |peer| {
        const index: u16 = @intCast(peer);
        if (!self.sessions.rows[index].active or self.sessions.rows[index].outbound == .closing) continue;
        if (source) |p| {
            if (std.meta.eql(p, self.logical(index)) or self.sessions.suppresses(index, id, now_ms)) continue;
            if (attribution) |entry| for (entry.duplicates[0..entry.duplicate_len]) |duplicate| {
                if (std.meta.eql(duplicate.peer, self.logical(index))) continue :next_peer;
            };
        }
        result.selected += 1;
        if (self.sessions.rows[index].outStream() == null) {
            result.unavailable += 1;
            self.delivery_metrics.recipient(origin, .unavailable);
            continue;
        }
        if (self.sessions.rows[index].io.tx.queueData(&self.messages.store, h, origin, delivery_limits, now_ms) == .queued) {
            result.queued += 1;
            self.delivery_metrics.recipient(origin, .queued);
            self.settle(index);
        } else {
            result.pressured += 1;
            self.delivery_metrics.recipient(origin, .pressured);
        }
    }
    assert(result.selected == result.queued + result.pressured + result.unavailable);
    return result;
}

pub fn overlayContext(self: *Gossipsub, now_ms: u64) overlay_mod.Context {
    return .{ .sessions = self.sessions, .peers = &self.peers, .now = now_ms, .options = &self.options };
}

// Pump -------------------------------------------------------------------

/// Returns whether a heartbeat ran. Expire recovery after servicing that turn.
pub fn tick(self: *Gossipsub, now: Now) bool {
    if (self.heartbeat_at == 0) {
        self.heartbeat_at = now.millis() +| self.options.heartbeat_interval_ms;
    } else if (now.millis() >= self.heartbeat_at) {
        self.heartbeat(now);
        self.heartbeat_at = now.millis() +| self.options.heartbeat_interval_ms;
        return true;
    }
    return false;
}

pub const receiveItem = rpc_handler.receiveItem;

pub fn acceptsRpc(self: *Gossipsub, index: u16, now: Now) bool {
    return self.peers.rows[self.logical(index).index].direct or
        self.peerScore(index, now.millis()) >= self.options.score_params.graylist_threshold;
}

pub fn memoryPlan(self: *const Gossipsub) MemoryPlan {
    return self.memory;
}

pub fn resourceSnapshot(self: *const Gossipsub) ResourceSnapshot {
    var result: ResourceSnapshot = .{
        .receive_pages = self.sessions.receive_pool.next.len - self.sessions.receive_pool.free_pages,
        .receive_page_capacity = self.sessions.receive_pool.next.len,
        .validation_capacity = self.messages.validationCapacity(),
        .attribution_capacity = self.messages.validation.recent.len,
        .resolved_attributions = self.messages.validation.resolved_records.len,
        .delivery_descriptors_capacity = self.sessions.deliveries.slots.len,
        .delivery_descriptors_available = self.sessions.deliveries.available,
        .store_entries = self.messages.store.used_entries,
        .store_pages = self.messages.store.next.len - self.messages.store.free_pages,
        .pending_validations = self.messages.pendingValidations(),
        .promises = self.recovery.len,
    };
    for (self.sessions.rows) |*peer| {
        const io = &peer.io;
        if (peer.active) result.admitted_peers += 1;
        result.queued_descriptors += io.tx.data.count;
        result.queued_bytes += io.tx.data.bytes;
        if (io.reader.declaredLen() != null or io.rpc != null) result.held_frames += 1;
    }
    for (self.overlay.rows) |*topic| {
        result.remote_subscriptions += topic.subscribers.count();
        result.mesh_members += topic.mesh.count();
    }
    return result;
}

fn heartbeat(self: *Gossipsub, now: Now) void {
    for (self.sessions.rows) |*peer| {
        peer.io.resetHeartbeat();
        peer.expireSuppressions(now.millis());
    }
    self.peers.refresh(now.millis());
    // A frame held for a peer whose score fell below the graylist is released by its next
    // service, which resets the inbound stream.
    for (self.sessions.rows, 0..) |*peer, index| {
        if (!peer.active or peer.in_stream == null or peer.io.frame_since == null) continue;
        if (!self.acceptsRpc(@intCast(index), now)) self.sessions.markReady(@intCast(index));
    }
    if (self.cycle.isActive()) return;
    const opportunistic = self.opportunistic_at != 0 and now.millis() >= self.opportunistic_at;
    if (self.opportunistic_at == 0 or opportunistic) self.opportunistic_at = now.millis() +| self.options.opportunistic_graft_interval_ms;
    self.cycle.begin(self.sessions, &self.peers, now.millis(), opportunistic, self.overlay.rng.random());
}

pub fn maintainTopics(self: *Gossipsub, now: Now) void {
    if (!self.cycle.isActive()) return;
    const start = timing.now(self.clock);
    var serviced: usize = 0;
    for (0..self.overlay.rows.len) |_| {
        const index = self.cycle.next() orelse break;
        const topic = &self.overlay.rows[index];
        if (!topic.active) continue;
        var context = self.overlayContext(now.millis());
        context.snapshot = &self.cycle.scores;
        if (topic.fanout.count() > 0) _ = self.overlay.maintainFanout(&context, index, false);
        self.overlay.maintain(&context, index);
        if (self.cycle.opportunistic) self.overlay.opportunistic(&context, index);
        self.emitGossip(index, &context);
        self.overlay.expireTopic(&context, index, self.messages.validation.retainsTopic(index));
        serviced += 1;
        if (timing.now(self.clock) -| start >= constants.maintenance_slice_target_ns) break;
        if (serviced == self.options.topics_per_pump) break;
    }
    if (self.cycle.complete()) |epoch| {
        for (self.sessions.rows, 0..) |*session, index| {
            if (session.active and session.io.tx.finishGossip(now.millis())) self.settle(@intCast(index));
        }
        self.messages.history.age(&self.messages.store, epoch);
    }
}

fn emitGossip(self: *Gossipsub, topic: u16, context: *const overlay_mod.Context) void {
    const topic_str = self.overlay.topicString(topic);
    const ids = self.messages.gossipIds(topic, self.cycle.epoch);
    const count = ids.len;
    if (count == 0) return;
    const n = @min(count, constants.gossip_ids_max);
    const recipients = self.overlay.gossipRecipients(context, topic, self.options.gossip_factor);
    var it = recipients.iterator(.{});
    while (it.next()) |peer| {
        for (0..n) |i| {
            const j = self.overlay.rng.random().uintLessThan(usize, count - i) + i;
            std.mem.swap(MessageId, &ids[i], &ids[j]);
        }
        if (!self.sessions.rows[peer].io.tx.gossipTopic(topic_str, ids[0..n])) self.counters.ihave_budget_skipped +|= 1;
    }
}

pub fn cancelPromises(self: *Gossipsub, peer: u16, local_pressure: bool) usize {
    return self.recovery.cancel(&self.peers, self.sessions.rows[peer].conn, local_pressure).work;
}

/// Borrows a segment for one transport write. Complete or abandon the borrow before any
/// operation that can change message storage; advanceWrite must follow a successful write.
pub fn writeSegment(self: *Gossipsub, session: sessions_mod.SessionRef) []const u8 {
    assert(self.sessions.matches(session));
    const outbox = &self.sessions.rows[session.index].io.tx;
    self.overlay.flushSubscriptions(outbox, &self.sessions.control_scratch, self.last_now_ms);
    const before = outbox.data.origins;
    defer {
        var cancelled: [delivery.origin_count]usize = undefined;
        for (&cancelled, before, outbox.data.origins) |*count, previous, remaining| count.* = previous - remaining;
        self.delivery_metrics.cancelled(&cancelled);
    }
    return outbox.segment(&self.messages.store, self.last_now_ms);
}

pub fn advanceWrite(self: *Gossipsub, session: sessions_mod.SessionRef, written: usize, now_ms: u64) void {
    assert(self.sessions.matches(session));
    if (self.sessions.rows[session.index].io.tx.advance(written)) |completion| self.writeCompleted(session, completion, now_ms);
}

pub fn writeCompleted(self: *Gossipsub, session: sessions_mod.SessionRef, completion: outbox_mod.Completion, now_ms: u64) void {
    if (!self.sessions.matches(session)) return;
    const peer = session.index;
    switch (completion) {
        .control => |receipt| self.controlSent(peer, receipt.token, now_ms),
        .data => |receipt| self.delivery_metrics.completed(receipt, now_ms),
    }
}

pub const delivery_limits: delivery.Limits = .{ .bytes = constants.tx_peer_bytes, .local_bytes = constants.tx_local_bytes };

fn controlSent(self: *Gossipsub, peer: u16, token: u64, now_ms: u64) void {
    self.recovery.controlSent(self.sessions.rows[peer].conn, token, self.options.iwant_followup_ms, now_ms);
}

pub fn expirePromises(self: *Gossipsub, now_ms: u64) void {
    self.counters.broken_promises += self.recovery.expire(&self.peers, now_ms);
}

fn peerScore(self: *Gossipsub, index: u16, now_ms: u64) f64 {
    const ref = self.logical(index);
    return self.peers.score(ref, now_ms);
}

pub fn scoreSnapshot(self: *Gossipsub, conn: Handle, now: Now) ?f64 {
    const index = self.sessions.find(conn) orelse return null;
    return self.peerScore(index, now.millis());
}

pub fn unmarkDirect(self: *Gossipsub, identity: *const PeerId) void {
    const peer = self.peers.find(identity) orelse return;
    self.peers.rows[peer.index].direct = false;
}

/// Direct peers receive subscribed publications outside mesh and fanout score gates.
pub fn markDirect(self: *Gossipsub, conn: Handle) void {
    const index = self.sessions.find(conn) orelse return;
    self.peers.rows[self.logical(index).index].direct = true;
    const context = self.overlayContext(self.last_now_ms);
    for (self.overlay.rows, 0..) |*topic, t| {
        if (topic.mesh.isSet(index)) self.overlay.prune(&context, @intCast(t), index, constants.prune_backoff_ms, .direct_peer);
        topic.fanout.unset(index);
    }
}

/// Closes current sessions. Configuration, message state and future admission remain owned here.
pub fn closeSessions(self: *Gossipsub, router: *Router, engine: *Engine) void {
    for (self.sessions.rows, 0..) |*peer, index| {
        if (peer.active) session_io.retirePeer(self, router, engine, @intCast(index));
    }
}

pub fn admitted(self: *Gossipsub, conn: Handle) bool {
    return self.sessions.find(conn) != null;
}

pub fn deliveryStatus(self: *Gossipsub, conn: Handle) Delivery {
    const index = self.sessions.find(conn) orelse return .unavailable;
    return switch (self.sessions.rows[index].outbound) {
        .none, .closing => .unavailable,
        .send_timeout => .send_timeout,
        .pending, .retry_at, .negotiating => .pending,
        .live => .available,
    };
}

pub fn deliveryAvailable(self: *Gossipsub, conn: Handle) bool {
    return self.deliveryStatus(conn) == .available;
}

/// Session work, an unfinished maintenance pass, and the next protocol timer.
pub fn schedule(self: *const Gossipsub) types.Schedule {
    var result: types.Schedule = .{
        .runnable = self.sessions.ready.len > 0 or self.cycle.isActive() or self.heartbeat_at == 0,
        .deadline = time.optionalMilliseconds(self.heartbeat_at),
    };
    if (self.sessions.deadlines.peek()) |top| result = result.merge(.{ .deadline = time.optionalMilliseconds(top.deadline) });
    return result.merge(.{ .deadline = time.optionalMilliseconds(self.messages.nextDeadline()) });
}

pub fn pump(
    self: *Gossipsub,
    router: *Router,
    engine: *Engine,
    now: Now,
) void {
    var turn = self.beginPump(now);
    self.runTurn(router, engine, &turn);
    if (@import("builtin").is_test or @import("builtin").fuzz) checkRoutes(self.sessions, engine);
}

/// Expires the due session deadlines, runs the heartbeat, then services up to `peers_per_pump`
/// of the sessions that were ready when the turn began, in the order they became ready. A
/// session that still wants service after its turn goes back to the tail; sessions marked
/// during the turn wait for the next one.
pub fn runTurn(self: *Gossipsub, router: *Router, engine: *Engine, turn: *Turn) void {
    const now = turn.now;
    self.expireSessions(router, engine, turn);
    const heartbeat_due = self.tick(now);
    const marked = @min(self.sessions.ready.len, self.options.peers_per_pump);
    var openings: usize = 0;
    for (0..marked) |_| {
        const index: u16 = @intCast(self.sessions.ready.pop(self.sessions.rows, "ready_link") orelse break);
        self.sessions.visits +|= 1;
        session_io.serviceSession(self, router, engine, index, turn, &openings);
        self.sessions.serviced(index, &self.options);
        if (turn.exhausted().count() > 0) break;
    }
    // Writers a spent call or output budget left waiting, for the send-pressure log.
    const exhausted = turn.exhausted();
    inline for (std.meta.fields(turn_mod.Budget)) |budget| {
        if (exhausted.contains(@enumFromInt(budget.value))) self.counters.pump_budget_exhausted[budget.value] +|= 1;
    }
    if (exhausted.contains(.calls) or exhausted.contains(.output)) {
        var next = self.sessions.ready.head;
        for (0..self.sessions.ready.len) |_| {
            if (next == index_list.none) break;
            const row = &self.sessions.rows[next];
            next = row.ready_link.next;
            if (row.outStream() != null and row.io.tx.ready and row.io.tx.pending()) row.io.write_budget_deferred +|= 1;
        }
    }
    self.finishPump(now);
    // Received messages and local refusals can forgive promises before this heartbeat's sweep.
    if (heartbeat_due) self.expirePromises(now.millis());
    if (@import("builtin").is_test or @import("builtin").fuzz) self.checkScheduling();
}

/// Pops the sessions whose earliest deadline passed. Handling an expiry clears it or retires the
/// session, so a key set here lies in the future and each session is popped at most once.
fn expireSessions(self: *Gossipsub, router: *Router, engine: *Engine, turn: *Turn) void {
    const now_ms = turn.now.millis();
    for (0..self.sessions.deadlines.len) |_| {
        const index: u16 = @intCast(self.sessions.deadlines.popDue(now_ms) orelse break);
        self.sessions.visits +|= 1;
        session_io.expireSession(self, router, engine, index, turn);
        self.settle(index);
    }
}

pub fn beginPump(self: *Gossipsub, now: Now) Turn {
    self.receive_timeouts_len = 0;
    self.last_now_ms = now.millis();
    self.messages.expire(&self.peers, now.millis());
    var turn = Turn.init(&self.options, now, self.msg_scratch);
    turn.sink = self.message_sink;
    return turn;
}

pub fn finishPump(self: *Gossipsub, now: Now) void {
    self.maintainTopics(now);
}

/// Test builds check after every turn that the ready list holds every session that wants
/// service, that each session off the list is keyed on its recomputed deadline, and that the
/// connection index finds each active session.
pub fn checkScheduling(self: *const Gossipsub) void {
    const sessions = self.sessions;
    var linked: usize = 0;
    for (sessions.rows, 0..) |*row, position| {
        const index: u16 = @intCast(position);
        linked += @intFromBool(row.ready_link.linked);
        if (!row.active) {
            assert(!row.ready_link.linked and sessions.deadlines.get(index) == null);
            continue;
        }
        assert(sessions.find(row.conn).? == index);
        if (row.wants()) assert(row.ready_link.linked);
        if (!row.ready_link.linked) assert(sessions.deadlines.get(index) == row.deadline(&self.options));
    }
    assert(linked == sessions.ready.len);
}

/// Test builds check after every pump that each stream a session holds routes to it, that a
/// session off the ready list holds no inbound stream with an unread readable edge, and that a
/// blocked out stream with queued output waits on armed write interest.
pub fn checkRoutes(sessions: *const sessions_mod.Sessions, engine: *const Engine) void {
    for (sessions.rows, 0..) |*row, position| {
        if (!row.active) continue;
        const index: u24 = @intCast(position);
        if (row.in_stream) |stream| if (engine.route(stream)) |bound| {
            assert(bound.owner == .gossip_inbound and bound.row == index);
            if (!row.ready_link.linked) if (engine.streamWaits(stream)) |waits| assert(!waits.read_open);
        };
        if (row.outStream()) |stream| if (engine.route(stream)) |bound| {
            assert(bound.owner == .gossip_outbound and bound.row == index);
            const tx = &row.io.tx;
            if (!tx.ready and (tx.pending() or tx.subscription_dirty.count() > 0)) if (engine.streamWaits(stream)) |waits| assert(waits.write_waiting);
        };
    }
}

test {
    _ = @import("gossipsub_accounting_test.zig");
    _ = @import("gossipsub_deadlines_test.zig");
    _ = @import("gossipsub_flow_control_test.zig");
    _ = @import("gossipsub_forwarding_test.zig");
    _ = @import("gossipsub_framing_test.zig");
    _ = @import("gossipsub_history_test.zig");
    _ = @import("gossipsub_policy_test.zig");
    _ = @import("gossipsub_publication_test.zig");
    _ = @import("gossipsub_readiness_test.zig");
    _ = @import("gossipsub_recovery_test.zig");
    _ = @import("gossipsub_resources_test.zig");
    _ = @import("gossipsub_scheduler_test.zig");
    _ = @import("gossipsub_simulation_test.zig");
    _ = @import("gossipsub_test.zig");
    _ = @import("gossipsub_validation_test.zig");
    _ = @import("gossipsub_work_budget_test.zig");
}
