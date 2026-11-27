const std = @import("std");
const constants = @import("constants.zig");
const topic_mod = @import("topic.zig");
const topic_policy = @import("topic_policy.zig");
const score_mod = @import("score.zig");
const local_intent = @import("local_intent.zig");
const prom = @import("../metrics/registry.zig");
const Sessions = @import("sessions.zig").Sessions;
const PeerSet = @import("sessions.zig").PeerSet;
const assert = std.debug.assert;
const PeerBook = @import("peer_book.zig").PeerBook;
const options_mod = @import("options.zig");
const heartbeat_cycle = @import("heartbeat_cycle.zig");
const outbox_mod = @import("outbox.zig");

const c = constants;
const Set = PeerSet;

pub const Context = struct {
    sessions: *Sessions,
    peers: *PeerBook,
    options: *const options_mod.Options,
    now: u64,
    snapshot: ?*const heartbeat_cycle.Scores = null,
};

pub const Row = struct {
    retire_after_ms: ?u64 = null,
    active: bool = false,
    subscribed: bool = false,
    kind: topic_mod.Kind,
    string: [topic_mod.topic_max_len]u8 = undefined,
    string_len: u8 = 0,
    /// Remote declarations survive local topic inactivity.
    subscribers: PeerSet = PeerSet.empty,
    mesh: PeerSet = PeerSet.empty,
    fanout: PeerSet = PeerSet.empty,
    fanout_last_ms: u64 = 0,

    fn topicString(self: *const Row) []const u8 {
        return self.string[0..self.string_len];
    }
};

/// Why a peer joined or left a topic mesh. Each reason implies its event.
const MeshReason = enum {
    fill_mesh,
    fill_outbound,
    opportunistic,
    remote_graft,
    ineligible,
    excess,
    remote_prune,
    local_unsubscribe,
    remote_unsubscribe,
    session_end,
    direct_peer,
    refused_graft,

    fn event(self: MeshReason) enum { join, leave } {
        return switch (self) {
            .fill_mesh, .fill_outbound, .opportunistic, .remote_graft => .join,
            .ineligible, .excess, .remote_prune, .local_unsubscribe, .remote_unsubscribe, .session_end, .direct_peer, .refused_graft => .leave,
        };
    }
};

/// Committed mesh membership changes by topic kind and reason. GRAFT and PRUNE controls that
/// change no membership do not count.
pub const MeshChanges = struct {
    counts: [topic_policy.kind_count + 1][std.meta.fields(MeshReason).len]u64 = @splat(@splat(0)),

    fn record(self: *MeshChanges, kind: ?topic_mod.Kind, reason: MeshReason) void {
        const index = if (kind) |known| @intFromEnum(known) else topic_policy.kind_count;
        self.counts[index][@intFromEnum(reason)] +|= 1;
    }

    pub fn write(self: *const MeshChanges, w: *prom.Encoder) prom.Error!void {
        const changes = try w.family(.{
            .name = "gossipsub_mesh_changes_total",
            .kind = .counter,
            .help = "Committed mesh joins and leaves by topic kind and reason, not GRAFT or PRUNE controls",
            .labels = &.{ "topic", "event", "reason" },
        });
        inline for (0..topic_policy.kind_count + 1) |kind| {
            const topic = if (kind < topic_policy.kind_count) @tagName(@as(topic_policy.Kind, @enumFromInt(kind))) else "unknown";
            inline for (std.meta.fields(MeshReason)) |reason| {
                const event = comptime @tagName(@as(MeshReason, @enumFromInt(reason.value)).event());
                try changes.sample(.{ topic, event, reason.name }, self.counts[kind][reason.value]);
            }
        }
    }
};

