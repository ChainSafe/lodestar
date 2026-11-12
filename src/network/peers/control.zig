const std = @import("std");
const builtin = @import("builtin");
const t = @import("types.zig");
const wire = @import("../control_wire.zig");
const Catalog = @import("catalog.zig").Catalog;
const rr = @import("../reqresp/root.zig");
const Now = @import("../types.zig").Now;
const client = @import("client.zig");
const goodbye = @import("goodbye.zig");
const DeadlineHeap = @import("../deadline_heap.zig").DeadlineHeap;
const assert = std.debug.assert;
const control_metrics = @import("control_metrics.zig");
const logging = @import("../logging.zig");
const identify_mod = @import("../identify/root.zig");
const types = @import("../types.zig");
const time = @import("../time.zig");
const Router = @import("../router.zig").Router;
const Engine = @import("../quic/Engine.zig");

const health_probe_count = @typeInfo(Control.HealthProbe).@"enum".fields.len;
const ConnectionState = struct {
    request: ?rr.ReqResp.RequestHandle = null,
    protocol: rr.Protocol = .ping_v1,
    received: bool = false,
    after_ready: bool = false,
    bytes: [wire.status_size_max]u8 = undefined,
    sink: [wire.status_size_max]u8 = undefined,
    direction: t.Direction = .inbound,
    identify_state: enum { pending, started, done } = .pending,
    identify_retry_ms: u64 = 0,
    previous_digest: [4]u8 = @splat(0),
    previous_protocol: rr.Protocol = .status_v1,
    transition_until_ms: u64 = 0,
    peer: ?t.PeerRef = null,
    conn: t.Handle = undefined,
    status_due_ms: u64 = 0,
    ping_due_ms: u64 = 0,
    retry_ms: u64 = 0,
    stream_blocked_since_ms: ?u64 = null,
    qualification_deadline_ms: u64 = 0,
    metadata_due_ms: ?u64 = null,
    health_failures: [health_probe_count]u8 = @splat(0),
    /// `ready` once the connection completed a Status and Metadata exchange, which clears the dialed
    /// endpoint's connection failures; `proven` once a probe started after that succeeded, which
    /// clears the endpoint's health strikes.
    evidence: enum { pending, ready, proven } = .pending,
    closing: ?Control.Closing = null,
    /// How the remote refused us on this connection, recorded against its identity at close: its
    /// Goodbye, or for our dial a close or a refused Status before the Status and Metadata exchange
    /// completed. None counts once a local close began.
    rejection: ?t.Rejection = null,
};
/// Owns peer qualification, health probes and their request buffers. Obsolete requests are
/// abandoned before a connection row is reused. All calls run on the network owner thread.
pub const Control = struct {
    pub const Io = struct { reqresp: *rr.ReqResp, router: *Router, engine: *Engine };
    pub const Closing = struct { reason: t.DisconnectReason, deadline_ms: u64, sent: bool = false };

    pub const Options = struct {
        starts_per_turn_max: u16 = 8,
        inbound_status_grace_ms: u64 = 15_000,
        qualification_timeout_ms: u64 = 30_000,
        probe_start_timeout_ms: u64 = 10_000,
        status_interval_ms: u64 = 300_000,
        ping_inbound_ms: u64 = 15_000,
        ping_outbound_ms: u64 = 20_000,
        status_transition_grace_ms: u64 = 10_000,
        local_retry_ms: u64 = 1_000,
        /// Consecutive failures of one probe that disconnect the peer.
        health_failures_max: u8 = 3,
        failure_retry_ms: u64 = 5_000,
    };
    /// Control probes whose failures count toward a health disconnect.
    pub const HealthProbe = enum { status, metadata, ping };

    connections: []ConnectionState,
    /// Live connections keyed on the earliest time `decide` acts on them, in ms.
    deadlines: DeadlineHeap,
    /// The rows one maintain turn takes from the heap.
    due: []u32,
    options: Options,
    cursor: usize = 0,
    consuming: bool = false,
    /// Connections taken from the deadline heap. An idle peer set visits none.
    visits: u64 = 0,
    counters: Counters = .{},

    pub const Counters = struct {
        started: u64 = 0,
        deferred: u64 = 0,
        closed: [@typeInfo(t.DisconnectReason).@"enum".fields.len]u64 = @splat(0),
        health_failures: [health_probe_count]u64 = @splat(0),
        events: control_metrics.Counters = .{},
    };
    pub fn validateOptions(options: Options) error{InvalidOptions}!void {
        if (options.starts_per_turn_max == 0 or options.starts_per_turn_max > 256 or options.health_failures_max == 0)
            return error.InvalidOptions;
        const timers = [_]u64{
            options.inbound_status_grace_ms,
            options.qualification_timeout_ms,
            options.probe_start_timeout_ms,
            options.status_interval_ms,
            options.ping_inbound_ms,
            options.ping_outbound_ms,
            options.status_transition_grace_ms,
            options.local_retry_ms,
            options.failure_retry_ms,
        };
        for (timers) |timer| if (timer == 0 or timer > 86_400_000) return error.InvalidOptions;
        if (options.qualification_timeout_ms <= options.inbound_status_grace_ms) return error.InvalidOptions;
    }

    pub fn init(a: std.mem.Allocator, options: Options, peer_capacity: u16) !Control {
        try validateOptions(options);
        const connections = try a.alloc(ConnectionState, peer_capacity);
        errdefer a.free(connections);
        var deadlines = try DeadlineHeap.init(a, peer_capacity);
        errdefer deadlines.deinit(a);
        const due = try a.alloc(u32, peer_capacity);
        errdefer a.free(due);
        @memset(connections, .{});
        return .{
            .connections = connections,
            .deadlines = deadlines,
            .due = due,
            .options = options,
        };
    }
    pub fn deinit(self: *Control, a: std.mem.Allocator) void {
        a.free(self.due);
        self.deadlines.deinit(a);
        a.free(self.connections);
        self.* = undefined;
    }
    fn connectionState(self: *Control, peer: t.PeerRef, conn: t.Handle) ?*ConnectionState {
        if (peer.index >= self.connections.len) return null;
        const row = &self.connections[peer.index];
        return if (std.meta.eql(row.peer, peer) and std.meta.eql(row.conn, conn)) row else null;
    }
    /// The owner releases any previous connection before reusing this peer row.
    pub fn connected(
        self: *Control,
        catalog: *const Catalog,
        peer: t.PeerRef,
        conn: t.Handle,
        direction: t.Direction,
        now: Now,
    ) void {
        std.debug.assert(peer.index < self.connections.len);
        self.counters.events.connected[@intFromEnum(direction)] +|= 1;
        assert(self.connections[peer.index].request == null);
        self.connections[peer.index] = .{
            .direction = direction,
            .peer = peer,
            .conn = conn,
            .status_due_ms = now.millis() +| if (direction == .inbound)
                self.options.inbound_status_grace_ms
            else
                0,
            .ping_due_ms = now.millis() +| self.pingInterval(direction),
            .qualification_deadline_ms = now.millis() +| self.options.qualification_timeout_ms,
        };
        self.rekey(catalog, peer.index);
    }
    /// Rekeys a connection from its state, the peer's catalog row and its in-flight operation.
    /// Every change to any of them calls this before the next maintain or wakeup.
    pub fn rekey(self: *Control, catalog: *const Catalog, index: usize) void {
        const row: u32 = @intCast(index);
        if (self.keyOf(catalog, index)) |key| self.deadlines.set(row, key) else self.deadlines.clear(row);
    }
    fn keyOf(self: *const Control, catalog: *const Catalog, index: usize) ?u64 {
        const row = &self.connections[index];
        const peer = row.peer orelse return null;
        const current = connectedRow(catalog, peer, row.conn) orelse return null;
        return dueAt(row, current.status != null, row.request != null);
    }
    /// The catalog row for this peer, if it still refers to this connection.
    fn connectedRow(catalog: *const Catalog, peer: t.PeerRef, conn: t.Handle) ?*const Catalog.Row {
        const current = catalog.rowFor(peer) orelse return null;
        if (current.established_slot == null or !std.meta.eql(current.connection, conn)) return null;
        return current;
    }
    fn pingInterval(self: *const Control, direction: t.Direction) u64 {
        return if (direction == .inbound)
            self.options.ping_inbound_ms
        else
            self.options.ping_outbound_ms;
    }
    /// Removes connection policy. The owner abandons its request before reusing this row.
    fn retire(self: *Control, peer: t.PeerRef, conn: t.Handle) void {
        if (self.connectionState(peer, conn)) |row| {
            row.peer = null;
            self.deadlines.clear(peer.index);
        }
    }
    /// The returned closing state is borrowed until this peer's control state next changes.
    pub fn disconnect(
        self: *Control,
        catalog: *Catalog,
        peer: t.PeerRef,
        conn: t.Handle,
        reason: t.DisconnectReason,
        now: Now,
    ) ?*Closing {
        const row = self.connectionState(peer, conn) orelse return null;
        if (!catalog.markUnavailable(peer, conn, reason)) return null;
        if (row.closing == null) {
            if (reason == .capacity or reason == .count_pruning) {
                _ = catalog.deferRedial(peer, conn, now.millis(), goodbye.cooldownMs(129));
            } else if (reason != .shutdown and reason != .remote_goodbye) {
                _ = catalog.cooldown(peer, conn, now.millis(), goodbye.cooldownMs(goodbyeReason(reason)));
            }
            const snapshot = catalog.rowFor(peer).?;
            const agent = client.agent(&snapshot.identify);
            std.log.scoped(.network_peers).debug("peer_disconnect_scheduled peer={f} connection={d}:{d} reason={s} grace_ms=2000 agent={f}", .{ logging.peer(&snapshot.identity), conn.index, conn.generation, @tagName(reason), std.json.fmt(agent, .{}) });
            row.closing = .{ .reason = reason, .deadline_ms = now.millis() +| 2_000 };
        }
        self.rekey(catalog, peer.index);
        return &row.closing.?;
    }
    pub fn reStatusPeer(self: *Control, catalog: *const Catalog, peer: t.PeerRef, conn: t.Handle, now: Now) bool {
        const row = self.connectionState(peer, conn) orelse return false;
        if (row.closing != null) return false;
        row.status_due_ms = @min(row.status_due_ms, now.millis());
        self.rekey(catalog, peer.index);
        return true;
    }
    pub fn reStatusPeers(self: *Control, catalog: *const Catalog, now: Now) void {
        for (self.connections, 0..) |*row, index| if (row.peer != null) {
            row.status_due_ms = @min(row.status_due_ms, now.millis());
            self.rekey(catalog, index);
        };
    }
    /// Invalidates Status and abandons the old fork's request before scheduling revalidation.
    /// The owner accounts for any returned peer fault before consuming another event batch.
    pub fn revalidate(
        self: *Control,
        catalog: *Catalog,
        index: usize,
        previous: t.ForkContext,
        io: *const Io,
        now: Now,
    ) ?rr.ReqResp.PeerFault {
        const row = &self.connections[index];
        const peer = row.peer orelse return null;
        if (row.closing != null) return null;
        const relevant = (connectedRow(catalog, peer, row.conn) orelse return null).status != null;
        if (!catalog.invalidateStatus(peer, row.conn)) return null;
        row.previous_digest = previous.digest;
        row.previous_protocol = wire.statusProtocol(previous);
        row.transition_until_ms = if (relevant) now.millis() +| self.options.status_transition_grace_ms else 0;
        row.status_due_ms = now.millis();
        row.retry_ms = 0;
        row.metadata_due_ms = row.metadata_due_ms orelse now.millis();
        const fault = self.abandon(io, peer, row.conn, now);
        self.rekey(catalog, index);
        return fault;
    }
    pub fn revalidationDeadline(self: *const Control, peer: t.PeerRef, conn: t.Handle, now: Now) ?u64 {
        if (peer.index >= self.connections.len) return null;
        const row = &self.connections[peer.index];
        if (!std.meta.eql(row.peer, peer) or !std.meta.eql(row.conn, conn) or row.closing != null or now.millis() >= row.transition_until_ms) return null;
        return row.transition_until_ms;
    }
    fn goodbyeReason(reason: t.DisconnectReason) u64 {
        return switch (reason) {
            .host, .shutdown, .remote_goodbye, .gossip_unavailable, .gossip_send_timeout => 1,
            .capacity, .count_pruning => 129,
            .reputation => 250,
            .banned => 251,
            .incompatible_fork, .future_head, .finalized_mismatch, .missing_availability => 2,
            .transport_closed,
            .invalid_status,
            .invalid_metadata,
            .health_timeout,
            .health_error,
            => 3,
        };
    }
    fn dueConnections(self: *Control, now: Now) []const u32 {
        var count: usize = 0;
        for (0..self.connections.len) |_| {
            const index = self.deadlines.popDue(now.millis()) orelse break;
            self.due[count] = index;
            count += 1;
        }
        self.visits +|= count;
        const due = self.due[0..count];
        if (due.len > 1) std.sort.pdq(u32, due, Rotation{ .start = self.cursor, .len = self.connections.len }, Rotation.lessThan);
        return due;
    }
    /// Orders row indices by their distance from `start`, wrapping at `len`.
    const Rotation = struct {
        start: usize,
        len: usize,
        fn lessThan(self: Rotation, a: u32, b: u32) bool {
            return (a + self.len - self.start) % self.len < (b + self.len - self.start) % self.len;
        }
    };
    fn start(self: *Control, row: *ConnectionState, protocol: rr.Protocol, code: u64, io: *const Io, local: *const t.LocalState, now: Now) (rr.ReqResp.RequestError || wire.Error)!void {
        assert(row.request == null);
        const len = switch (protocol) {
            .status_v1, .status_v2 => try wire.encodeStatus(protocol, &local.status, &row.bytes),
            .ping_v1, .goodbye_v1 => wire.encodeScalar(if (protocol == .ping_v1) local.metadata.seq_number else code, &row.bytes) catch unreachable,
            .metadata_v1, .metadata_v2, .metadata_v3 => 0,
            else => unreachable,
        };
        row.request = try io.reqresp.request(io.engine, io.router, row.conn, protocol, row.bytes[0..len], &row.sink, .{}, now);
        row.protocol = protocol;
        row.received = false;
        row.after_ready = row.evidence == .ready;
        self.counters.started +|= 1;
        row.retry_ms = 0;
        row.stream_blocked_since_ms = null;
        if (protocol == .goodbye_v1) row.closing.?.sent = true;
    }

    /// Discards an obsolete outbound request before its row or local fork state changes.
    /// Call only outside consumption of a borrowed reqresp event batch.
    fn abandon(self: *Control, io: *const Io, peer: t.PeerRef, conn: t.Handle, now: Now) ?rr.ReqResp.PeerFault {
        assert(!self.consuming);
        if (peer.index >= self.connections.len) return null;
        const row = &self.connections[peer.index];
        const request = row.request orelse return null;
        if (!std.meta.eql(row.conn, conn)) return null;
        row.request = null;
        return io.reqresp.abandon(io.engine, io.router, request, now);
    }

    /// Ends outbound buffer borrows before the row can be reused. Call outside a borrowed event
    /// batch and account for the returned peer fault. Inbound responses retain terminal delivery.
    pub fn releaseConnection(self: *Control, io: *const Io, peer: t.PeerRef, conn: t.Handle, now: Now) ?rr.ReqResp.PeerFault {
        const fault = self.abandon(io, peer, conn, now);
        self.retire(peer, conn);
        return fault;
    }

    pub fn receive(self: *Control, catalog: *Catalog, local: *const t.LocalState, io: *const Io, batch: []const rr.ReqResp.Event, now: Now, slot: u64) void {
        assert(!self.consuming);
        self.consuming = true;
        defer self.consuming = false;
        for (batch) |event| {
            const request = switch (event) {
                .request => |*incoming| {
                    const peer = catalog.findConnection(incoming.conn) orelse {
                        _ = io.reqresp.cancel(io.engine, io.router, incoming.request, now);
                        continue;
                    };
                    self.requested(catalog, peer, incoming, local, now, slot);
                    respond(io, incoming, local, now);
                    continue;
                },
                inline else => |value| value.request,
            };
            if (request.direction == .inbound) {
                switch (event) {
                    .chunk_sent => {
                        _ = io.reqresp.finish(request, now);
                    },
                    .served, .failed => {},
                    else => unreachable,
                }
            } else {
                for (self.connections) |*row| {
                    if (!std.meta.eql(row.request, request)) continue;
                    self.replied(catalog, row, event, local, now, slot);
                    if (event == .chunk) _ = io.reqresp.consume(io.engine, io.router, request, now);
                    break;
                }
            }
        }
    }

    pub const Close = struct { peer: t.PeerRef, conn: t.Handle, reason: t.DisconnectReason };

    /// Executes a bounded maintenance pass and returns the connections the owner must close
    /// before its next turn. The output has room for every connected peer.
    pub fn maintain(self: *Control, catalog: *Catalog, local: *const t.LocalState, io: *const Io, identify: *identify_mod.Handler, now: Now, closes: []Close) []Close {
        assert(closes.len >= catalog.options.max_peers);
        var count: usize = 0;
        var starts_remaining = self.options.starts_per_turn_max;
        for (self.dueConnections(now)) |index| {
            defer self.rekey(catalog, index);
            const row = &self.connections[index];
            const peer = row.peer orelse continue;
            const current = connectedRow(catalog, peer, row.conn) orelse continue;
            // Local pressure can prevent qualification too; expiry frees capacity without a strike.
            if (row.closing == null and row.evidence == .pending and now.millis() >= row.qualification_deadline_ms)
                _ = self.disconnect(catalog, peer, row.conn, .count_pruning, now);
            const relevant = current.status != null;
            const decision = decide(row, relevant, row.request != null, now.millis());
            if (decision.close) {
                closes[count] = .{ .peer = peer, .conn = row.conn, .reason = row.closing.?.reason };
                count += 1;
                continue;
            }
            if (starts_remaining > 0 and relevant and row.closing == null and row.identify_state == .pending and now.millis() >= row.identify_retry_ms) {
                starts_remaining -= 1;
                self.cursor = (index + 1) % self.connections.len;
                if (identify.start(io.router, io.engine, peer, row.conn, now)) |_| {
                    row.identify_state = .started;
                } else |_| row.identify_retry_ms = now.millis() +| 1_000;
            }
            if (decision.request) |action| if (starts_remaining > 0) {
                starts_remaining -= 1;
                self.cursor = (index + 1) % self.connections.len;
                const protocol: rr.Protocol = switch (action) {
                    .status => wire.statusProtocol(local.fork),
                    .metadata => wire.metadataProtocol(local.fork),
                    .ping => .ping_v1,
                    .goodbye => .goodbye_v1,
                };
                const code = if (action == .goodbye) goodbyeReason(row.closing.?.reason) else 0;
                self.start(row, protocol, code, io, local, now) catch |err| {
                    self.counters.deferred +|= 1;
                    row.retry_ms = now.millis() +| self.options.local_retry_ms;
                    if (err == error.StreamLimit and healthProbe(protocol) != null) {
                        const since = row.stream_blocked_since_ms orelse now.millis();
                        row.stream_blocked_since_ms = since;
                        const deadline = since +| self.options.probe_start_timeout_ms;
                        if (now.millis() >= deadline) {
                            row.stream_blocked_since_ms = null;
                            self.healthFailure(catalog, row, healthProbe(protocol).?, .timeout, now);
                        } else row.retry_ms = @min(row.retry_ms, deadline);
                    } else row.stream_blocked_since_ms = null;
                };
            };
        }
        if (builtin.is_test) self.checkDeadlines(catalog, now.millis());
        return closes[0..count];
    }

    /// Answers a peer's control request from the local state, or cancels a request it cannot
    /// answer. Reqresp copies these small responses before returning.
    fn respond(
        io: *const Io,
        event: *const @FieldType(rr.ReqResp.Event, "request"),
        local: *const t.LocalState,
        now: Now,
    ) void {
        comptime assert(wire.status_size_max <= rr.codec.error_message_max);
        var bytes: [wire.status_size_max]u8 = undefined;
        const len: usize = switch (event.protocol) {
            .status_v1, .status_v2 => wire.encodeStatus(event.protocol, &local.status, &bytes) catch {
                _ = io.reqresp.cancel(io.engine, io.router, event.request, now);
                return;
            },
            .ping_v1 => blk: {
                _ = wire.decodeScalar(event.bytes) catch {
                    _ = io.reqresp.cancel(io.engine, io.router, event.request, now);
                    return;
                };
                break :blk wire.encodeScalar(local.metadata.seq_number, &bytes) catch unreachable;
            },
            .metadata_v1, .metadata_v2, .metadata_v3 => wire.encodeMetadata(
                event.protocol,
                &local.metadata,
                local.fork,
                &bytes,
            ) catch {
                _ = io.reqresp.cancel(io.engine, io.router, event.request, now);
                return;
            },
            .goodbye_v1 => wire.encodeScalar(1, &bytes) catch unreachable,
            else => unreachable,
        };
        io.reqresp.respond(event.request, bytes[0..len], null, now) catch {
            _ = io.reqresp.cancel(io.engine, io.router, event.request, now);
            return;
        };
    }

    pub fn identifyResults(self: *Control, catalog: *Catalog, results: []const identify_mod.Handler.Result) void {
        std.debug.assert(results.len <= 64);
        for (results) |*completion| {
            const row = self.connectionState(completion.peer, completion.conn) orelse continue;
            if (row.identify_state != .started) continue;
            row.identify_state = .done;
            defer self.rekey(catalog, completion.peer.index);
            switch (completion.outcome) {
                .success => |*metadata| {
                    if (catalog.updateIdentify(completion.peer, completion.conn, metadata)) {
                        const snapshot = catalog.rowFor(completion.peer).?;
                        std.log.scoped(.network_peers).debug("identify_completed peer={f} connection={d}:{d} agent={f}", .{ logging.peer(&snapshot.identity), completion.conn.index, completion.conn.generation, std.json.fmt(client.agent(&snapshot.identify), .{}) });
                    }
                },
                .failed => |failure| {
                    const snapshot = catalog.rowFor(completion.peer).?;
                    std.log.scoped(.network_peers).debug("identify_failed peer={f} connection={d}:{d} reason={s}", .{ logging.peer(&snapshot.identity), completion.conn.index, completion.conn.generation, @tagName(failure) });
                },
            }
        }
    }

    pub fn receivedGoodbye(self: *Control, catalog: *Catalog, peer: t.PeerRef, conn: t.Handle, code: u64, during_close: bool) void {
        const reason = goodbye.reason(code);
        const snapshot = catalog.rowFor(peer).?;
        self.counters.events.goodbyeReceived(code);
        std.log.scoped(.network_peers).debug("peer_goodbye_received peer={f} connection={d}:{d} code={d} reason={s} during_close={any} agent={f}", .{ logging.peer(&snapshot.identity), conn.index, conn.generation, code, @tagName(reason), during_close, std.json.fmt(client.agent(&snapshot.identify), .{}) });
        const row = self.connectionState(peer, conn) orelse return;
        if (row.closing == null and row.rejection == null) row.rejection = goodbye.rejection(code);
    }

    /// Notes a close the remote initiated. On our dial before the Status and Metadata exchange
    /// completed, it is an early close.
    pub fn remoteClosed(self: *Control, peer: t.PeerRef, conn: t.Handle) void {
        earlyClose(self.connectionState(peer, conn) orelse return);
    }

    /// Records the remote turning our dial away before the Status and Metadata exchange completed,
    /// unless a local close began or the remote already refused us otherwise.
    fn earlyClose(row: *ConnectionState) void {
        if (row.closing == null and row.rejection == null and row.direction == .outbound and row.evidence == .pending)
            row.rejection = .early_close;
    }

    /// Returns evidence for catalog retirement. The owner then releases the connection's I/O.
    pub fn close(
        self: *Control,
        peer: t.PeerRef,
        conn: t.Handle,
        reason: t.DisconnectReason,
    ) ?Catalog.CloseEvidence {
        const row = self.connectionState(peer, conn) orelse return null;
        const evidence: Catalog.CloseEvidence = .{ .ready = row.evidence != .pending, .rejection = row.rejection };
        self.retire(peer, conn);
        self.counters.closed[@intFromEnum(reason)] +|= 1;
        return evidence;
    }
    fn acceptStatus(
        self: *Control,
        catalog: *Catalog,
        peer: t.PeerRef,
        conn: t.Handle,
        protocol: rr.Protocol,
        bytes: []const u8,
        local: *const t.LocalState,
        now: Now,
        slot: u64,
    ) void {
        const row = self.connectionState(peer, conn) orelse return;
        if (row.closing != null) return;
        const status = wire.decodeStatus(protocol, bytes) catch |err| {
            if (err == error.InvalidLength or err == error.InvalidEncoding)
                _ = catalog.report(peer, .low_tolerance, now.millis());
            _ = self.disconnect(catalog, peer, conn, .invalid_status, now);
            return;
        };
        if (now.millis() < row.transition_until_ms and protocol == row.previous_protocol and
            std.mem.eql(u8, &status.fork_digest, &row.previous_digest) and
            (protocol != wire.statusProtocol(local.fork) or !std.mem.eql(u8, &status.fork_digest, &local.fork.digest)))
        {
            if ((connectedRow(catalog, peer, conn) orelse return).status == null)
                row.retry_ms = @min(row.transition_until_ms, now.millis() +| self.options.local_retry_ms);
            return;
        }
        if (relevance(local, &status, slot)) |reason| {
            _ = self.disconnect(catalog, peer, conn, reason, now);
            return;
        }
        if (!catalog.updateStatus(peer, conn, &status, now.millis())) return;
        row.status_due_ms = now.millis() +| self.options.status_interval_ms;
        if (connectedRow(catalog, peer, conn).?.metadata == null) row.metadata_due_ms = row.metadata_due_ms orelse now.millis();
        applicationReady(catalog, row, peer, conn);
    }
    /// Marks the connection ready once it holds a valid relevant Status and a valid Metadata.
    fn applicationReady(catalog: *Catalog, row: *ConnectionState, peer: t.PeerRef, conn: t.Handle) void {
        if (row.evidence != .pending) return;
        const current = connectedRow(catalog, peer, conn) orelse return;
        if (current.status == null or current.metadata == null) return;
        row.evidence = .ready;
        catalog.clearDialFailures(peer, conn);
    }
    fn sequence(
        self: *Control,
        catalog: *Catalog,
        peer: t.PeerRef,
        conn: t.Handle,
        seq: u64,
        now: Now,
    ) void {
        const row = self.connectionState(peer, conn) orelse return;
        const snapshot = connectedRow(catalog, peer, conn) orelse return;
        if (snapshot.status == null or row.closing != null) return;
        if (snapshot.metadata) |metadata| {
            if (seq < metadata.seq_number) return;
            if (seq == metadata.seq_number) {
                _ = catalog.updateMetadata(peer, conn, &metadata, now.millis());
                return;
            }
        }
        row.metadata_due_ms = row.metadata_due_ms orelse now.millis();
    }
    fn requested(
        self: *Control,
        catalog: *Catalog,
        peer: t.PeerRef,
        event: *const @FieldType(rr.ReqResp.Event, "request"),
        local: *const t.LocalState,
        now: Now,
        slot: u64,
    ) void {
        defer self.rekey(catalog, peer.index);
        switch (event.protocol) {
            .status_v1, .status_v2 => self.acceptStatus(
                catalog,
                peer,
                event.conn,
                event.protocol,
                event.bytes,
                local,
                now,
                slot,
            ),
            .ping_v1 => {
                if (wire.decodeScalar(event.bytes)) |seq_number| self.sequence(
                    catalog,
                    peer,
                    event.conn,
                    seq_number,
                    now,
                ) else |_| {}
            },
            .metadata_v1, .metadata_v2, .metadata_v3 => {},
            .goodbye_v1 => {
                std.debug.assert(event.bytes.len == 8);
                const code = wire.decodeScalar(event.bytes) catch unreachable;
                self.receivedGoodbye(catalog, peer, event.conn, code, false);
                if (self.disconnect(catalog, peer, event.conn, .remote_goodbye, now)) |closing| closing.sent = true;
            },
            else => unreachable,
        }
    }
    fn replied(
        self: *Control,
        catalog: *Catalog,
        row: *ConnectionState,
        event: rr.ReqResp.Event,
        local: *const t.LocalState,
        now: Now,
        slot: u64,
    ) void {
        const peer = row.peer orelse return;
        defer self.rekey(catalog, peer.index);
        switch (event) {
            .chunk => |chunk| {
                self.acceptChunk(catalog, row, chunk.bytes, local, now, slot);
                row.received = true;
            },
            .done, .failed => {
                self.complete(catalog, row, event, now);
                row.request = null;
            },
            else => {},
        }
    }
    fn acceptChunk(
        self: *Control,
        catalog: *Catalog,
        row: *ConnectionState,
        bytes: []const u8,
        local: *const t.LocalState,
        now: Now,
        slot: u64,
    ) void {
        if (row.closing != null) return;
        switch (row.protocol) {
            .status_v1, .status_v2 => self.acceptStatus(
                catalog,
                row.peer.?,
                row.conn,
                row.protocol,
                bytes,
                local,
                now,
                slot,
            ),
            .ping_v1 => {
                if (wire.decodeScalar(bytes)) |seq_number| self.sequence(
                    catalog,
                    row.peer.?,
                    row.conn,
                    seq_number,
                    now,
                ) else |_| {}
            },
            .metadata_v1, .metadata_v2, .metadata_v3 => {
                const metadata = wire.decodeMetadata(row.protocol, bytes, local.fork) catch |err| {
                    if (err == error.InvalidLength or err == error.InvalidEncoding or err == error.InvalidSyncnets)
                        _ = catalog.report(row.peer.?, .low_tolerance, now.millis());
                    if (connectedRow(catalog, row.peer.?, row.conn)) |snapshot| {
                        std.log.scoped(.network_peers).debug("metadata_rejected peer={f} connection={d}:{d} method={s} reason={s} bytes={d}", .{
                            logging.peer(&snapshot.identity),
                            row.conn.index,
                            row.conn.generation,
                            @tagName(row.protocol),
                            @errorName(err),
                            bytes.len,
                        });
                    }
                    _ = self.disconnect(catalog, row.peer.?, row.conn, .invalid_metadata, now);
                    return;
                };
                _ = catalog.updateMetadata(row.peer.?, row.conn, &metadata, now.millis());
                row.metadata_due_ms = null;
                applicationReady(catalog, row, row.peer.?, row.conn);
            },
            else => {},
        }
    }
    fn complete(self: *Control, catalog: *Catalog, row: *ConnectionState, event: rr.ReqResp.Event, now: Now) void {
        if (row.closing != null) return;
        switch (event) {
            .failed => |failed| switch (failed.reason) {
                .cancelled, .host_timeout, .quota_timeout => {
                    row.retry_ms = now.millis() +| self.options.local_retry_ms;
                },
                .negotiation_rejected => {
                    const status = row.protocol == .status_v1 or row.protocol == .status_v2;
                    if (status and now.millis() < row.transition_until_ms) {
                        row.retry_ms = @min(row.transition_until_ms, now.millis() +| self.options.local_retry_ms);
                        return;
                    }
                    if (healthProbe(row.protocol)) |probe| self.countHealthFailure(row, probe, failed.reason, .immediate);
                    if (status) earlyClose(row);
                    _ = self.disconnect(catalog, row.peer.?, row.conn, .health_error, now);
                },
                else => {
                    const probe = healthProbe(row.protocol) orelse return;
                    self.healthFailure(catalog, row, probe, failed.reason, now);
                },
            },
            .done => {
                const probe = healthProbe(row.protocol) orelse return;
                if (!row.received) {
                    self.healthFailure(catalog, row, probe, .empty_response, now);
                    return;
                }
                row.health_failures[@intFromEnum(probe)] = 0;
                if (row.after_ready and probe != .metadata) {
                    row.evidence = .proven;
                    catalog.clearHealthStrikes(row.peer.?, row.conn);
                }
                const snapshot = connectedRow(catalog, row.peer.?, row.conn) orelse return;
                if (probe != .status) row.ping_due_ms = now.millis() +| self.pingInterval(snapshot.direction);
            },
            else => unreachable,
        }
    }

    fn healthFailure(self: *Control, catalog: *Catalog, row: *ConnectionState, probe: Control.HealthProbe, failure: rr.ReqResp.Failure, now: Now) void {
        const failures = &row.health_failures[@intFromEnum(probe)];
        failures.* +|= 1;
        const at_limit = failures.* >= self.options.health_failures_max;
        self.countHealthFailure(row, probe, failure, if (at_limit) .at_limit else .none);
        if (at_limit) {
            const timed_out = failure == .timeout or (failure == .negotiation_failed and failure.negotiation_failed == .timeout);
            _ = self.disconnect(catalog, row.peer.?, row.conn, if (timed_out) .health_timeout else .health_error, now);
            return;
        }
        row.retry_ms = now.millis() +| self.options.failure_retry_ms;
    }
    /// Counts a failed probe once and logs it with the probe's streak and the close it causes:
    /// none, the streak's limit, or an immediate one for a refused probe, which skips the streak.
    fn countHealthFailure(self: *Control, row: *const ConnectionState, probe: Control.HealthProbe, failure: rr.ReqResp.Failure, closes: enum { none, at_limit, immediate }) void {
        self.counters.health_failures[@intFromEnum(probe)] +|= 1;
        std.log.scoped(.network_peers).debug("peer_health_failure connection={d}:{d} probe={s} reason={s} failures={d} limit={d} close={s}", .{ row.conn.index, row.conn.generation, @tagName(probe), @tagName(failure), row.health_failures[@intFromEnum(probe)], self.options.health_failures_max, @tagName(closes) });
    }
    pub fn schedule(self: *const Control, catalog: *const Catalog, now: Now) types.Schedule {
        if (builtin.is_test) self.checkDeadlines(catalog, now.millis());
        return .{ .deadline = time.optionalMilliseconds(if (self.deadlines.peek()) |top| top.deadline else null) };
    }

    /// Test builds compare heap keys with a full scan, so every due connection stays on the heap.
    fn checkDeadlines(self: *const Control, catalog: *const Catalog, now_ms: u64) void {
        for (self.connections, 0..) |*row, index| {
            const active_request = row.request != null;
            const key = self.deadlines.get(@intCast(index));
            const peer = row.peer orelse {
                assert(key == null);
                continue;
            };
            const snapshot = catalog.get(peer) orelse {
                assert(key == null);
                continue;
            };
            if (!std.meta.eql(snapshot.connection, row.conn)) {
                assert(key == null);
                continue;
            }
            const expected = dueAt(row, snapshot.relevant, active_request);
            assert(key == expected);
            const bounded: ?u64 = if (expected) |value| @max(value, now_ms) else null;
            assert(decide(row, snapshot.relevant, active_request, now_ms).deadline_ms == bounded);
        }
    }
};

