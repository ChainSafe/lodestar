const std = @import("std");
const Engine = @import("../quic/Engine.zig");
const Router = @import("../router.zig").Router;
const sessions_mod = @import("sessions.zig");
const types = @import("../types.zig");
const Gossipsub = @import("Gossipsub.zig");
const ConnectionAdmission = Gossipsub.ConnectionAdmission;
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");
const peer_io_mod = @import("peer_io.zig");
const PeerIo = peer_io_mod.PeerIo;
const Session = @import("peer_session.zig").Session;
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Version = sessions_mod.Version;
const assert = std.debug.assert;
const logging = @import("../logging.zig");
const outbox = @import("outbox.zig");

const Handle = Engine.Handle;
const StreamHandle = Engine.StreamHandle;
const TransportEvent = Engine.Event;
const Now = types.Now;
const Turn = @import("turn.zig").Turn;
const Credits = @import("turn.zig").Credits;
const Progress = @import("turn.zig").Progress;

pub const openings_per_pump: usize = 16;
pub const direct_retry_delay_ms: u64 = 30_000;

pub fn peerConnected(self: *Gossipsub, engine: *Engine, conn: Handle, direct: bool, now: Now) ConnectionAdmission {
    if (self.sessions.find(conn) != null) return .admitted;
    const identity = engine.peerId(conn) orelse return .unauthenticated;
    const address = engine.peerAddress(conn) orelse return .unauthenticated;
    const direction = engine.direction(conn) orelse return .unauthenticated;
    const result = self.addPeer(conn, &.{ .identity = identity, .address = address, .direction = direction, .direct = direct }, now);
    switch (result) {
        .admitted => {},
        .duplicate => return .duplicate,
        .capacity => return .capacity,
    }
    return .admitted;
}

pub fn transportEvents(
    self: *Gossipsub,
    router: *Router,
    engine: *Engine,
    events: []const TransportEvent,
    now: Now,
) void {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    for (events) |event| switch (event) {
        .connected => |connected| {
            _ = peerConnected(self, engine, connected.conn, false, now);
        },
        .path_changed => |changed| self.peers.migrate(changed.conn, changed.peer),
        .closed => |closed| retireConnection(self, router, engine, closed.conn, now),
        else => {},
    };
}

pub fn retireConnection(self: *Gossipsub, router: *Router, engine: *Engine, conn: Handle, now: Now) void {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    const index = self.sessions.find(conn) orelse return;
    retirePeer(self, router, engine, index);
}

pub fn negotiationResult(
    self: *Gossipsub,
    engine: *Engine,
    outcome: Router.Outcome,
    now: Now,
) void {
    self.last_now_ms = @max(self.last_now_ms, now.millis());
    const index = self.sessions.find(outcome.stream.conn) orelse {
        engine.closeStream(outcome.stream, 0);
        return;
    };
    takeNegotiated(self, engine, index, outcome);
    self.settle(index);
}

fn takeNegotiated(self: *Gossipsub, engine: *Engine, index: u16, outcome: Router.Outcome) void {
    const session = &self.sessions.rows[index];
    if (session.outbound == .closing) {
        engine.closeStream(outcome.stream, 0);
        return;
    }
    if (outcome.direction == .outbound) {
        const pending = switch (session.outbound) {
            .negotiating => |stream| stream,
            else => return,
        };
        if (!std.meta.eql(pending, outcome.stream)) return;
    }
    if (outcome.result != .ready) std.log.scoped(.network_gossip_errors).debug("gossip_negotiation_failed connection={d}:{d} stream={d} direction={s} reason={s}", .{ outcome.stream.conn.index, outcome.stream.conn.generation, outcome.stream.id, @tagName(outcome.direction), if (outcome.result == .failed) @tagName(outcome.result.failed) else "rejected" });
    if (outcome.direction == .outbound) {
        switch (outcome.result) {
            .ready => |selection| {
                if (selection.leftover.len != 0) {
                    std.log.scoped(.network_gossip_errors).debug("gossip_negotiation_leftover connection={d}:{d} stream={d} bytes={d} fin={any}", .{ outcome.stream.conn.index, outcome.stream.conn.generation, outcome.stream.id, selection.leftover.len, selection.fin });
                    engine.closeStream(outcome.stream, 0);
                    resetOutbound(self, engine, index);
                    return;
                }
                replaceOutbound(
                    self,
                    engine,
                    index,
                    outcome.stream,
                    selection.protocol.meshsub,
                );
            },
            else => resetOutbound(self, engine, index),
        }
    } else switch (outcome.result) {
        .ready => |selection| {
            replaceInbound(
                self,
                engine,
                index,
                outcome.stream,
            );
            if (!self.sessions.receiveHandoff(index, selection.leftover, selection.fin)) {
                resetInbound(self, engine, index);
            }
        },
        else => {},
    }
}