pub const Overlay = struct {
    rng: std.Random.DefaultPrng,

    /// Indices are immutable namespace ordinals, including while a topic is inactive.
    rows: []Row,
    namespace: topic_policy.Namespace,
    slot: u64 = 0,
    mesh_changes: MeshChanges = .{},

    pub fn deinit(self: *Overlay, a: std.mem.Allocator) void {
        self.namespace.deinit(a);
        a.free(self.rows);
    }

    pub fn setLocal(self: *Overlay, context: *const Context, index: u16, on: bool) void {
        const row = &self.rows[index];
        assert(row.active);
        if (row.subscribed == on) return;
        if (on) {
            row.fanout = .empty;
            row.retire_after_ms = null;
        } else {
            var it = row.mesh.iterator(.{});
            while (it.next()) |peer| self.prune(context, index, @intCast(peer), constants.unsubscribe_backoff_ms, .local_unsubscribe);
            row.retire_after_ms = context.now +| context.options.retained_score_ms;
        }
        row.subscribed = on;
        for (context.sessions.rows, 0..) |*peer, position| {
            const io = &peer.io;
            if (!peer.active or peer.outStream() == null) continue;
            io.tx.subscriptionChanged(index, context.now);
            context.sessions.settle(@intCast(position), context.options);
        }
    }

    pub fn synchronize(self: *const Overlay, outbox: *outbox_mod.Outbox, now: u64) void {
        const announcements = &outbox.subscription_dirty;
        assert(announcements.bit_length == self.rows.len);
        announcements.setRangeValue(.{ .start = 0, .end = announcements.bit_length }, false);
        for (self.rows, 0..) |row, index| if (row.active and row.subscribed) {
            announcements.set(index);
        };
        outbox.synchronize(now);
    }

    pub fn flushSubscriptions(self: *const Overlay, outbox: *outbox_mod.Outbox, scratch: *outbox_mod.ControlScratch, now: u64) void {
        for (0..self.rows.len) |_| {
            const index = outbox.nextSubscription() orelse return;
            const row = &self.rows[index];
            assert(row.active);
            if (!outbox.announce(index, row.string[0..row.string_len], row.subscribed, scratch, now)) return;
        }
    }

    pub fn activateTopic(self: *Overlay, context: *const Context, topic: u16) void {
        const row = &self.rows[topic];
        if (row.active) return;
        assert(!row.subscribed and row.mesh.count() == 0 and row.fanout.count() == 0);
        assert(!context.peers.scores.retainsTopic(topic));
        row.active = true;
        row.retire_after_ms = null;
        context.peers.scores.applyValidatedTopic(topic, self.topicParams(context, row.kind, self.slot));
    }

    pub fn expireTopic(self: *Overlay, context: *const Context, topic: u16, has_attribution: bool) void {
        const row = &self.rows[topic];
        if (!row.active or row.subscribed or row.mesh.count() > 0 or row.fanout.count() > 0 or has_attribution) return;
        for (context.sessions.rows) |*peer| {
            if (peer.active and peer.io.tx.subscription_dirty.isSet(topic)) return;
        }
        if (row.retire_after_ms) |deadline| {
            if (context.now >= deadline) context.peers.scores.resetTopic(topic);
        }
        if (context.peers.scores.retainsTopic(topic)) return;
        for (0..context.peers.rows.len) |peer| {
            if (context.now < context.peers.backoffs[peer * self.rows.len + topic].until) return;
        }
        row.active = false;
        context.peers.scores.applyValidatedTopic(topic, context.options.score_params.topic);
    }

    fn topicParams(_: *const Overlay, context: *const Context, kind: topic_mod.Kind, slot: u64) score_mod.TopicParams {
        if (context.options.topic_params) |*policies| return policies[@intFromEnum(kind)].atSlot(slot);
        return context.options.score_params.topic;
    }

    /// Does not mutate protocol state or end event borrows. Commit must immediately follow acceptance.
    pub fn prepareSubscriptions(self: *const Overlay, context: *const Context, subscriptions: []const local_intent.Boundary, workspace: *local_intent.Workspace, now_ms: u64, slot: u64) local_intent.Error!bool {
        workspace.prepared = false;
        if (subscriptions.len > topic_policy.boundary_max) return error.TopicCapacity;
        workspace.desired = .empty;
        workspace.now_ms = @max(context.now, now_ms);
        workspace.slot = slot;
        var boundaries = std.StaticBitSet(topic_policy.boundary_max).empty;
        var count: usize = 0;
        for (subscriptions) |*subscription| {
            const ns = &self.namespace;
            const boundary_index = for (ns.boundaries, 0..) |*boundary, i| {
                if (std.mem.eql(u8, &boundary.digest, &subscription.digest)) break i;
            } else return error.InvalidTopic;
            if (boundaries.isSet(boundary_index)) return error.DuplicateBoundary;
            boundaries.set(boundary_index);
            for (ns.boundaries[boundary_index].rules, ns.offsets[boundary_index], 0..) |rule, start, k| {
                const mask = subscription.maskConst(@enumFromInt(k));
                if (subscription.lengths[k] > (rule.count + 7) / 8) return error.InvalidTopic;
                for (mask, 0..) |bits, byte| {
                    var remaining = bits;
                    for (0..8) |_| {
                        if (remaining == 0) break;
                        const subnet = byte * 8 + @as(usize, @ctz(remaining));
                        if (byte >= subscription.lengths[k] or subnet >= rule.count) return error.InvalidTopic;
                        count += 1;
                        if (count > constants.topics_cap) return error.TopicCapacity;
                        workspace.desired.set(start + subnet);
                        remaining &= remaining - 1;
                    }
                }
            }
        }
        var changed = false;
        for (self.rows, 0..) |*row, index| {
            const desired = workspace.desired.isSet(index);
            if (row.subscribed != desired) changed = true;
            if (desired and !std.meta.eql(context.peers.scores.topic_params[index], self.topicParams(context, row.kind, slot))) changed = true;
        }
        workspace.prepared = true;
        return changed;
    }

    pub fn commitSubscriptions(self: *Overlay, context: *const Context, workspace: *local_intent.Workspace) void {
        assert(workspace.prepared and context.now == workspace.now_ms);
        workspace.prepared = false;
        self.slot = workspace.slot;
        for (self.rows, 0..) |*row, index| {
            const desired = workspace.desired.isSet(index);
            if (desired) {
                self.activateTopic(context, @intCast(index));
                context.peers.scores.applyValidatedTopic(@intCast(index), self.topicParams(context, row.kind, self.slot));
            }
            if (row.active) self.setLocal(context, @intCast(index), desired);
        }
    }

    pub fn findTopic(self: *const Overlay, name: []const u8) ?u16 {
        const topic = (self.namespace.lookup(name) orelse return null).ordinal;
        return if (self.rows[topic].active) topic else null;
    }

    pub fn inMesh(self: *const Overlay, topic: u16, session: u16) bool {
        return self.rows[topic].mesh.isSet(session);
    }

    pub fn topicString(self: *const Overlay, index: u16) []const u8 {
        return self.rows[index].topicString();
    }

    pub fn subscribed(self: *const Overlay, index: u16) bool {
        return self.rows[index].active and self.rows[index].subscribed;
    }

    fn applySubscription(self: *Overlay, context: *const Context, topic: u16, peer: u16, on: bool, leave: MeshReason) void {
        if (on) self.rows[topic].subscribers.set(peer) else {
            self.rows[topic].subscribers.unset(peer);
            self.leaveMesh(context, topic, peer, leave);
            self.rows[topic].fanout.unset(peer);
        }
    }

    pub fn subscribers(self: *const Overlay, topic: u16) *const PeerSet {
        return &self.rows[topic].subscribers;
    }

    pub fn subnetSubscriptions(self: *const Overlay, peer: ?u16, digest: [4]u8) topic_policy.Subnets {
        var result: topic_policy.Subnets = .{};
        for (self.namespace.boundaries, self.namespace.offsets) |*boundary, *starts| {
            if (!std.mem.eql(u8, &boundary.digest, &digest)) continue;
            result.column_subnet_count = boundary.rules[@intFromEnum(topic_mod.Kind.data_column_sidecar)].count;
            inline for (.{ topic_mod.Kind.beacon_attestation, topic_mod.Kind.sync_committee, topic_mod.Kind.data_column_sidecar }) |kind| {
                const k = @intFromEnum(kind);
                for (0..boundary.rules[k].count) |subnet| {
                    const row = &self.rows[starts[k] + subnet];
                    if (if (peer) |index| row.subscribers.isSet(index) else row.subscribed)
                        result.add(.{ .kind = kind, .subnet = @intCast(subnet) });
                }
            }
            break;
        }
        return result;
    }

    pub fn mesh(self: *const Overlay, topic: u16) *const PeerSet {
        return &self.rows[topic].mesh;
    }

    pub fn fanoutMembers(self: *const Overlay, topic: u16) *const PeerSet {
        return &self.rows[topic].fanout;
    }

    pub fn init(a: std.mem.Allocator, seed: u64, boundaries: []const topic_policy.Boundary) !Overlay {
        var namespace = try topic_policy.Namespace.init(a, boundaries);
        errdefer namespace.deinit(a);
        const rows = try a.alloc(Row, namespace.topic_count);
        for (rows, 0..) |*row, index| {
            const canonical = namespace.topicAt(@intCast(index));
            row.* = .{ .kind = canonical.name.kind };
            row.string_len = @intCast(topic_mod.buildCanonical(canonical, &row.string).len);
        }
        return .{ .rng = std.Random.DefaultPrng.init(seed), .rows = rows, .namespace = namespace };
    }

    fn score(context: *const Context, peer: u16) f64 {
        const snapshot = context.snapshot orelse return context.peers.score(context.sessions.rows[peer].logical, context.now);
        if (snapshot[peer].generation != context.sessions.peerGeneration(peer)) return context.peers.score(context.sessions.rows[peer].logical, context.now);
        return snapshot[peer].value;
    }

    fn eligiblePeer(context: *const Context, peer: u16, threshold: f64) bool {
        const row = &context.sessions.rows[peer];
        if (!row.active or context.peers.rows[row.logical.index].direct or row.outStream() == null) return false;
        return score(context, peer) >= threshold;
    }

    fn eligibleSubscriber(self: *const Overlay, context: *const Context, topic: u16, peer: u16, threshold: f64) bool {
        return self.subscribers(topic).isSet(peer) and eligiblePeer(context, peer, threshold);
    }

    fn graftEligible(self: *const Overlay, context: *const Context, topic: u16, peer: u16) bool {
        if (!self.eligibleSubscriber(context, topic, peer, 0)) return false;
        return !context.peers.backedOff(context.sessions.rows[peer].logical, topic, context.now -| (c.backoff_slack_heartbeats * context.options.heartbeat_interval_ms));
    }

    fn outbound(context: *const Context, peer: u16) bool {
        return context.peers.rows[context.sessions.rows[peer].logical.index].direction == .outbound;
    }

    fn outboundCount(context: *const Context, members: *const Set) usize {
        var count: usize = 0;
        var it = members.iterator(.{});
        while (it.next()) |peer| if (outbound(context, @intCast(peer))) {
            count += 1;
        };
        return count;
    }

    pub fn maintain(self: *Overlay, context: *const Context, topic: u16) void {
        const members = &self.rows[topic].mesh;
        var it = members.iterator(.{});
        while (it.next()) |index| {
            const peer: u16 = @intCast(index);
            if (!eligiblePeer(context, peer, 0)) self.prune(context, topic, peer, c.prune_backoff_ms, .ineligible);
        }
        if (!self.subscribed(topic)) return;
        var candidate_peers: [c.peers_cap]u16 = undefined;
        const n = self.candidates(context, topic, &candidate_peers, true, 0);
        self.shuffle(candidate_peers[0..n]);
        var out = outboundCount(context, members);
        for (candidate_peers[0..n]) |peer| {
            if (out >= c.mesh_d_out) break;
            if (outbound(context, peer) and self.graft(context, topic, peer, .fill_outbound)) out += 1;
        }
        if (members.count() < c.mesh_d_low) {
            for (candidate_peers[0..n]) |peer| {
                if (members.count() >= c.mesh_d) break;
                _ = self.graft(context, topic, peer, .fill_mesh);
            }
        }
        if (members.count() > c.mesh_d_high) self.trim(context, topic);
    }

    fn shuffle(self: *Overlay, members: []u16) void {
        assert(members.len <= c.peers_cap);
        for (0..members.len -| 1) |i| {
            const offset = self.rng.random().uintLessThanBiased(u64, @intCast(members.len - i));
            const chosen = i + @as(usize, @intCast(offset));
            std.mem.swap(u16, &members[i], &members[chosen]);
        }
    }

    fn candidates(self: *Overlay, context: *const Context, topic: u16, out: *[c.peers_cap]u16, graft_only: bool, threshold: f64) usize {
        var count: usize = 0;
        for (0..context.sessions.rows.len) |index| {
            const peer: u16 = @intCast(index);
            if (self.mesh(topic).isSet(peer)) continue;
            if (!self.eligibleSubscriber(context, topic, peer, threshold)) continue;
            if (graft_only and !self.graftEligible(context, topic, peer)) continue;
            out[count] = peer;
            count += 1;
        }
        return count;
    }

    fn graft(self: *Overlay, context: *const Context, topic: u16, peer: u16, reason: MeshReason) bool {
        assert(reason.event() == .join);
        const members = &self.rows[topic].mesh;
        if (members.isSet(peer) or !self.graftEligible(context, topic, peer)) return false;
        const outbox = &context.sessions.rows[peer].io.tx;
        const name = self.topicString(topic);
        // A peer can reach mesh maintenance before its next I/O turn announces our subscription.
        const scratch = &context.sessions.control_scratch;
        if (outbox.subscription_dirty.isSet(topic) and !outbox.announce(topic, name, true, scratch, context.now)) return false;
        defer context.sessions.settle(peer, context.options);
        if (outbox.submit(&.{ .graft = name }, scratch, context.now) == null) return false;
        members.set(peer);
        self.mesh_changes.record(self.rows[topic].kind, reason);
        context.peers.scores.graft(context.sessions.rows[peer].logical.index, topic, context.now);
        self.logChange(context, topic, peer, "mesh_graft_queued", 0);
        return true;
    }

    pub fn prune(self: *Overlay, context: *const Context, topic: u16, peer: u16, backoff_ms: u64, reason: MeshReason) void {
        if (self.mesh(topic).isSet(peer)) {
            self.logChange(context, topic, peer, "mesh_prune_local", backoff_ms);
            self.leaveMesh(context, topic, peer, reason);
        }
        const row = &context.sessions.rows[peer];
        if (!row.active) return;
        context.peers.addBackoff(row.logical, topic, context.now, backoff_ms);
        const stream = row.outStream() orelse return;
        if (row.io.tx.submit(&.{ .prune = .{ .topic = self.topicString(topic), .backoff_s = backoff_ms / 1000 } }, &context.sessions.control_scratch, context.now) == null) {
            context.sessions.setOutbound(peer, .{ .closing = stream });
        }
        context.sessions.settle(peer, context.options);
    }

    pub fn onGraft(self: *Overlay, context: *const Context, topic: u16, peer: u16) void {
        if (!self.subscribed(topic)) return;
        const row = &context.sessions.rows[peer];
        const backoff = context.peers.backoff(row.logical, topic);
        const blocked = context.now < backoff.until;
        if (blocked) {
            context.peers.scores.penalizeFor(row.logical.index, .graft_backoff);
            if (backoff.until -| context.now > c.prune_backoff_ms - c.graft_flood_threshold_ms) context.peers.scores.penalizeFor(row.logical.index, .graft_flood);
        }
        if (row.outStream() == null) return;
        const refused = context.peers.rows[row.logical.index].direct or blocked or context.peers.score(row.logical, context.now) < 0 or
            (!self.mesh(topic).isSet(peer) and self.mesh(topic).count() >= c.mesh_d_high and !outbound(context, peer));
        if (refused) return self.prune(context, topic, peer, c.prune_backoff_ms, .refused_graft);
        if (self.mesh(topic).isSet(peer)) return;
        self.rows[topic].mesh.set(peer);
        self.mesh_changes.record(self.rows[topic].kind, .remote_graft);
        context.peers.scores.graft(row.logical.index, topic, context.now);
        self.logChange(context, topic, peer, "mesh_graft_received", 0);
    }

    pub fn onPrune(self: *Overlay, context: *const Context, topic: u16, peer: u16, backoff_ms: u64) void {
        self.logChange(context, topic, peer, "mesh_prune_received", backoff_ms);
        self.leaveMesh(context, topic, peer, .remote_prune);
        context.peers.addBackoff(context.sessions.rows[peer].logical, topic, context.now, backoff_ms);
    }

    fn trim(self: *Overlay, context: *const Context, topic: u16) void {
        var ordered: [c.peers_cap]u16 = undefined;
        var count: usize = 0;
        var it = self.mesh(topic).iterator(.{});
        while (it.next()) |peer| {
            ordered[count] = @intCast(peer);
            count += 1;
        }
        sort(context, ordered[0..count]);
        self.shuffle(ordered[c.mesh_d_score..count]);
        var survivors: Set = .empty;
        for (ordered[0..c.mesh_d_score]) |peer| survivors.set(peer);
        var out = outboundCount(context, &survivors);
        for (ordered[c.mesh_d_score..count]) |peer| {
            if (out >= c.mesh_d_out) break;
            if (outbound(context, peer)) {
                survivors.set(peer);
                out += 1;
            }
        }
        for (ordered[c.mesh_d_score..count]) |peer| {
            if (survivors.count() >= c.mesh_d) break;
            survivors.set(peer);
        }
        for (ordered[0..count]) |peer| if (!survivors.isSet(peer)) self.prune(context, topic, peer, c.prune_backoff_ms, .excess);
        assert(self.mesh(topic).count() == c.mesh_d);
    }

    fn sort(context: *const Context, members: []u16) void {
        assert(members.len <= c.peers_cap);
        for (members, 0..) |peer, i| {
            var j = i;
            for (0..i) |_| {
                if (score(context, members[j - 1]) >= score(context, peer)) break;
                members[j] = members[j - 1];
                j -= 1;
                if (j == 0) break;
            }
            members[j] = peer;
        }
    }

    pub fn opportunistic(self: *Overlay, context: *const Context, topic: u16) void {
        const members = &self.rows[topic].mesh;
        if (members.count() < 2) return;
        var ordered: [c.peers_cap]u16 = undefined;
        var n: usize = 0;
        var it = members.iterator(.{});
        while (it.next()) |peer| {
            ordered[n] = @intCast(peer);
            n += 1;
        }
        sort(context, ordered[0..n]);
        const median = if (n % 2 == 0)
            (score(context, ordered[n / 2 - 1]) + score(context, ordered[n / 2])) / 2
        else
            score(context, ordered[n / 2]);
        if (median >= context.peers.scores.params.opportunistic_graft_threshold) return;
        n = self.candidates(context, topic, &ordered, true, 0);
        self.shuffle(ordered[0..n]);
        var added: usize = 0;
        for (ordered[0..n]) |peer| {
            if (added == c.opportunistic_graft_peers) break;
            if (score(context, peer) > median and self.graft(context, topic, peer, .opportunistic)) added += 1;
        }
    }

    pub fn publicationRecipients(self: *Overlay, context: *const Context, topic: u16, flood: bool) Set {
        var result: Set = .empty;
        const threshold = context.peers.scores.params.publish_threshold;
        if (flood) {
            for (0..context.sessions.rows.len) |index| {
                if (self.eligibleSubscriber(context, topic, @intCast(index), threshold)) result.set(index);
            }
        } else {
            var it = self.mesh(topic).iterator(.{});
            while (it.next()) |index| {
                if (eligiblePeer(context, @intCast(index), threshold)) result.set(index);
            }
            if (result.count() == 0) {
                result = self.maintainFanout(context, topic, true).*;
            } else self.fillPublication(context, topic, &result);
        }
        for (context.sessions.rows, 0..) |*row, index| {
            if (row.active and row.outStream() != null and context.peers.rows[row.logical.index].direct and self.subscribers(topic).isSet(index)) result.set(index);
        }
        return result;
    }

    fn fillPublication(self: *Overlay, context: *const Context, topic: u16, members: *Set) void {
        if (members.count() >= c.mesh_d) return;
        var candidate_peers: [c.peers_cap]u16 = undefined;
        var count: usize = 0;
        for (0..context.sessions.rows.len) |index| {
            const peer: u16 = @intCast(index);
            if (members.isSet(peer)) continue;
            if (!self.eligibleSubscriber(context, topic, peer, context.peers.scores.params.publish_threshold)) continue;
            candidate_peers[count] = peer;
            count += 1;
        }
        self.shuffle(candidate_peers[0..count]);
        for (candidate_peers[0..count]) |peer| {
            if (members.count() >= c.mesh_d) break;
            members.set(peer);
        }
    }

    pub fn maintainFanout(self: *Overlay, context: *const Context, topic: u16, publishing: bool) *Set {
        const row = &self.rows[topic];
        if (!publishing and context.now -| row.fanout_last_ms >= c.fanout_ttl_ms) {
            row.fanout = .empty;
            return &row.fanout;
        }
        if (publishing) row.fanout_last_ms = context.now;
        var it = row.fanout.iterator(.{});
        while (it.next()) |peer| if (!self.eligibleSubscriber(context, topic, @intCast(peer), context.peers.scores.params.publish_threshold)) {
            row.fanout.unset(peer);
        };
        self.fillPublication(context, topic, &row.fanout);
        return &row.fanout;
    }

    pub fn gossipRecipients(self: *Overlay, context: *const Context, topic: u16, factor: f64) Set {
        assert(std.math.isFinite(factor) and factor >= 0 and factor <= 1);
        var candidates_buf: [c.peers_cap]u16 = undefined;
        const count = self.candidates(context, topic, &candidates_buf, false, context.peers.scores.params.gossip_threshold);
        var n: usize = 0;
        for (candidates_buf[0..count]) |peer| {
            if (self.fanoutMembers(topic).isSet(peer)) continue;
            candidates_buf[n] = peer;
            n += 1;
        }
        self.shuffle(candidates_buf[0..n]);
        const wanted = @min(n, @max(c.mesh_d_lazy, @as(usize, @intFromFloat(@ceil(factor * @as(f64, @floatFromInt(n)))))));
        var result: Set = .empty;
        for (candidates_buf[0..wanted]) |peer| result.set(peer);
        return result;
    }
    fn leaveMesh(self: *Overlay, context: *const Context, topic: u16, peer: u16, reason: MeshReason) void {
        assert(reason.event() == .leave);
        if (!self.rows[topic].mesh.isSet(peer)) return;
        context.peers.scores.prune(context.sessions.rows[peer].logical.index, topic, context.now);
        self.rows[topic].mesh.unset(peer);
        self.mesh_changes.record(self.rows[topic].kind, reason);
    }

    pub fn peerDisconnected(self: *Overlay, context: *const Context, peer: u16) void {
        for (0..self.rows.len) |topic| {
            self.applySubscription(context, @intCast(topic), peer, false, .session_end);
        }
    }

    pub fn peerSubscription(self: *Overlay, context: *const Context, peer: u16, name: []const u8, on: bool) ?u16 {
        assert(peer < context.sessions.rows.len);
        const match = self.namespace.lookup(name) orelse return null;
        self.applySubscription(context, match.ordinal, peer, on, .remote_unsubscribe);
        return if (self.rows[match.ordinal].active) match.ordinal else null;
    }

    fn logChange(self: *const Overlay, context: *const Context, topic: u16, peer: u16, comptime event: []const u8, backoff_ms: u64) void {
        const row = &self.rows[topic];
        const conn = context.sessions.rows[peer].conn;
        std.log.scoped(.network_mesh).debug(event ++ " connection={d}:{d} topic={s} backoff_ms={d}", .{ conn.index, conn.generation, row.string[0..row.string_len], backoff_ms });
    }
};