const Decision = struct {
    request: ?enum { status, metadata, ping, goodbye } = null,
    close: bool = false,
    deadline_ms: ?u64 = null,

    fn wake(self: *Decision, deadline: u64, now: u64) void {
        const bounded = @max(deadline, now);
        self.deadline_ms = @min(self.deadline_ms orelse bounded, bounded);
    }
};

/// The earliest time `decide` acts on the row. It does not depend on the clock, so a row needs a
/// new key only when its state changes; `decide` bounds the value by now.
fn dueAt(row: *const ConnectionState, relevant: bool, active_request: bool) ?u64 {
    if (row.closing) |closing| {
        if (closing.sent or active_request) return closing.deadline_ms;
        return @min(closing.deadline_ms, row.retry_ms);
    }
    var deadline: ?u64 = if (relevant and row.identify_state == .pending) row.identify_retry_ms else null;
    if (row.evidence == .pending)
        deadline = @min(deadline orelse row.qualification_deadline_ms, row.qualification_deadline_ms);
    if (active_request) return deadline;
    const metadata_due = if (relevant) row.metadata_due_ms else null;
    const refresh_due = metadata_due orelse row.ping_due_ms;
    const request_due = @max(@min(row.status_due_ms, refresh_due), row.retry_ms);
    return @min(deadline orelse request_due, request_due);
}