/// A routed stream event. A readable edge on the inbound stream or a writable edge on the out
/// stream marks the session ready; an event for a stream the session no longer holds is dropped.
pub fn streamReady(self: *Gossipsub, engine: *Engine, route: types.Route, stream: StreamHandle, ready: types.Readiness) void {
    if (route.row >= self.sessions.rows.len) return;
    const index: u16 = @intCast(route.row);
    const session = &self.sessions.rows[index];
    if (!session.active) return;
    switch (route.owner) {
        .gossip_inbound => {
            const held = session.in_stream orelse return;
            if (!std.meta.eql(held, stream) or !ready.readable) return;
            session.io.rx_ready = true;
        },
        .gossip_outbound => {
            const held = session.outStream() orelse return;
            if (!std.meta.eql(held, stream) or !ready.writable) return;
            const tx = &session.io.tx;
            tx.writable();
            // With nothing queued, no write armed the edge: the peer stopped the stream.
            if (!tx.pending() and tx.subscription_dirty.count() == 0) {
                _ = engine.streamCapacity(stream) catch resetOutbound(self, engine, index);
            }
        },
        else => return,
    }
    self.settle(index);
}

fn openOutbound(
    self: *Gossipsub,
    router: *Router,
    engine: *Engine,
    index: u16,
    now: Now,
) void {
    const conn = self.sessions.rows[index].conn;
    const stream = router.beginMeshsub(engine, conn, now) catch |err| {
        std.log.scoped(.network_gossip_errors).debug("gossip_negotiation_refused connection={d}:{d} reason={s}", .{ conn.index, conn.generation, @errorName(err) });
        resetOutbound(self, engine, index);
        return;
    };
    self.counters.negotiation_started += 1;
    self.sessions.setOutbound(index, .{ .negotiating = stream });
}

pub fn resetInbound(self: *Gossipsub, engine: *Engine, index: u16) void {
    if (self.sessions.rows[index].in_stream) |stream| {
        std.log.scoped(.network_gossip).debug("gossip_stream_reset direction=inbound connection={d}:{d} stream={d}", .{ stream.conn.index, stream.conn.generation, stream.id });
        engine.closeStream(stream, 0);
    }
    self.sessions.rows[index].in_stream = null;
    _ = self.sessions.resetRx(index);
    self.settle(index);
}

pub fn resetOutbound(self: *Gossipsub, engine: *Engine, index: u16) void {
    if (self.sessions.rows[index].outStream()) |stream| {
        std.log.scoped(.network_gossip).debug("gossip_stream_reset direction=outbound connection={d}:{d} stream={d}", .{ stream.conn.index, stream.conn.generation, stream.id });
        engine.closeStream(stream, 0);
    }
    self.sessions.setOutbound(index, .none);
    self.cancelWrites(self.sessions.ref(index));
    self.settle(index);
}

