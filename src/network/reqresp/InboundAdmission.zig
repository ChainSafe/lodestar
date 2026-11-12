//! Owns inbound admission ordering and promotion; Server owns wire progress and ReqResp settles
//! every slot transition. Each Server embeds its one admission record; no slot table is mirrored.
const std = @import("std");
const RequestIO = @import("RequestIO.zig");
const ReqResp = @import("ReqResp.zig");
const Server = @import("Server.zig");
const admission = @import("admission.zig");
const quotas = @import("quotas.zig");
const constants = @import("constants.zig");
const index_list = @import("../index_list.zig");
const types = @import("../types.zig");
const Engine = @import("../quic/Engine.zig");
const Handle = types.Handle;
const StreamHandle = types.StreamHandle;
const Now = types.Now;
const protocol = @import("protocol.zig");
const Protocol = protocol.Protocol;
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Address = @import("udp").Address;
const Router = @import("../router.zig").Router;
const assert = std.debug.assert;

pub const State = struct {
    cost: u128 = 1,
    paid: u128 = 0,
    eligible_ms: u64 = 0,
    /// Accepted without its start charged; promotion charges it once before serving.
    start_pending: bool = false,
    /// The last ready admission attempt; none means an attempt is due.
    wait: enum { none, start, tokens, serving } = .none,

    pub fn decoded(self: *State, cost: u128, now_ms: u64) void {
        self.cost = cost;
        self.eligible_ms = @max(self.eligible_ms, now_ms);
        if (self.eligible_ms > now_ms) {
            assert(self.start_pending);
            self.wait = .start;
        }
    }

    pub fn rejected(self: *State) void {
        self.start_pending = false;
    }

    pub fn deadline(self: *const State, timeout: u64) u64 {
        return if (self.wait == .start or self.wait == .tokens) @min(timeout, self.eligible_ms) else timeout;
    }
};

/// A checked receive slot whose start was charged or deferred. Consume immediately on this owner.
pub const Acceptance = struct {
    index: u16,
    identity: PeerId,
    protocol: Protocol,
    bounds: protocol.Info,
    state: State,
};

pub const Storage = struct { execution: ?u16, scratch: []u8 };
pub const Progress = enum { waiting, charged, admitted };

const InboundAdmission = @This();

limiter: admission.Limiter,
scope: std.meta.Tag(admission.Key),
slots_per_connection: u8,
connection_cursors: []ConnectionCursor,
ready: index_list.List = .{},
pending: bool = false,

pub fn init(allocator: std.mem.Allocator, options: quotas.Options, connections: u16, protocols: Protocol.Set, slots_per_connection: u8, scope: std.meta.Tag(admission.Key)) admission.InitError!InboundAdmission {
    var limiter = try admission.Limiter.init(allocator, protocols, options, connections);
    errdefer limiter.deinit(allocator);
    const cursors = try allocator.alloc(ConnectionCursor, connections);
    @memset(cursors, .{});
    return .{ .limiter = limiter, .scope = scope, .connection_cursors = cursors, .slots_per_connection = slots_per_connection };
}

pub fn deinit(self: *InboundAdmission, allocator: std.mem.Allocator) void {
    allocator.free(self.connection_cursors);
    self.limiter.deinit(allocator);
    self.* = undefined;
}

pub fn schedulerBytes(self: *const InboundAdmission) usize {
    return self.connection_cursors.len * @sizeOf(ConnectionCursor);
}

pub fn connected(self: *InboundAdmission, conn: Handle, identity: *const PeerId, endpoint: *const Address, now_ms: u64) void {
    assert(conn.index < self.connection_cursors.len);
    const cursor = &self.connection_cursors[conn.index];
    if (cursor.source) |held| {
        if (held.generation == conn.generation) return;
        self.limiter.release(held.row);
    }
    const key: admission.Key = switch (self.scope) {
        .peer => .{ .peer = identity.* },
        .address => .{ .address = admission.Source.fromAddress(endpoint) },
    };
    const row = self.limiter.retain(&key, now_ms);
    cursor.source = .{ .row = row, .generation = conn.generation };
}