fn decide(row: *const ConnectionState, relevant: bool, active_request: bool, now: u64) Decision {
    var decision: Decision = .{};
    if (row.closing) |closing| {
        decision.wake(closing.deadline_ms, now);
        if (now >= closing.deadline_ms) {
            decision.close = true;
        } else if (!closing.sent and !active_request) {
            decision.wake(row.retry_ms, now);
            if (now >= row.retry_ms) decision.request = .goodbye;
        }
        return decision;
    }
    if (row.evidence == .pending) decision.wake(row.qualification_deadline_ms, now);
    if (relevant) {
        if (row.identify_state == .pending) decision.wake(row.identify_retry_ms, now);
    }
    if (active_request) return decision;
    const metadata_due = if (relevant) row.metadata_due_ms else null;
    const refresh_due = metadata_due orelse row.ping_due_ms;
    const request_due = @min(row.status_due_ms, refresh_due);
    decision.wake(@max(request_due, row.retry_ms), now);
    if (now < row.retry_ms or now < request_due) return decision;
    decision.request = if (row.status_due_ms < refresh_due)
        .status
    else if (metadata_due != null)
        .metadata
    else
        .ping;
    return decision;
}

fn healthProbe(protocol: rr.Protocol) ?Control.HealthProbe {
    return switch (protocol) {
        .status_v1, .status_v2 => .status,
        .metadata_v1, .metadata_v2, .metadata_v3 => .metadata,
        .ping_v1 => .ping,
        else => null,
    };
}

fn relevance(
    local: *const t.LocalState,
    remote: *const t.Status,
    current_slot: u64,
) ?t.DisconnectReason {
    if (!std.mem.eql(u8, &remote.fork_digest, &local.fork.digest)) return .incompatible_fork;
    if (remote.head_slot > current_slot +| 1) return .future_head;
    if (local.fork.fork.gte(.fulu) and remote.earliest_available_slot == null)
        return .missing_availability;
    const zero: [32]u8 = @splat(0);
    if (remote.finalized_epoch == local.status.finalized_epoch and
        !std.mem.eql(u8, &remote.finalized_root, &zero) and
        !std.mem.eql(u8, &local.status.finalized_root, &zero) and
        !std.mem.eql(u8, &remote.finalized_root, &local.status.finalized_root))
        return .finalized_mismatch;
    return null;
}

test {
    _ = @import("control_test.zig");
}