/// Takes a negotiated inbound stream. quiche does not announce again the bytes the negotiator
/// left unread, so the session reads it at once.
fn replaceInbound(
    self: *Gossipsub,
    engine: *Engine,
    index: u16,
    stream: StreamHandle,
) void {
    if (self.sessions.rows[index].in_stream) |prior| {
        if (std.meta.eql(prior, stream)) return;
    }
    resetInbound(self, engine, index);
    engine.bindStream(stream, .{ .owner = .gossip_inbound, .row = index }) catch {};
    self.sessions.rows[index].in_stream = stream;
    self.sessions.rows[index].io.rx_ready = true;
    if (self.sessions.rows[index].outbound == .none) self.sessions.setOutbound(index, .pending);
}

/// Takes a negotiated out stream, which takes writes until one blocks.
fn replaceOutbound(
    self: *Gossipsub,
    engine: *Engine,
    index: u16,
    stream: StreamHandle,
    version: Version,
) void {
    if (self.sessions.rows[index].outStream()) |prior| {
        if (std.meta.eql(prior, stream)) return;
    }
    if (self.sessions.rows[index].outStream()) |prior| engine.closeStream(prior, 0);
    self.cancelWrites(self.sessions.ref(index));
    engine.bindStream(stream, .{ .owner = .gossip_outbound, .row = index }) catch {};
    self.sessions.setOutbound(index, .{ .live = .{ .stream = stream, .version = version } });
    self.sendSubscriptions(index);
}

pub fn retirePeer(self: *Gossipsub, router: *Router, engine: *Engine, index: u16) void {
    const peer = &self.sessions.rows[index];
    if (peer.outbound == .closing) std.log.scoped(.network_gossip_errors).debug("gossip_relationship_closed connection={d}:{d} reason={s} critical_frames={d} critical_bytes={d}", .{ peer.conn.index, peer.conn.generation, @tagName(peer.io.tx.last_drop), peer.io.tx.critical.count, peer.io.tx.critical.used });
    if (peer.outbound == .negotiating) {
        const stream = peer.outbound.negotiating;
        std.log.scoped(.network_gossip).debug("gossip_negotiation_cancelled connection={d}:{d} stream={d} reason=peer_retired", .{ stream.conn.index, stream.conn.generation, stream.id });
        router.cancel(engine, stream);
        self.sessions.setOutbound(index, .none);
    }
    if (peer.in_stream) |stream| engine.closeStream(stream, 0);
    switch (peer.outbound) {
        .live => |live| engine.closeStream(live.stream, 0),
        .closing => |stream| engine.closeStream(stream, 0),
        else => {},
    }
    self.connectionClosed(peer.conn);
}

