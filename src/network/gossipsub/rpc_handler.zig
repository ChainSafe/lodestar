const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");
const messages_mod = @import("messages.zig");
const sessions_mod = @import("sessions.zig");
const peers_mod = @import("peer_book.zig");
const topic_mod = @import("topic.zig");
const topic_policy = @import("topic_policy.zig");
const score_mod = @import("score.zig");
const Recovery = @import("recovery.zig").Recovery;
const IwantOutcome = @import("metrics.zig").IwantOutcome;
const Turn = @import("turn.zig").Turn;
const Credits = @import("turn.zig").Credits;
const Progress = @import("turn.zig").Progress;
const Now = @import("../types.zig").Now;
const MessageId = topic_mod.MessageId;
const trace = @import("trace.zig");
const assert = std.debug.assert;

pub fn receiveItem(self: *Gossipsub, session: sessions_mod.SessionRef, item: protobuf.Item, turn: *Turn, peer: *Credits) Progress {
    if (!self.sessions.matches(session)) return .done;
    const now = turn.now;
    const index = session.index;
    if (self.sessions.rows[index].outbound == .closing) return .done;
    switch (item) {
        .subscription => |sub| onSubscription(self, index, sub, now),
        .message => |msg| {
            const result = onMessage(self, index, msg, turn, peer);
            if (result != .done) return result;
        },
        else => {
            if (self.sessions.rows[index].outStream() != null) {
                switch (item) {
                    .ihave => |ihave| {
                        const workspace = turn.workspace(peer);
                        if (!workspace.chargeWork(&self.options, ihaveWork(self, ihave.body.len))) return .credits;
                        onIhave(self, index, ihave, now);
                    },
                    .iwant => |iwant| {
                        const workspace = turn.workspace(peer);
                        if (!workspace.chargeWork(&self.options, iwantWork(self, iwant.body.len))) return .credits;
                        onIwant(self, index, iwant, now);
                    },
                    .graft => |name| onGraft(self, index, name, now),
                    .prune => |prune| onPrune(self, index, prune, now),
                    .idontwant => |ids| onIdontwant(self, index, ids, now),
                    else => unreachable,
                }
            }
        },
    }
    return .done;
}

fn onMessage(self: *Gossipsub, index: u16, msg: protobuf.Message, turn: *Turn, peer: *Credits) Progress {
    const now = turn.now;
    const context = self.messageContext();
    const workspace = turn.workspace(peer);
    const source: messages_mod.Source = .{ .peer = self.logical(index), .session = self.sessions.ref(index), .connection = self.sessions.rows[index].conn, .endpoint = self.sessions.rows[index].receive_endpoint };
    const result = self.messages.receive(&context, &workspace, &source, msg, now.millis());
    // The turn offers a message refused for work again, so only its final outcome counts.
    if (result == .deferred) return .credits;
    if (self.trace_gossip) if (topic_mod.parseCanonical(msg.topic)) |topic| {
        const id: ?MessageId = switch (result) {
            .admitted => |value| value.id,
            .duplicate => |value| value,
            .refused => |value| if (value == .identified) value.identified else null,
            else => null,
        };
        if (id) |value| if (trace.selected(topic.name.kind, value)) {
            const io = &self.sessions.rows[index].io;
            const conn = source.connection;
            std.log.scoped(.network_gossip_trace).info("receive message_id={x} kind={s} connection={d}:{d} outcome={s} bytes={d} frame_started_ms={?d} frame_complete_ms={?d}", .{ value, @tagName(topic.name.kind), conn.index, conn.generation, @tagName(result), msg.data.len, io.frame_since, if (io.rpc) |rpc| rpc.completed_ms else null });
        };
    };
    const counts = self.topic_metrics.get(msg.topic);
    counts.received +|= 1;
    switch (result) {
        .ignored => return .done,
        .invalid => |reason| {
            const conn = self.sessions.rows[index].conn;
            std.log.scoped(.network_gossip).debug("invalid_message connection={d}:{d} endpoint={any} topic={s} reason={s} compressed_bytes={d}", .{ conn.index, conn.generation, source.endpoint, msg.topic, @tagName(reason), msg.data.len });
            return .done;
        },
        .duplicate => |id| {
            counts.duplicate +|= 1;
            resolvePromises(self, turn, peer, id);
            return .done;
        },
        .deferred => unreachable,
        .refused => |refusal| {
            switch (refusal) {
                .identified => |id| resolvePromises(self, turn, peer, id),
                .unidentified => {
                    const work = self.cancelPromises(index, true);
                    turn.budget.work -|= work;
                    peer.work -|= work;
                },
            }
            return .done;
        },
        .admitted => |admitted_message| {
            resolvePromises(self, turn, peer, admitted_message.id);
            if (msg.data.len >= self.options.idontwant_min_data_size) broadcastIdontwant(self, admitted_message.topic_index, admitted_message.id, index, now);
            return .done;
        },
    }
}

