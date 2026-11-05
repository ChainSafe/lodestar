const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const sessions_mod = @import("sessions.zig");
const Engine = @import("../quic/Engine.zig");
const peers = @import("peer_book.zig");
const local_intent = @import("local_intent.zig");
const topic_policy = @import("topic_policy.zig");
const topic_fixture = @import("topic_fixture.zig");
const MessageEvent = @import("messages.zig").MessageEvent;
const topic_mod = @import("topic.zig");
const constants = @import("constants.zig");
const peer_id = @import("../wire/peer_id.zig");
const options_mod = @import("options.zig");
const layout = @import("layout.zig");
const router_mod = @import("../router.zig");
const session_io = @import("session_io.zig");

/// Admits candidates within protocol limits and copies messages until `clear`.
pub const Inbox = struct {
    pub const capacity = 64;
    sink: Gossipsub.MessageSink = undefined,
    events: [capacity]MessageEvent = undefined,
    count: usize = 0,
    /// Report no capacity, as a full processor does.
    full: bool = false,

    /// The inbox must not move while the owner holds the sink.
    pub fn attach(self: *Inbox, g: *Gossipsub) void {
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        g.message_sink = &self.sink;
    }

    pub fn messages(self: *const Inbox) []const MessageEvent {
        return self.events[0..self.count];
    }

    pub fn last(self: *const Inbox) MessageEvent {
        std.debug.assert(self.count > 0);
        return self.events[self.count - 1];
    }

    pub fn clear(self: *Inbox) void {
        for (self.events[0..self.count]) |event| {
            std.testing.allocator.free(event.topic);
            std.testing.allocator.free(event.bytes);
        }
        self.count = 0;
    }

    pub fn deinit(self: *Inbox) void {
        self.clear();
    }

    fn hasCapacity(context: *anyopaque, _: topic_mod.Kind, _: usize) bool {
        const self: *Inbox = @ptrCast(@alignCast(context));
        return !self.full and self.count < capacity;
    }

    fn admit(context: *anyopaque, candidate: *Gossipsub.MessageAdmission) bool {
        const self: *Inbox = @ptrCast(@alignCast(context));
        if (self.full or self.count == capacity or !candidate.sourceRoom() or !candidate.fits(&candidate.room())) return false;
        const topic = std.testing.allocator.dupe(u8, candidate.event.topic) catch return false;
        const bytes = std.testing.allocator.dupe(u8, candidate.event.bytes) catch {
            std.testing.allocator.free(topic);
            return false;
        };
        candidate.commit();
        self.events[self.count] = candidate.event;
        self.events[self.count].topic = topic;
        self.events[self.count].bytes = bytes;
        self.count += 1;
        return true;
    }
};

/// Counts the messages the attached sink admits while a helper runs: `begin` routes admissions
/// through it and `end` restores the attached sink. It must not move in between.
const Admissions = struct {
    g: *Gossipsub,
    inner: ?*const Gossipsub.MessageSink,
    sink: Gossipsub.MessageSink = undefined,
    count: usize = 0,

    fn begin(self: *Admissions) void {
        if (self.inner == null) return;
        self.sink = .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
        self.g.message_sink = &self.sink;
    }

    fn end(self: *Admissions) usize {
        self.g.message_sink = self.inner;
        return self.count;
    }

    fn hasCapacity(context: *anyopaque, kind: topic_mod.Kind, size: usize) bool {
        const self: *Admissions = @ptrCast(@alignCast(context));
        return self.inner.?.has_capacity(self.inner.?.context, kind, size);
    }

    fn admit(context: *anyopaque, candidate: *Gossipsub.MessageAdmission) bool {
        const self: *Admissions = @ptrCast(@alignCast(context));
        const admitted = self.inner.?.admit(self.inner.?.context, candidate);
        self.count += @intFromBool(admitted);
        return admitted;
    }
};

pub fn init(allocator: std.mem.Allocator, options: Gossipsub.Options) !Gossipsub {
    var configured = options;
    configured.topic_policy = if (options.topic_policy.len > 0) options.topic_policy else &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })};
    return Gossipsub.init(allocator, configured);
}

pub fn subscriptionUpdate(g: *const Gossipsub, name: ?[]const u8, subscribed: bool, out: *[topic_policy.boundary_max]local_intent.Boundary) ![]const local_intent.Boundary {
    var names: [constants.topics_cap][]const u8 = undefined;
    var count: usize = 0;
    for (g.overlay.rows, 0..) |*row, index| {
        if (!row.active or !row.subscribed) continue;
        const current = g.overlay.topicString(@intCast(index));
        if (name) |changed| if (std.mem.eql(u8, current, changed)) continue;
        names[count] = current;
        count += 1;
    }
    if (name) |changed| if (subscribed) {
        if (count == names.len) return error.TopicCapacity;
        names[count] = changed;
        count += 1;
    };
    return topic_fixture.subscriptionsInto(names[0..count], out);
}

pub fn activate(g: *Gossipsub, name: []const u8) ?u16 {
    const topic = (g.overlay.namespace.lookup(name) orelse return null).ordinal;
    g.overlay.activateTopic(&g.overlayContext(g.last_now_ms), topic);
    return topic;
}

pub fn subscribe(g: *Gossipsub, name: []const u8) !void {
    try setSubscription(g, name, true);
}

pub fn unsubscribe(g: *Gossipsub, name: []const u8) !void {
    try setSubscription(g, name, false);
}

fn setSubscription(g: *Gossipsub, name: []const u8, subscribed: bool) !void {
    var boundaries: [topic_policy.boundary_max]local_intent.Boundary = undefined;
    var workspace: local_intent.Workspace = .{};
    _ = try g.prepareSubscriptions(try subscriptionUpdate(g, name, subscribed, &boundaries), &workspace, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }), g.overlay.slot);
    g.commitSubscriptions(&workspace);
}