fn readPeer(self: *Gossipsub, engine: *Engine, index: u16, io: *PeerIo, turn: *Turn, peer: *Credits) void {
    const now = turn.now;
    const stream = self.sessions.rows[index].in_stream orelse return;
    // A turn consumes at least one item, byte, or transport-call credit per iteration.
    for (0..self.options.items_per_peer + self.options.calls_per_peer + self.options.input_per_peer + 1) |_| {
        if (io.rpc != null) {
            const done = processRpc(self, index, turn, peer) catch |err| {
                const conn = self.sessions.rows[index].conn;
                std.log.scoped(.network_gossip).debug("gossip_rpc_refused connection={d}:{d} reason={s}", .{ conn.index, conn.generation, @errorName(err) });
                self.counters.malformed_rpcs += 1;
                self.peers.penalize(self.sessions.rows[index].logical, .malformed_rpc);
                resetInbound(self, engine, index);
                return;
            };
            if (done != .done) return;
            _ = self.sessions.finishFrame(io);
            if (!self.acceptsRpc(index, now)) {
                resetInbound(self, engine, index);
                return;
            }
        }
        if (io.unread_start < io.unread_end) {
            if (peer.input == 0 or turn.budget.input == 0) return;
            const logical = self.sessions.rows[index].logical;
            if ((io.reader.declaredLen() orelse 0) > io.body.len and
                now.millis() < self.peers.rows[logical.index].large_frame_denied_until)
            {
                resetInbound(self, engine, index);
                return;
            }
            const take = @min(io.unread_end - io.unread_start, peer.input, turn.budget.input);
            const result = io.feedUnread(&self.sessions.receive_pool, take, now.millis()) catch |err| {
                if (err == error.ReceiveCapacity) {
                    self.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.capacity)] += 1;
                    const victim = self.sessions.receiveVictim(index) orelse index;
                    const work = discardInboundFrame(self, victim) + self.sessions.rows.len;
                    if (victim != index) self.settle(victim);
                    turn.budget.work -|= work;
                    peer.work -|= work;
                    if (peer.work == 0 or turn.budget.work == 0) return;
                    continue;
                } else {
                    self.counters.malformed_rpcs += 1;
                    self.peers.penalize(logical, .malformed_frame);
                }
                resetInbound(self, engine, index);
                return;
            };
            peer.input -= result.consumed;
            turn.budget.input -= result.consumed;
            if (result.complete and io.discarding) _ = self.sessions.finishFrame(io);
            continue;
        }
        io.unread_start = 0;
        io.unread_end = 0;
        if (io.fin_seen) {
            resetInbound(self, engine, index);
            return;
        }
        if (peer.calls == 0 or turn.budget.calls == 0 or peer.input == 0 or turn.budget.input == 0) return;
        peer.calls -= 1;
        io.write_first = true;
        turn.budget.calls -= 1;
        const read = engine.read(stream, io.unread[0..@min(io.unread.len, peer.input, turn.budget.input)]) catch |err| {
            io.rx_ready = false;
            if (err != error.WouldBlock) resetInbound(self, engine, index);
            return;
        };
        io.unread_end = read.len;
        io.fin_seen = read.fin;
        if (read.len == 0 and !read.fin) {
            io.rx_ready = false;
            return;
        }
    }
    return;
}

/// Writes queued frames until the queue drains, a budget runs out or a write blocks. A short
/// write blocks too: the engine armed write interest for the rest, and the session waits for
/// its writable event instead of retrying.
fn flush(self: *Gossipsub, engine: *Engine, index: u16, io: *PeerIo, turn: *Turn, peer: *Credits) void {
    const now = turn.now;
    const stream = self.sessions.rows[index].outStream() orelse return;
    for (0..self.options.calls_per_peer) |_| {
        if (peer.output == 0 or turn.budget.output == 0 or peer.calls == 0 or turn.budget.calls == 0) return;
        const segment = self.writeSegment(self.sessions.ref(index));
        if (segment.len == 0) return;
        const take = @min(peer.output, turn.budget.output, segment.len);
        peer.calls -= 1;
        io.write_first = false;
        turn.budget.calls -= 1;
        self.sessions.writes +|= 1;
        const written = engine.write(stream, segment[0..take], false) catch |err| {
            if (err == error.WouldBlock) {
                self.sessions.blocked_writes +|= 1;
                io.tx.blocked(now.millis());
            } else {
                std.log.scoped(.network_gossip_errors).debug("gossip_write_failed connection={d}:{d} stream={d} reason={s} queued={d} bytes={d}", .{ stream.conn.index, stream.conn.generation, stream.id, @errorName(err), io.tx.data.count, io.tx.data.bytes });
                resetOutbound(self, engine, index);
            }
            return;
        };
        if (written == 0) {
            io.write_zero +|= 1;
            io.tx.blocked(now.millis());
            return;
        }
        peer.output -= written;
        turn.budget.output -= written;
        self.advanceWrite(self.sessions.ref(index), written, now.millis());
        if (written < take) {
            self.sessions.blocked_writes +|= 1;
            io.tx.blocked(now.millis());
            return;
        }
    }
}