fn resolvePromises(self: *Gossipsub, turn: *Turn, peer: *Credits, id: MessageId) void {
    const work = self.recovery.resolve(&self.peers, id);
    turn.budget.work -|= work;
    peer.work -|= work;
}

pub fn ihaveWork(self: *const Gossipsub, body_len: usize) usize {
    return ihaveWorkBound(body_len, self.overlay.rows.len, self.messages.seen.index.probe_limit + self.messages.validation.index.probe_limit, self.recovery.batch_len, self.recovery.len);
}

fn ihaveWorkBound(body_len: usize, topics: usize, probes: usize, batches: usize, requests: usize) usize {
    const ids: usize = @min(constants.max_ihave_ids_per_heartbeat, body_len / (constants.message_id_length + 2));
    const selected: usize = @min(ids, constants.gossip_ids_max);
    const fields: usize = @min(body_len / 2 + 1, 8193);
    const header_work = topic_mod.topic_max_len * topic_policy.kind_count + topic_policy.boundary_max * @sizeOf(topic_mod.ForkDigest) + scoreWork(topics);
    // Each protobuf field consumes at least two bytes and at most two
    // ten-byte varints. Include a score refresh, IP population and topic
    // lookup; ID lookups include a slot read and key comparison. Selected
    // IDs include one bounded sampling swap, promise admission and encoding.
    return header_work + 20 * fields +
        Recovery.selectionWork(ids, batches, requests) + ids * probes * (@sizeOf(MessageId) + @sizeOf(u32)) +
        selected * 384;
}

fn scoreWork(topics: usize) usize {
    return topics * (@sizeOf(score_mod.TopicParams) + @sizeOf(score_mod.TopicCounters) + @sizeOf(score_mod.TopicWeights)) +
        @as(usize, peers_mod.capacity) * @sizeOf(peers_mod.Row) + @sizeOf(peers_mod.PeerBook);
}

fn iwantWork(self: *const Gossipsub, body_len: usize) usize {
    const ids: usize = @min(constants.max_iwant_ids_per_rpc, body_len / (constants.message_id_length + 2));
    const fields: usize = @min(body_len / 2 + 1, protobuf.Reader.field_limit + 1);
    const history = &self.messages.history;
    // Include a score refresh, one peer-column reset, and history lookup and queue metadata per ID.
    return scoreWork(self.overlay.rows.len) + 20 * fields + history.entries.len +
        ids * (history.index.probe_limit * (@sizeOf(MessageId) + @sizeOf(u32)) + 384);
}

fn onIhave(self: *Gossipsub, index: u16, ihave: protobuf.IHave, now: Now) void {
    if (belowGossip(self, index, now.millis())) return;
    const io = &self.sessions.rows[index].io;
    const rpc = &io.rpc.?;
    if (rpc.ihave_allowed == null) {
        rpc.ihave_allowed = io.ihave_recv < constants.max_ihave_per_heartbeat;
        if (rpc.ihave_allowed.?) io.ihave_recv += 1;
    }
    if (!rpc.ihave_allowed.?) return;
    const topic = self.overlay.findTopic(ihave.topic);
    if (topic == null or !self.overlay.subscribed(topic.?)) return;
    const id_budget = constants.max_ihave_ids_per_heartbeat -| @as(usize, io.iwant_ids_sent);
    if (id_budget == 0 or self.recovery.available() == 0) return;
    comptime assert(constants.max_ihave_ids_per_heartbeat * @sizeOf(MessageId) <= constants.GOSSIP_MAX_SIZE);
    const candidates = std.mem.bytesAsSlice(MessageId, self.msg_scratch[0 .. constants.max_ihave_ids_per_heartbeat * @sizeOf(MessageId)]);
    var count: usize = 0;
    var it = ihave.ids();
    for (0..constants.max_ihave_ids_per_heartbeat) |_| {
        const id_bytes = (it.next() catch return) orelse break;
        if (id_bytes.len != constants.message_id_length) continue;
        candidates[count] = id_bytes[0..constants.message_id_length].*;
        count += 1;
    }
    const selected = self.recovery.filterPending(&self.peers, self.logical(index), candidates[0..count]) catch return;
    const limit = @min(constants.gossip_ids_max, id_budget, selected.capacity);
    count = 0;
    for (candidates[0..selected.count]) |id| {
        if (self.messages.known(id, now.millis())) continue;
        candidates[count] = id;
        count += 1;
    }
    if (count == 0) return;
    const requested = @min(count, limit);
    for (0..requested) |i| {
        const chosen = i + @as(usize, @intCast(self.overlay.rng.random().uintLessThanBiased(u64, @intCast(count - i))));
        std.mem.swap(MessageId, &candidates[i], &candidates[chosen]);
    }
    self.recovery.requestBatch(&self.peers, &io.tx, &self.sessions.control_scratch, candidates[0..requested], self.logical(index), self.sessions.rows[index].conn, self.overlay.rng.random(), self.options.iwant_followup_ms, now.millis()) catch return;
    io.iwant_ids_sent += @intCast(requested);
    self.settle(index);
}