pub fn disconnected(self: *InboundAdmission, conn: Handle) void {
    const cursor = &self.connection_cursors[conn.index];
    const held = cursor.source orelse return;
    if (held.generation != conn.generation) return;
    self.limiter.release(held.row);
    cursor.source = null;
}

pub fn sourceRow(self: *const InboundAdmission, conn: Handle) u16 {
    const held = self.connection_cursors[conn.index].source.?;
    assert(held.generation == conn.generation);
    return held.row;
}

pub fn due(self: *const InboundAdmission) bool {
    return self.pending and self.ready.len > 0;
}

pub fn capacityReleased(self: *InboundAdmission) void {
    self.pending = true;
}

pub fn waitEnded(self: *InboundAdmission, slot: *Server) void {
    assert(slot.request.running() and slot.state == .ready);
    slot.admission.wait = .none;
    self.pending = true;
}

pub fn accept(self: *InboundAdmission, owner: *ReqResp, engine: *Engine, stream: StreamHandle, ready: Router.Selection, now: Now) ReqResp.AcceptError!Acceptance {
    try owner.validateTransportCapacity(engine);
    if (stream.conn.index >= owner.options.connections) return error.InvalidCapacity;
    const identity = engine.peerId(stream.conn) orelse return error.StaleHandle;
    if (ready.leftover.len > RequestIO.read_buffer_length) return error.InvalidHandoff;
    const which = switch (ready.protocol) {
        .reqresp => |which| which,
        else => return error.UnknownProtocol,
    };
    if (!owner.receive_layout.protocols.contains(which)) return error.ProtocolDisabled;
    const bounds = owner.requestBounds(which);
    if (owner.inboundProtocolRunningCount(stream.conn, which) >= constants.MAX_CONCURRENT_REQUESTS) {
        owner.recordAdmissionRefusal(stream, which, .protocol_concurrency, 0);
        return error.ProtocolConcurrency;
    }
    const limiter = &self.limiter;
    const endpoint = engine.peerAddress(stream.conn) orelse return error.StaleHandle;
    self.connected(stream.conn, &identity, &endpoint, now.millis());
    if (owner.inboundPendingCount(stream.conn) >= owner.options.inbound_per_connection_max) {
        owner.recordAdmissionRefusal(stream, which, .connection_capacity, 0);
        return error.ConnectionSlotsExhausted;
    }
    const available = availableInbound(owner, stream.conn, which);
    const index = available orelse {
        owner.recordAdmissionRefusal(stream, which, .connection_capacity, 0);
        return error.SlotsExhausted;
    };
    const slot = &owner.inbound[index];
    if (ready.leftover.len > slot.receive.read.len) return error.InvalidHandoff;
    const request_sink = slot.receive.sink;
    assert(request_sink.len >= bounds.request_max);
    // A responder rate-limits by withholding its response, never by closing the stream, so a
    // request past the starts limiter waits in `.ready` for its start. One arriving behind a
    // request still owed its start waits too, uncharged, so it cannot take the refill that one
    // awaits. A connection retains its original accounting key even when its QUIC path changes.
    const source = self.sourceRow(stream.conn);
    const start_due: ?u64 = if (self.startsPending(owner.inbound, stream.conn))
        limiter.startAt(source, now.millis())
    else switch (limiter.start(source, now.millis())) {
        .allowed => null,
        else => limiter.startAt(source, now.millis()),
    };
    return .{
        .index = index,
        .identity = identity,
        .protocol = which,
        .bounds = bounds,
        .state = .{ .eligible_ms = start_due orelse 0, .start_pending = start_due != null },
    };
}

fn availableInbound(owner: *ReqResp, conn: Handle, which: Protocol) ?u16 {
    const first = owner.receive_layout.first(conn.index, which);
    for (owner.inbound[first..][0..constants.MAX_CONCURRENT_REQUESTS], first..) |*slot, index| {
        if (slot.request.available()) return @intCast(index);
    }
    return null;
}