pub fn serviceSession(self: *Gossipsub, router: *Router, engine: *Engine, index: u16, turn: *Turn, openings: *usize) void {
    const now = turn.now;
    const session = &self.sessions.rows[index];
    assert(session.active);
    session.receive_endpoint = engine.receiveEndpoint(session.conn);
    switch (session.outbound) {
        .closing => {
            logSendPressure(session, &self.peers.rows[session.logical.index].identity, now.millis());
            retirePeer(self, router, engine, index);
            return;
        },
        .pending => if (openings.* < openings_per_pump) {
            openOutbound(self, router, engine, index, now);
            openings.* += 1;
        },
        .none, .send_timeout, .retry_at, .negotiating, .live => {},
    }
    if (session.in_stream != null and !self.acceptsRpc(index, now)) resetInbound(self, engine, index);
    const io = &session.io;
    var peer = Credits.peer(&self.options);
    const write_first = io.write_first;
    if (write_first and io.tx.ready) flush(self, engine, index, io, turn, &peer);
    if (session.in_stream != null and io.rx_ready) readPeer(self, engine, index, io, turn, &peer);
    if (!write_first and io.tx.ready) flush(self, engine, index, io, turn, &peer);
    logSendPressure(session, &self.peers.rows[session.logical.index].identity, now.millis());
    if (session.active and session.outbound == .closing) retirePeer(self, router, engine, index);
}

pub fn processRpc(self: *Gossipsub, index: u16, turn: *Turn, peer: *Credits) protobuf.Error!Progress {
    const now = turn.now;
    const io = &self.sessions.rows[index].io;
    const rpc = &io.rpc.?;
    for (0..self.options.items_per_peer) |_| {
        if (!self.acceptsRpc(index, now)) return .done;
        if (peer.items == 0 or turn.budget.items == 0) return .credits;
        peer.items -= 1;
        turn.budget.items -= 1;
        const pending = rpc.item != null;
        if (rpc.item == null) {
            const available = @min(turn.budget.fields, peer.fields);
            var fields = available;
            const validating = rpc.reader.validator.depth != 0;
            const step = try rpc.reader.step(&fields);
            if (validating and rpc.reader.validator.depth == 0) self.rpc_received.record(rpc.reader.view.len, &rpc.reader.validator.rpc_counts);
            turn.budget.fields -= available - fields;
            peer.fields -= available - fields;
            switch (step) {
                .item => |item| {
                    rpc.item = item;
                },
                .end => return .done,
                .deferred => {
                    if (turn.budget.fields <= peer.fields) turn.deferred.insert(.fields);
                    return .credits;
                },
                .skipped => continue,
            }
        }
        if (pending) {
            const cost = rpc.item.?.fieldCost();
            if (cost > @min(turn.budget.fields, peer.fields)) {
                if (cost > turn.budget.fields) turn.deferred.insert(.fields);
                return .credits;
            }
            turn.budget.fields -= cost;
            peer.fields -= cost;
        }
        const copy_bytes = rpc.reader.view.copyBytes(rpc.item.?.bytes);
        if (!turn.chargeCopy(peer, &self.options, copy_bytes)) return .credits;
        const item = try rpc.reader.decode(rpc.item.?, self.sessions.decode_scratch);
        const result = self.receiveItem(self.sessions.ref(index), item, turn, peer);
        if (result != .done) return result;
        rpc.consumeItem();
    }
    return .credits;
}

fn discardInboundFrame(self: *Gossipsub, index: u16) usize {
    const work = self.cancelPromises(index, true);
    self.sessions.discardFrame(&self.sessions.rows[index].io);
    return work;
}