/// Explicit requests bypass the IDONTWANT hints used for unsolicited forwarding.
fn onIwant(self: *Gossipsub, index: u16, iwant: protobuf.IdList, now: Now) void {
    if (belowGossip(self, index, now.millis())) return;
    defer self.settle(index);
    var examined: usize = 0;
    var it = iwant.ids();
    while (it.next() catch return) |id_bytes| {
        if (examined >= constants.max_iwant_ids_per_rpc) break;
        examined += 1;
        if (id_bytes.len != constants.message_id_length) continue;
        const id: MessageId = id_bytes[0..constants.message_id_length].*;
        const outcome: IwantOutcome = switch (self.messages.serve(&self.sessions.rows[index].io.tx, self.logical(index), id, Gossipsub.delivery_limits, now.millis())) {
            .unknown => .miss,
            .known => |known| blk: {
                switch (known) {
                    .queued => self.delivery_metrics.recipient(.iwant, .queued),
                    .pressured => self.delivery_metrics.recipient(.iwant, .pressured),
                    .limited => {},
                }
                break :blk switch (known) {
                    .queued => .queued,
                    .pressured => .refused,
                    .limited => .limited,
                };
            },
        };
        self.iwant_outcomes[@intFromEnum(outcome)] +|= 1;
    }
}

/// v1.2: on the first copy of a large message, tell mesh peers not to send
/// their duplicate. Sent before validation, only to peers on 1.2.0.
fn broadcastIdontwant(self: *Gossipsub, topic: u16, id: MessageId, source: u16, now: Now) void {
    var it = self.overlay.mesh(topic).iterator(.{});
    while (it.next()) |peer| {
        const peer_index: u16 = @intCast(peer);
        if (peer_index == source) continue;
        const outbound = self.sessions.rows[peer_index].outbound;
        if (outbound != .live or outbound.live.version != .v1_2) continue;
        if (self.sessions.rows[peer_index].io.tx.submit(&.{ .idontwant = &.{id} }, &self.sessions.control_scratch, now.millis()) != null) self.settle(peer_index);
    }
}

fn onIdontwant(self: *Gossipsub, index: u16, idontwant: protobuf.IdList, now: Now) void {
    const io = &self.sessions.rows[index].io;
    if (io.idontwant_recv >= constants.max_idontwant_per_heartbeat) return;

    var it = idontwant.ids();
    while (it.next() catch return) |id_bytes| {
        if (io.idontwant_recv >= constants.max_idontwant_per_heartbeat) break;
        io.idontwant_recv += 1;
        if (id_bytes.len != constants.message_id_length) continue;
        self.sessions.suppress(index, id_bytes[0..constants.message_id_length].*, now.millis(), constants.mcache_len * self.options.heartbeat_interval_ms);
    }
}

fn onGraft(self: *Gossipsub, index: u16, topic_str: []const u8, now: Now) void {
    const topic = self.overlay.findTopic(topic_str) orelse return;
    const context = self.overlayContext(now.millis());
    self.overlay.onGraft(&context, topic, index);
}

fn onPrune(self: *Gossipsub, index: u16, prune: protobuf.Prune, now: Now) void {
    const topic = self.overlay.findTopic(prune.topic) orelse return;
    const context = self.overlayContext(now.millis());
    self.overlay.onPrune(&context, topic, index, if (prune.backoff == 0) constants.prune_backoff_ms else prune.backoff *| 1000);
}

fn onSubscription(
    self: *Gossipsub,
    index: u16,
    sub: protobuf.SubOpts,
    now: Now,
) void {
    const context = self.overlayContext(now.millis());
    _ = self.overlay.peerSubscription(&context, index, sub.topic, sub.subscribe) orelse return;
}

fn belowGossip(self: *Gossipsub, index: u16, now_ms: u64) bool {
    return self.peers.score(self.logical(index), now_ms) < self.options.score_params.gossip_threshold;
}

test "resident namespace lookup and score scans are included in IHAVE work estimates" {
    const low = ihaveWorkBound(128, 512, 4, 1, 1);
    const high = ihaveWorkBound(128, 615, 4, 1, 1);
    try std.testing.expectEqual(@as(usize, 103) * (@sizeOf(score_mod.TopicParams) + @sizeOf(score_mod.TopicCounters) + @sizeOf(score_mod.TopicWeights)), high - low);
}