test "gossip policy review I3 shuffle budget holds at empty singleton and capacity" {
    var members: [c.peers_cap]u16 = undefined;
    for ([_]usize{ 0, 1, 3, c.peers_cap }) |len| {
        var mesh = try Overlay.init(std.testing.allocator, 17, &.{.{ .digest = @splat(0), .rules = .{topic_policy.Rule{ .count = 1 }} ++ .{topic_policy.Rule{}} ** (topic_policy.kind_count - 1) }});
        defer mesh.deinit(std.testing.allocator);
        var expected = mesh.rng;
        for (0..len -| 1) |_| _ = expected.next();
        for (members[0..len], 0..) |*peer, i| peer.* = @intCast(i);
        mesh.shuffle(members[0..len]);
        try std.testing.expectEqualSlices(u64, &expected.s, &mesh.rng.s);
        var seen: Set = .empty;
        for (members[0..len]) |peer| {
            try std.testing.expect(peer < len and !seen.isSet(peer));
            seen.set(peer);
        }
    }
    var mesh = try Overlay.init(std.testing.allocator, 17, &.{.{ .digest = @splat(0), .rules = .{topic_policy.Rule{ .count = 1 }} ++ .{topic_policy.Rule{}} ** (topic_policy.kind_count - 1) }});
    defer mesh.deinit(std.testing.allocator);
    var ordered = [_]u16{ 0, 1, 2, 3, 4, 5, 6, 7 };
    mesh.shuffle(&ordered);
    try std.testing.expectEqualSlices(u16, &.{ 6, 7, 2, 0, 5, 1, 3, 4 }, &ordered);
}

test {
    _ = @import("overlay_test.zig");
}