pub fn settle(self: *InboundAdmission, slots: []Server, index: u16) void {
    const slot = &slots[index];
    const conn = index / self.slots_per_connection;
    const bit = @as(u64, 1) << @intCast(index % self.slots_per_connection);
    const cursor = &self.connection_cursors[conn];
    const waiting = slot.request.running() and slot.state == .ready;
    if (waiting and cursor.ready_mask & bit == 0 and slot.admission.wait == .none) self.pending = true;
    if (waiting) cursor.ready_mask |= bit else cursor.ready_mask &= ~bit;
    const linked = cursor.ready_link.linked;
    if (cursor.ready_mask != 0 and !linked) self.ready.append(self.connection_cursors, "ready_link", conn);
    if (cursor.ready_mask == 0 and linked) self.ready.remove(self.connection_cursors, "ready_link", conn);
}

/// One admission attempt per connection. A connection that was
/// admitted moves to the tail; one that was not keeps its place ahead of it.
pub fn promoteReady(self: *InboundAdmission, owner: *ReqResp, now: Now) void {
    if (!self.pending) return;
    self.pending = false;
    var promoted: usize = 0;
    const list = &self.ready;
    var next = list.head;
    // Each visited connection is behind every unvisited one once moved, so each
    // connection on the list is visited once.
    for (0..list.len) |_| {
        if (next == index_list.none) break;
        if (promoted == owner.options.work_per_pump_max) {
            self.pending = true;
            return;
        }
        const conn: u16 = @intCast(next);
        const cursor = &self.connection_cursors[conn];
        next = cursor.ready_link.next;
        if (self.promoteConnection(owner, conn, now)) {
            promoted += 1;
            // The connection's other `.ready` slots wait for the next round.
            if (cursor.ready_mask != 0) {
                self.pending = true;
                list.remove(self.connection_cursors, "ready_link", conn);
                list.append(self.connection_cursors, "ready_link", conn);
            }
        }
    }
}

/// Tries the connection's `.ready` slots in turn until one is admitted, is
/// charged its start or pays toward its cost.
fn promoteConnection(self: *InboundAdmission, owner: *ReqResp, conn: u16, now: Now) bool {
    const cursor = &self.connection_cursors[conn];
    const first = @as(usize, conn) * self.slots_per_connection;
    const start = cursor.admission;
    for (0..self.slots_per_connection) |offset| {
        const local: u8 = @intCast((start + offset) % self.slots_per_connection);
        if (cursor.ready_mask & (@as(u64, 1) << @intCast(local)) == 0) continue;
        const index: u16 = @intCast(first + local);
        owner.visits +|= 1;
        const result = self.promote(owner, index, now);
        owner.settleSlot(.inbound, index);
        if (result != .waiting) {
            cursor.admission = @intCast((local + 1) % self.slots_per_connection);
            return true;
        }
    }
    return false;
}

/// Reports admission progress explicitly; the caller finishes with ReqResp.settleSlot.
pub fn promote(self: *InboundAdmission, owner: *ReqResp, index: u16, now: Now) Progress {
    const slot = &owner.inbound[index];
    const request = &slot.request;
    const state = &slot.admission;
    if (!request.running() or slot.state != .ready or now.millis() < state.eligible_ms) return .waiting;
    var progress: Progress = .waiting;
    if (state.start_pending) {
        if (!self.chargeStart(owner.inbound, index, now)) return .waiting;
        progress = .charged;
    }
    const source = self.sourceRow(request.conn);
    const account = self.limiter.accountKey(source);
    const execution: ?u16 = if (request.protocol.isControl()) null else owner.serving.?.available(account.address) orelse {
        state.wait = .serving;
        return progress;
    };
    const cost = self.limiter.requestCost(request.protocol, state.cost, slot.request_fork);
    if (state.paid < cost) {
        const granted = self.limiter.grant(source, request.protocol, cost - state.paid, slot.request_fork, now.millis());
        state.paid += granted;
        if (granted > 0) progress = .charged;
        if (state.paid < cost) {
            state.eligible_ms = self.limiter.eligibleAt(source, request.protocol, 1, slot.request_fork, now.millis()).?;
            state.wait = .tokens;
            return progress;
        }
    }
    state.wait = .none;
    const storage: Storage = .{
        .execution = execution,
        .scratch = if (execution) |entry| owner.serving.?.acquire(entry, request.handle(index), account.address) else slot.receive.scratch,
    };
    slot.admit(index, &storage, now);
    return .admitted;
}