pub fn expireSession(self: *Gossipsub, router: *Router, engine: *Engine, index: u16, turn: *Turn) void {
    const now_ms = turn.now.millis();
    const g = self;
    const peer = &g.sessions.rows[index];
    assert(peer.active);
    if (peer.outbound == .retry_at and now_ms >= peer.outbound.retry_at) {
        g.sessions.setOutbound(index, if (g.peers.rows[peer.logical.index].direct) .pending else .none);
    }
    const io = &peer.io;
    for (0..3) |_| {
        const reason = io.deadlines(&g.options).expired(now_ms) orelse break;
        logIoTimeout(peer, &self.peers.rows[peer.logical.index].identity, @tagName(reason), now_ms);
        switch (reason) {
            .subscriptions => {
                g.counters.local_pressure_resets += 1;
                retirePeer(self, router, engine, index);
                break;
            },
            .receive_frame => {
                if (io.rpc != null) {
                    g.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.unattributed_timeout)] += 1;
                    turn.budget.work -|= discardInboundFrame(self, index);
                    continue;
                }
                const unread = io.unread_start < io.unread_end or io.fin_seen or
                    (if (peer.in_stream) |stream| engine.streamReadable(stream) catch true else true);
                const attributable = !io.discarding and !unread and (io.reader.declaredLen() orelse 0) > io.body.len;
                if (attributable) {
                    std.debug.assert(g.receive_timeouts_len < g.receive_timeouts.len);
                    g.receive_timeouts[g.receive_timeouts_len] = .{
                        .identity = g.peers.rows[peer.logical.index].identity,
                        .origin = .{ .connection = peer.conn, .endpoint = engine.receiveEndpoint(peer.conn) },
                    };
                    g.receive_timeouts_len += 1;
                    g.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.timeout)] += 1;
                    g.peers.rows[peer.logical.index].large_frame_denied_until = now_ms +| g.options.pressure_timeout_ms;
                } else {
                    if (!io.discarding) g.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.unattributed_timeout)] += 1;
                    turn.budget.work -|= self.cancelPromises(index, true);
                    if (io.discarding) g.counters.local_pressure_resets += 1;
                }
                resetInbound(self, engine, index);
            },
            .active_send => {
                turn.budget.work -|= self.cancelPromises(index, true);
                resetOutbound(self, engine, index);
                self.sessions.setOutbound(index, .send_timeout);
                break;
            },
            .send_queue => {
                const retry_direct = peer.outbound == .live and g.peers.rows[peer.logical.index].direct;
                resetOutbound(self, engine, index);
                if (retry_direct) g.sessions.setOutbound(index, .{ .retry_at = now_ms +| direct_retry_delay_ms });
            },
        }
    }
}

fn logSendPressure(row: *Session, identity: *const PeerId, now_ms: u64) void {
    const io = &row.io;
    if (!io.tx.pressure_pending or now_ms < io.tx.pressure_log_due_ms) return;
    io.tx.pressure_pending = false;
    io.tx.pressure_log_due_ms = now_ms +| 1_000;
    std.log.scoped(.network_gossip_errors).debug("gossip_send_pressure peer={f} connection={d}:{d} reason={s} kind={s} total={d} data_queued={d}/{d} data_bytes={d}/{d} control_frames={d} control_bytes={d} oldest_ms={d} write_blocked_ms={d} write_zero={d} budget_deferred={d}", .{ logging.peer(identity), row.conn.index, row.conn.generation, @tagName(io.tx.last_drop), if (io.tx.last_drop_kind) |kind| @tagName(kind) else "control", io.tx.drops[@intFromEnum(io.tx.last_drop)], io.tx.data.count, outbox.data_capacity, io.tx.data.bytes, constants.tx_peer_bytes, io.tx.control.count, io.tx.control.used, if (io.tx.oldest()) |oldest| now_ms -| oldest else 0, if (io.tx.blocked_since) |since| now_ms -| since else 0, io.write_zero, io.write_budget_deferred });
}

fn logIoTimeout(row: *const Session, identity: *const PeerId, reason: []const u8, now_ms: u64) void {
    const io = &row.io;
    std.log.scoped(.network_gossip_errors).debug("gossip_io_timeout peer={f} connection={d}:{d} reason={s} inbound={any} outbound={any} subscriptions={d} data_queued={d} data_bytes={d} control_bytes={d} critical_bytes={d} oldest_ms={d} active_sent={d}", .{ logging.peer(identity), row.conn.index, row.conn.generation, reason, row.in_stream != null, row.outStream() != null, io.tx.subscription_dirty.count(), io.tx.data.count, io.tx.data.bytes, io.tx.control.used, io.tx.critical.used, if (io.tx.oldest()) |oldest| now_ms -| oldest else 0, if (io.tx.active == .data) io.tx.active.data.sent() else 0 });
}