pub fn addPeer(g: *Gossipsub, conn: Engine.Handle, version: sessions_mod.Version) ?sessions_mod.SessionRef {
    var metadata: peers.Metadata = .{
        .identity = .{ .bytes = [_]u8{0} ** peer_id.length },
        .address = .unspecified,
        .direction = .inbound,
    };
    std.mem.writeInt(u64, metadata.identity.bytes[0..8], conn.generation, .little);
    std.mem.writeInt(u16, metadata.identity.bytes[8..10], conn.index, .little);
    const peer = switch (g.addPeer(conn, &metadata, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }))) {
        .admitted => |peer| peer,
        else => return null,
    };
    g.sessions.setOutbound(peer.index, .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = version } });
    g.sendSubscriptions(peer.index);
    return peer;
}

/// Invalid deliveries the score counters hold across peers and topics.
pub fn invalidDeliveries(g: *const Gossipsub) f64 {
    var total: f64 = 0;
    for (g.peers.scores.topics) |counters| total += counters.invalid;
    return total;
}

pub fn penalize(g: *Gossipsub, conn: Engine.Handle, count: f64) void {
    const index = g.sessions.find(conn).?;
    g.peers.scores.penalize(g.sessions.rows[index].logical.index, count);
}

/// Returns the messages delivered to the attached sink.
pub fn pump(g: *Gossipsub, transport: *Engine, now: Now) usize {
    var admissions: Admissions = .{ .g = g, .inner = g.message_sink };
    admissions.begin();
    _ = pumpTurn(g, transport, now);
    return admissions.end();
}

pub fn pumpTurn(g: *Gossipsub, transport: *Engine, now: Now) Turn {
    var router = router_mod.Router.init(std.testing.allocator, .{ .negotiations_max = 1 }) catch @panic("test router allocation failed");
    defer router.deinit();
    var turn = Gossipsub.beginPump(g, now);
    Gossipsub.runTurn(g, &router, transport, &turn);
    return turn;
}

/// Now while a session is ready, else the earliest session deadline; heartbeat and
/// maintenance deadlines are left out.
pub fn sessionWakeup(g: *const Gossipsub, now: Now) u64 {
    if (g.sessions.ready.len > 0) return now.millis();
    const top = g.sessions.deadlines.peek() orelse return std.math.maxInt(u64);
    return @max(now.millis(), top.deadline);
}

pub fn processRpc(g: *Gossipsub, index: u16, now: Now, count: *usize, items: *usize) !bool {
    var admissions: Admissions = .{ .g = g, .inner = g.message_sink };
    admissions.begin();
    var turn = Turn.init(&g.options, now, g.msg_scratch);
    turn.sink = g.message_sink;
    var peer = Credits.peer(&g.options);
    peer.items = items.*;
    const result = session_io.processRpc(g, index, &turn, &peer);
    count.* += admissions.end();
    const progress = try result;
    items.* = peer.items;
    return progress == .done;
}

pub fn ageHistory(g: *Gossipsub) void {
    std.debug.assert(!g.cycle.isActive());
    g.cycle.epoch += 1;
    g.messages.history.age(&g.messages.store, g.cycle.epoch);
}

pub fn sessions(a: std.mem.Allocator, capacity: u16) !sessions_mod.Sessions {
    const options: options_mod.Options = .{ .receive_arena_bytes = 16 * 1024 * 1024, .connected_capacity = capacity, .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })} };
    return sessions_mod.Sessions.init(a, &options, &layout.Layout.init(&options));
}

const Now = @import("../types.zig").Now;
const protobuf = @import("protobuf.zig");
const Turn = @import("turn.zig").Turn;
const Credits = @import("turn.zig").Credits;
const snappy = @import("snappy");
/// Returns the messages delivered to the attached sink, or null when the item needs more credits.
pub fn receiveMessage(g: *Gossipsub, index: u16, msg: protobuf.Message, now: Now) ?usize {
    var admissions: Admissions = .{ .g = g, .inner = g.message_sink };
    admissions.begin();
    var turn = Turn.init(&g.options, now, g.msg_scratch);
    turn.sink = g.message_sink;
    var peer = Credits.peer(&g.options);
    const result = g.receiveItem(g.sessions.ref(index), .{ .message = msg }, &turn, &peer);
    const delivered = admissions.end();
    return if (result == .done) delivered else null;
}

pub fn message(g: *Gossipsub, peer: u16, text: []const u8, now_ms: u64) !?usize {
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    var compressed: [256]u8 = undefined;
    const n = try snappy.raw.compress(text, &compressed);
    return receiveMessage(g, peer, .{ .data = compressed[0..n], .topic = topic }, Now.fromMilliseconds(.{ .mono_ms = now_ms, .unix_s = 1 }));
}

pub fn control(g: *Gossipsub, index: u16, item: protobuf.Item, now: Now) void {
    const io = &g.sessions.rows[index].io;
    std.debug.assert(io.rpc == null);
    io.startRpc(&.{});
    defer io.rpc = null;
    var turn = Turn.init(&g.options, now, g.msg_scratch);
    var peer = Credits.peer(&g.options);
    std.debug.assert(g.receiveItem(g.sessions.ref(index), item, &turn, &peer) == .done);
}

pub fn heartbeat(g: *Gossipsub, now: Now) void {
    std.debug.assert(now.millis() > 0);
    g.heartbeat_at = now.millis();
    if (g.tick(now)) g.expirePromises(now.millis());
}