/// Charges the start deferred at accept once one is due and no `.ready` request
/// on the connection has waited longer. Otherwise sets when to recheck; nothing is reserved.
fn chargeStart(self: *InboundAdmission, slots: []Server, index: u16, now: Now) bool {
    const slot = &slots[index];
    const state = &slot.admission;
    const limiter = &self.limiter;
    const source = self.sourceRow(slot.request.conn);
    if (!self.startQueued(slots, index) and limiter.start(source, now.millis()) == .allowed) {
        state.start_pending = false;
        return true;
    }
    state.eligible_ms = limiter.startAt(source, now.millis());
    // A start due now goes to the longer waiter, so this one stays due an admission attempt.
    state.wait = if (state.eligible_ms > now.millis()) .start else .none;
    return false;
}

/// Fresh streams cannot spend a refill already awaited by a request on the same account.
fn startsPending(self: *const InboundAdmission, slots: []const Server, conn: Handle) bool {
    const source = self.sourceRow(conn);
    for (self.connection_cursors, 0..) |cursor, index| {
        const held = cursor.source orelse continue;
        if (held.row != source) continue;
        const first = index * self.slots_per_connection;
        for (slots[first..][0..self.slots_per_connection]) |*slot| {
            if (slot.admission.start_pending and slot.request.running()) return true;
        }
    }
    return false;
}

fn startQueued(self: *const InboundAdmission, slots: []const Server, index: u16) bool {
    const slot = &slots[index];
    const source = self.sourceRow(slot.request.conn);
    for (self.connection_cursors, 0..) |cursor, connection| {
        const held = cursor.source orelse continue;
        if (held.row != source) continue;
        const first = connection * self.slots_per_connection;
        var mask = cursor.ready_mask;
        for (0..self.slots_per_connection) |_| {
            if (mask == 0) break;
            const other = first + @ctz(mask);
            mask &= mask - 1;
            const waiter = &slots[other];
            if (other == index or !waiter.admission.start_pending) continue;
            if (waiter.request.started_ms < slot.request.started_ms) return true;
            if (waiter.request.started_ms == slot.request.started_ms and other < index) return true;
        }
    }
    return false;
}

pub fn chargeRejected(self: *InboundAdmission, owner: *ReqResp, slot: *const Server, now: Now) void {
    if (slot.admission.start_pending) return;
    const request = &slot.request;
    const decision = self.limiter.take(self.sourceRow(request.conn), request.protocol, 1, slot.request_fork, now.millis());
    if (decision == .allowed) return;
    owner.recordAdmissionRefusal(request.stream, request.protocol, switch (decision) {
        .allowed => unreachable,
        .source_quota => if (self.scope == .peer) .peer_quota else .address_quota,
        .global_quota => .global_quota,
    }, 1);
}

pub fn checkSlot(self: *const InboundAdmission, slot: *const Server, index: u16) void {
    const bit = @as(u64, 1) << @intCast(index % self.slots_per_connection);
    const waiting = slot.request.running() and slot.state == .ready;
    const cursor = &self.connection_cursors[index / self.slots_per_connection];
    assert((cursor.ready_mask & bit != 0) == waiting);
    if (waiting) assert(cursor.ready_link.linked);
    if (waiting and slot.admission.wait == .none) assert(self.pending);
}

/// Per-connection source reservation and admission cursors, ready slots and list links.
const ConnectionCursor = struct {
    source: ?struct { row: u16, generation: u32 } = null,
    admission: u8 = 0,
    ready_mask: u64 = 0,
    ready_link: index_list.Link = .{},
};

test {
    _ = @import("inbound_admission_test.zig");
}
