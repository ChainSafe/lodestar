const std = @import("std");
const metrics = @import("metrics.zig");
const binding = @import("binding.zig");
const Connection = @import("Connection.zig");
const constants = @import("../constants.zig");
const index_list = @import("../index_list.zig");
const bounds = @import("limits.zig");
const Registry = @import("Registry.zig");
const retry = @import("retry.zig");
const peer_id = @import("../wire/peer_id.zig");
const TlsContext = @import("../tls/context.zig").Context;
const types = @import("../types.zig");
const logging = @import("../logging.zig");
const stream_trace = @import("../stream_trace.zig");

const assert = std.debug.assert;
const c = binding.c;

pub const Now = types.Now;
pub const Direction = types.Direction;
pub const ShutdownDirection = types.ShutdownDirection;
pub const CloseReason = types.CloseReason;
pub const Read = types.Read;
pub const Address = types.Address;
pub const Sent = types.Sent;
pub const Readiness = types.Readiness;
pub const Route = types.Route;

pub const Error = std.mem.Allocator.Error || error{InvalidLimits};

pub const StreamError = error{
    StaleHandle,
    UnknownStream,
    WouldBlock,
    StreamStopped,
    StreamLimit,
    StreamTableFull,
    NotEstablished,
    Transport,
};

pub const DialError = error{
    Stopped,
    AddressFamilyUnsupported,
    TableFull,
    DialLimit,
    OpenFailed,
};

pub const Handle = types.Handle;
pub const StreamHandle = types.StreamHandle;

pub const Event = Connection.Event;

pub const Limits = struct {
    connections_max: u16 = bounds.connections_max_default,
    handshaking_max: u16 = bounds.handshaking_max,
    /// Concurrent inbound handshakes per IPv4 host or IPv6 /64, ignoring ports and interface.
    handshaking_per_source_max: u16 = bounds.handshaking_per_source_max,
    /// Concurrent inbound handshakes per IPv4 /24 or IPv6 /56.
    handshaking_per_prefix_max: u16 = 8,
    dialing_max: u16 = bounds.dialing_max,
    outbound_max: ?u16 = null,
    outbound_reserved: u16 = 0,
    receive_budget_bytes: u64 = bounds.receive_budget_bytes,
    initial_congestion_window_packets: u16 = bounds.initial_congestion_window_packets,
    idle_timeout_ms: u64 = bounds.idle_timeout_ms,
    handshake_timeout_ms: u64 = bounds.handshake_timeout_ms,
    unanswered_dial_timeout_ms: u64 = bounds.unanswered_dial_timeout_ms,
    keep_alive_ms: u64 = bounds.keep_alive_ms,

    pub fn validate(wanted: *const Limits) error{InvalidLimits}!void {
        if (wanted.initial_congestion_window_packets == 0 or wanted.initial_congestion_window_packets > 64) return error.InvalidLimits;
        if (wanted.connections_max == 0) return error.InvalidLimits;
        if (wanted.connections_max > bounds.connections_max_ceiling) return error.InvalidLimits;
        if (wanted.handshaking_max == 0 or wanted.handshaking_max > wanted.connections_max) {
            return error.InvalidLimits;
        }
        if (wanted.handshaking_per_source_max == 0 or wanted.handshaking_per_prefix_max == 0) return error.InvalidLimits;
        const minimum_receive_budget = @as(u64, wanted.connections_max) * bounds.connection_window_min;
        if (wanted.receive_budget_bytes < minimum_receive_budget) return error.InvalidLimits;
        if (wanted.idle_timeout_ms > bounds.timeout_ms_max or wanted.handshake_timeout_ms > bounds.timeout_ms_max or
            wanted.unanswered_dial_timeout_ms > bounds.timeout_ms_max or wanted.keep_alive_ms > bounds.timeout_ms_max) return error.InvalidLimits;
        if (wanted.idle_timeout_ms == 0) return error.InvalidLimits;
        if (wanted.handshake_timeout_ms == 0 or wanted.unanswered_dial_timeout_ms == 0) return error.InvalidLimits;
        if (wanted.keep_alive_ms == 0) return error.InvalidLimits;
        if (wanted.dialing_max == 0 or wanted.outbound_reserved > wanted.dialing_max or
            wanted.outbound_reserved > wanted.connections_max) return error.InvalidLimits;
        const outbound_max = wanted.outboundLimit();
        if (outbound_max == 0 or outbound_max > wanted.connections_max) return error.InvalidLimits;
    }

    pub fn outboundLimit(self: *const Limits) u16 {
        return self.outbound_max orelse @max(1, self.connections_max - self.connections_max / 4);
    }
};

/// Per-connection visits by phase. An idle connection is visited in none of them. Readiness tests
/// and the idle benchmarks read them.
pub const Visits = struct {
    /// Due timer keys popped before advancement.
    timer: u64 = 0,
    /// quiche_conn_on_timeout calls, made only when quiche's current timer has expired.
    timeouts: u64 = 0,
    /// Connections advanced for received packets, stream changes or timer expiry.
    advance: u64 = 0,
    /// Dirty connections a flush pass drained.
    flush: u64 = 0,
};

pub const ReceiveOutcome = union(enum) {
    accepted: Handle,
    version_negotiation: []u8,
    retry: []u8,
    dropped,
};

/// Configured flow-control windows, excluding native QUIC/TLS overhead.
pub const MemoryPlan = struct {
    requested_receive_window_bytes: u64,
    receive_window_bytes: u64,
    connection_window_bytes: u64,
    stream_window_bytes: u64,
    native_pacing_supported: bool,
};

pub const ConnectionCounters = struct {
    established: [@typeInfo(Direction).@"enum".fields.len]u64 = @splat(0),
    closed: [@typeInfo(Direction).@"enum".fields.len][@typeInfo(CloseReason).@"union".fields.len]u64 = @splat(@splat(0)),
};

const Stream = struct {
    slot: *Connection,
    index: u8,
    id: u64,
};

pub const Options = struct {
    /// Engine owns this context after init succeeds; the caller retains it on failure.
    tls: TlsContext,
    limits: Limits = .{},
    local: [2]?Address,
    /// Uniform startup secret from a cryptographic random source; borrowed only during init.
    seed: *const [std.Random.DefaultCsprng.secret_seed_length]u8,
};

const Engine = @This();

allocator: std.mem.Allocator,
tls: TlsContext,
config: binding.Config,
limits: Limits,
local: [2]?Address,
registry: Registry,
connection_window: u64,
stream_window: u64,
outbound_max: u16,
csprng: std.Random.DefaultCsprng,
retry_key: [32]u8,
visits: Visits = .{},
connection_metrics: ConnectionCounters = .{},
admission_open: bool = true,
stream_capture: ?*stream_trace.Capture = null,
/// The received packet's token, borrowed by its header until the next receive. A field
/// rather than a local so ReleaseSafe does not fill it for every datagram.
header_token: [binding.Header.token_max]u8 = undefined,

pub const Resources = struct {
    /// Occupied slots, including closed connections awaiting retirement.
    active: u16,
    /// Inbound connections still handshaking.
    handshaking: u16,
    /// Outbound connections still handshaking.
    dialing: u16,
};

pub fn resourceSnapshot(self: *const Engine) Resources {
    return .{
        .active = self.registry.active_len,
        .handshaking = self.registry.handshaking,
        .dialing = self.registry.dialing,
    };
}

pub fn init(allocator: std.mem.Allocator, options: Options) Error!Engine {
    std.debug.assert(options.local[0] != null or options.local[1] != null);
    if (options.local[0]) |address| std.debug.assert(address == .ip4);
    if (options.local[1]) |address| std.debug.assert(address == .ip6);
    const wanted = options.limits;
    try wanted.validate();

    const connection_window = @min(
        wanted.receive_budget_bytes / wanted.connections_max,
        bounds.connection_window_max,
    );
    const stream_window = connection_window / 2;

    var config = binding.Config.init(
        wanted.idle_timeout_ms,
        connection_window,
        stream_window,
        wanted.initial_congestion_window_packets,
    ) catch return error.OutOfMemory;
    errdefer config.deinit();

    var csprng = std.Random.DefaultCsprng.init(options.seed.*);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&csprng));
    var retry_key: [32]u8 = undefined;
    defer std.crypto.secureZero(u8, &retry_key);
    csprng.fill(&retry_key);
    var route_seed = csprng.random().int(u64);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&route_seed));

    var registry = try Registry.init(allocator, wanted.connections_max, route_seed);
    errdefer registry.deinit(allocator);

    return .{
        .allocator = allocator,
        .tls = options.tls,
        .config = config,
        .limits = wanted,
        .local = options.local,
        .registry = registry,
        .connection_window = connection_window,
        .stream_window = stream_window,
        .outbound_max = wanted.outboundLimit(),
        .csprng = csprng,
        .retry_key = retry_key,
    };
}

pub fn deinit(self: *Engine) void {
    self.registry.deinit(self.allocator);
    self.tls.deinit();
    self.config.deinit();
    std.crypto.secureZero(u8, std.mem.asBytes(&self.csprng));
    std.crypto.secureZero(u8, &self.retry_key);
    self.* = undefined;
}

pub fn sendOwner(self: *const Engine, index: u16) ?Handle {
    if (index >= self.registry.slots.len) return null;
    const slot = &self.registry.slots[index];
    if (slot.state == .free or slot.state == .closed) return null;
    return .{ .index = index, .generation = slot.generation };
}

pub fn failSend(self: *Engine, conn: Handle) bool {
    const slot = self.liveView(conn) orelse return false;
    if (slot.state == .closed) return false;
    self.markClosed(conn.index, .send_failed);
    return true;
}

pub fn metricsSnapshot(self: *const Engine) metrics.Snapshot {
    var result: metrics.Snapshot = .{ .counters = self.registry.retired_metrics };
    for (self.registry.activeIndices()) |index| {
        if (self.registry.slots[index].conn) |conn| result.observe(conn);
    }
    return result;
}

pub fn memoryPlan(self: *const Engine) MemoryPlan {
    const count = self.limits.connections_max;
    return .{
        .requested_receive_window_bytes = self.limits.receive_budget_bytes,
        .receive_window_bytes = self.connection_window * count,
        .connection_window_bytes = self.connection_window,
        .stream_window_bytes = self.stream_window,
        .native_pacing_supported = binding.native_pacing_supported,
    };
}

pub fn dial(
    self: *Engine,
    peer: *const Address,
    expected: peer_id.PeerId,
    now: Now,
) DialError!Handle {
    if (!self.admission_open) return error.Stopped;
    assert(self.registry.active_len <= self.registry.active.len);
    assert(self.registry.dialing <= self.registry.outbound);
    if (self.registry.dialing >= self.limits.dialing_max) return error.DialLimit;
    if (self.registry.outbound >= self.outbound_max) return error.DialLimit;
    const local = self.localFor(peer.*) orelse return error.AddressFamilyUnsupported;
    const index = self.registry.claim() orelse return error.TableFull;
    assert(index < self.registry.slots.len);
    const slot = &self.registry.slots[index];
    slot.open(&self.tls, &self.config, .{
        .direction = .outbound,
        .local = local,
        .peer = peer.*,
        .scid = self.connectionId(),
        .expected_peer_id = expected,
        .now = now,
    }) catch {
        self.registry.unclaim(index);
        return error.OpenFailed;
    };
    self.registry.addRoute(index) catch {
        self.registry.retire(index);
        return error.TableFull;
    };
    self.registry.dialing += 1;
    self.registry.outbound += 1;
    assert(self.registry.dialing <= self.limits.dialing_max);
    assert(self.registry.outbound <= self.outbound_max);
    self.markDirty(index);
    self.rekey(index, now);
    return .{ .index = index, .generation = slot.generation };
}

fn connectionId(self: *Engine) [bounds.local_cid_length]u8 {
    var bytes: [bounds.local_cid_length]u8 = undefined;
    self.csprng.fill(&bytes);
    return bytes;
}

/// An outbound connection whose final handshake flight may be unsent closes on the turn after
/// a flush drains its output.
pub fn close(self: *Engine, conn: Handle, code: u64) bool {
    const slot = self.liveSlot(conn) catch return false;
    assert(slot.conn != null);
    assert(slot.closing == .none);
    if (slot.flight_pending) slot.deferClose(.host, code) else slot.close(.host, code);
    self.markDirty(conn.index);
    return true;
}

pub fn abandon(self: *Engine, conn: Handle) bool {
    const slot = self.readableSlot(conn) catch return false;
    switch (slot.state) {
        .handshaking => {
            self.leaveHandshaking(slot);
            if (slot.direction == .outbound) {
                assert(self.registry.outbound > 0);
                self.registry.outbound -= 1;
            }
        },
        .closed => {},
        else => return false,
    }
    assert(conn.index < self.registry.slots.len);
    assert(self.registry.active_len > 0);
    self.registry.retire(conn.index);
    return true;
}

/// Permanently rejects new inbound and outbound connections. Existing routes remain usable
/// for graceful close; opening a control stream on an existing connection remains allowed.
pub fn stopAdmission(self: *Engine) void {
    self.admission_open = false;
}

/// Closes current connections without changing admission. Includes handshakes not yet admitted to the peer catalog. Retirement can reorder the
/// active list, so walk the bounded slot storage rather than that list.
pub fn closeAll(self: *Engine) void {
    for (self.registry.slots, 0..) |*slot, index| {
        const handle: Handle = .{ .index = @intCast(index), .generation = slot.generation };
        if (!self.abandon(handle)) _ = self.close(handle, 0);
    }
}

pub fn peerId(self: *const Engine, conn: Handle) ?peer_id.PeerId {
    const slot = self.liveView(conn) orelse return null;
    assert(slot.state != .free);
    assert(slot.generation == conn.generation);
    return slot.peer_id;
}

/// True once an outbound handshake processed any packet from the server, including a Retry.
pub fn dialAnswered(self: *const Engine, conn: Handle) bool {
    const slot = self.liveView(conn) orelse return false;
    return slot.direction == .outbound and slot.answered;
}

fn handshakeLimitMs(self: *const Engine, slot: *const Connection) u64 {
    if (slot.direction == .outbound and !slot.answered)
        return @min(self.limits.unanswered_dial_timeout_ms, self.limits.handshake_timeout_ms);
    return self.limits.handshake_timeout_ms;
}

/// QUIC may accept stream data from a path before validating it. Once received traffic
/// mixes endpoints, stream reads cannot recover which path supplied their bytes.
pub fn receiveEndpoint(self: *const Engine, conn: Handle) ?Address {
    const slot = self.liveView(conn) orelse return null;
    if (slot.peer_id == null or !slot.receive_endpoint_known) return null;
    return slot.peer;
}

pub fn peerAddress(self: *const Engine, conn: Handle) ?Address {
    const slot = self.liveView(conn) orelse return null;
    assert(slot.state != .free);
    assert(slot.generation == conn.generation);
    return slot.peer;
}

pub fn direction(self: *const Engine, conn: Handle) ?Direction {
    const slot = self.liveView(conn) orelse return null;
    assert(slot.state != .free);
    assert(slot.generation == conn.generation);
    return slot.direction;
}

/// Opening a stream queues no frame, so it marks nothing.
pub fn openStream(self: *Engine, conn: Handle) StreamError!StreamHandle {
    const slot = try self.liveSlot(conn);
    const opened = slot.openStream() catch |err| {
        if (err != error.StreamLimit and err != error.StreamTableFull and err != error.NotEstablished) self.markDirty(conn.index);
        return streamError(err);
    };
    assert(opened.index < bounds.streams_per_connection);
    assert(slot.table.matches(opened.index, opened.id));
    return .{ .conn = conn, .id = opened.id, .slot = opened.index };
}

/// Marks the connection dirty only when bytes were consumed or a FIN or reset was read.
/// A read that reaches Done ends the delivered readable edge.
pub fn read(self: *Engine, stream: StreamHandle, buf: []u8) StreamError!Read {
    const target = try self.readableStream(stream);
    var effects: Connection.Effects = .{};
    defer self.streamEffects(stream, effects);
    const result = target.slot.read(target.index, target.id, buf, &effects) catch |err| return streamError(err);
    if (self.stream_capture) |capture| capture.data(stream, .inbound, buf[0..result.len]);
    return result;
}

/// Names the owner that consumes readiness and terminal I/O results. Routed streams retire
/// during their terminal I/O call without emitting a close event.
pub fn bindStream(self: *Engine, stream: StreamHandle, owner: Route) StreamError!void {
    const target = try self.readableStream(stream);
    assert(target.slot.table.matches(target.index, target.id));
    target.slot.table.bind(target.index, owner);
}

/// The owner bound to a live stream, or null when the handle is stale. O(1).
pub fn route(self: *const Engine, stream: StreamHandle) ?Route {
    const slot = self.liveView(stream.conn) orelse return null;
    if (!slot.table.matches(stream.slot, stream.id)) return null;
    return slot.table.entries[stream.slot].route;
}

pub const StreamWaits = struct {
    /// A readable edge was delivered and the stream has not been read to Done since.
    read_open: bool,
    /// A blocked write waits on armed write interest, an undelivered writable edge or a stop.
    write_waiting: bool,
};

/// What an owner of a live stream on an established connection is waiting for, or null
/// otherwise. Owners check their ready lists against it.
pub fn streamWaits(self: *const Engine, stream: StreamHandle) ?StreamWaits {
    if (self.route(stream) == null) return null;
    const slot = &self.registry.slots[stream.conn.index];
    if (slot.state != .established or slot.closing != .none) return null;
    const entry = &slot.table.entries[stream.slot];
    return .{
        .read_open = slot.table.readOpen(stream.slot),
        .write_waiting = entry.write_lowat > 0 or entry.ready.writable or entry.stopped,
    };
}

pub fn streamReadable(self: *Engine, stream: StreamHandle) StreamError!bool {
    const target = try self.readableStream(stream);
    return target.slot.streamReadable(target.index, target.id);
}

/// Marks the connection dirty whenever the write reaches quiche: besides accepted bytes or a
/// queued FIN, quiche queues DATA_BLOCKED for any send the connection window cannot fit, even
/// one it refuses. A WouldBlock or short write arms write interest at min(unwritten bytes, the
/// connection's watermark ceiling); a writable event follows once the stream's send capacity
/// reaches it.
pub fn write(self: *Engine, stream: StreamHandle, bytes: []const u8, fin: bool) StreamError!usize {
    const target = try self.liveStream(stream);
    var effects: Connection.Effects = .{};
    defer self.streamEffects(stream, effects);
    const count = target.slot.write(target.index, target.id, bytes, fin, &effects) catch |err| return streamError(err);
    if (self.stream_capture) |capture| capture.data(stream, .outbound, bytes[0..count]);
    return count;
}

fn streamEffects(self: *Engine, stream: StreamHandle, effects: Connection.Effects) void {
    if (effects.closed) |closed| if (self.stream_capture) |capture| capture.streamClosed(stream, closed == .reset);
    const index = stream.conn.index;
    if (effects.dirty) self.markLiveDirty(index);
    if (effects.collect) self.markPending(index);
    self.noteEvents(index);
}

pub fn streamCapacity(self: *Engine, stream: StreamHandle) StreamError!usize {
    const target = try self.readableStream(stream);
    assert(target.slot.table.matches(target.index, target.id));
    var effects: Connection.Effects = .{};
    defer self.streamEffects(stream, effects);
    const available = target.slot.capacity(target.index, target.id, &effects) catch |err|
        return streamError(err);
    assert(target.index < bounds.streams_per_connection);
    return available;
}

pub fn shutdown(self: *Engine, stream: StreamHandle, dir: ShutdownDirection, code: u64) void {
    const target = self.liveStream(stream) catch return;
    self.streamEffects(stream, target.slot.shutdown(target.index, target.id, dir, code));
}

pub fn closeStream(self: *Engine, stream: StreamHandle, code: u64) void {
    const target = self.liveStream(stream) catch return;
    self.streamEffects(stream, target.slot.closeStream(target.index, target.id, code));
}

/// Drains connections with undelivered events in FIFO order. A connection whose events do
/// not fit stays at the head. Per connection: connected, path_changed, stream events, closed.
pub fn pollEvents(self: *Engine, events: []Event) usize {
    const slots = self.registry.slots;
    var count: usize = 0;
    var visited: usize = 0;
    while (count < events.len) : (visited += 1) {
        assert(visited <= slots.len);
        const head = self.registry.events.head;
        if (head == index_list.none) break;
        const index: u16 = @intCast(head);
        const slot = &slots[index];
        assert(slot.state != .free);
        count += slot.drainEvents(self.toHandle(index), events[count..]);
        if (slot.hasEvents()) break;
        self.registry.events.remove(slots, "event_link", index);
        if (slot.close_event == .reported) _ = self.registry.released.insert(slots, "release_link", index);
    }
    assert(count <= events.len);
    if (self.stream_capture) |capture| for (events[0..count]) |event| switch (event) {
        .connected => |connected| {
            const slot = &slots[connected.conn.index];
            capture.connected(connected.conn, &connected.peer_id, slot.peer, self.localFor(slot.peer).?, connected.direction);
        },
        .path_changed => |changed| capture.pathChanged(changed.conn, changed.peer, self.localFor(changed.peer).?),
        .stream_closed => |closed| capture.streamClosed(closed.stream, closed.reset_code != null),
        .closed => |closed| capture.disconnected(closed.conn),
        else => {},
    };
    return count;
}

/// O(1).
pub fn eventsPending(self: *const Engine) bool {
    return self.registry.events.len > 0;
}

/// First connection that may have output. O(1).
pub fn nextDirty(self: *const Engine) ?u16 {
    const head = self.registry.dirty.head;
    return if (head == index_list.none) null else @intCast(head);
}

pub fn dirtyCount(self: *const Engine) usize {
    return self.registry.dirty.len;
}

/// A flush left connections with output. O(1).
pub fn backlog(self: *const Engine) bool {
    return self.registry.dirty.len > 0;
}

/// Earliest timer key in monotonic nanoseconds. O(1).
pub fn nextDeadlineNs(self: *const Engine) ?u64 {
    const top = self.registry.timers.peek() orelse return null;
    return top.deadline;
}

pub fn receive(
    self: *Engine,
    datagram: []u8,
    from: *const Address,
    now: Now,
    out: []u8,
) ReceiveOutcome {
    assert(datagram.len <= out.len);
    assert(self.registry.slots.len > 0);
    const local = self.localFor(from.*) orelse return .dropped;
    const header = binding.Header.parse(datagram, &self.header_token) catch
        return .dropped;
    if (self.registry.findRoute(&header.dcid)) |index| {
        _ = self.feed(index, datagram, from, false);
        return .{ .accepted = self.toHandle(index) };
    }
    if (header.packet_type == .short) {
        // A peer that changed its connection ID after a rebinding is found by address. Junk
        // from a live peer's address marks nothing.
        const index = self.slotForPeer(from) orelse
            return .dropped;
        if (!self.feed(index, datagram, from, true)) return .dropped;
        return .{ .accepted = self.toHandle(index) };
    }
    if (!self.admission_open) return .dropped;
    if (datagram.len < bounds.client_initial_min) {
        return .dropped;
    }
    if (header.packet_type == .version_negotiation or header.version == 0) {
        return .dropped;
    }
    if (!binding.c.quiche_version_is_supported(header.version)) {
        return negotiateVersion(&header, out);
    }
    if (header.packet_type != .initial) return .dropped;
    // RFC 9000 section 7.2 requires at least eight bytes for a new connection's DCID.
    if (header.dcid.len < bounds.initial_dcid_length_min) return .dropped;
    if (self.registry.handshaking >= self.limits.handshaking_max) {
        return .dropped;
    }
    if (self.handshakingFromSource(from, false) >= self.limits.handshaking_per_source_max or
        self.handshakingFromSource(from, true) >= self.limits.handshaking_per_prefix_max)
    {
        return .dropped;
    }
    if (!retry.isLocal(header.token)) {
        return self.sendRetry(&header, from, now, out);
    }
    const original = retry.validate(&self.retry_key, from, &header.dcid, header.token, now.millis(), self.limits.handshake_timeout_ms) orelse return .dropped;
    const scid = header.dcid.bytes[0..bounds.local_cid_length].*;
    const reserved = self.limits.outbound_reserved -| self.registry.dialing;
    if (self.limits.connections_max - self.registry.active_len <= reserved)
        return .dropped;
    const index = self.registry.claim() orelse return .dropped;

    const slot = &self.registry.slots[index];
    slot.open(&self.tls, &self.config, .{
        .direction = .inbound,
        .original_dcid = original,
        .local = local,
        .peer = from.*,
        .scid = scid,
        .expected_peer_id = null,
        .now = now,
    }) catch {
        self.registry.unclaim(index);
        return .dropped;
    };
    self.registry.addRoute(index) catch {
        self.registry.retire(index);
        return .dropped;
    };
    assert(slot.scid.eql(&header.dcid));
    self.registry.handshaking += 1;
    assert(self.registry.handshaking <= self.limits.handshaking_max);
    _ = self.feed(index, datagram, from, false);
    self.rekey(index, now);
    return .{ .accepted = self.toHandle(index) };
}

fn sendRetry(self: *Engine, header: *const binding.Header, from: *const Address, now: Now, out: []u8) ReceiveOutcome {
    const bytes = self.connectionId();
    const scid = binding.Cid.fromSlice(&bytes);
    var buffer: [retry.token_max]u8 = undefined;
    const token = retry.mint(&self.retry_key, from, &header.dcid, &scid, now.millis(), &buffer);
    const length = (binding.check(c.quiche_retry(header.scid.slice().ptr, header.scid.len, header.dcid.slice().ptr, header.dcid.len, scid.slice().ptr, scid.len, token.ptr, token.len, header.version, out.ptr, out.len)) catch return .dropped) orelse return .dropped;
    return .{ .retry = out[0..length] };
}

fn negotiateVersion(
    header: *const binding.Header,
    out: []u8,
) ReceiveOutcome {
    const written = binding.check(c.quiche_negotiate_version(
        header.scid.slice().ptr,
        header.scid.len,
        header.dcid.slice().ptr,
        header.dcid.len,
        out.ptr,
        out.len,
    )) catch return .dropped;
    const length = written orelse return .dropped;
    assert(length <= out.len);
    return .{ .version_negotiation = out[0..length] };
}

/// Advances received connections and due timers once, then gathers their stream readiness.
/// Call after the receive batch, before observing events, streams or the next deadline.
/// Sending remains a separate phase and refreshes deadlines after each burst.
pub fn advance(self: *Engine, now: Now) void {
    const registry = &self.registry;
    const slots = registry.slots;
    // Gather due keys before re-keying any connection, including immediately due ones.
    for (0..slots.len) |_| {
        const row = registry.timers.popDue(now.nanos()) orelse break;
        self.visits.timer +|= 1;
        self.markPending(@intCast(row));
    }

    var visited: usize = 0;
    while (registry.pending.head != index_list.none) : (visited += 1) {
        assert(visited < slots.len);
        const index: u16 = @intCast(registry.pending.head);
        const slot = &slots[index];
        assert(slot.state == .handshaking or slot.state == .established);
        self.visits.advance +|= 1;
        // Received packets may have replaced the timer represented by the old heap key.
        if (slot.timeoutNs()) |remaining| if (remaining == 0) {
            slot.onTimeout();
            self.visits.timeouts +|= 1;
        };
        if (slot.state == .handshaking and slot.closing == .none and
            now.millis() -| slot.created_ms >= self.handshakeLimitMs(slot))
        {
            const unanswered = slot.direction == .outbound and !slot.answered;
            slot.close(if (unanswered) .dial_unanswered else .handshake_timeout, types.app_error_handshake_timeout);
        }
        if (slot.state == .established and slot.closing == .none and
            now.millis() -| slot.last_send_ms >= self.limits.keep_alive_ms and
            slot.keepAlive())
        {
            slot.last_send_ms = now.millis();
        }
        slot.closeAfterFlight();
        self.refresh(index);
        slot.collectStreams();
        self.observePath(index);
        self.markLiveDirty(index);
        self.rekey(index, now);
        self.noteEvents(index);
        // Keep it linked through refresh so establishment cannot enqueue it twice.
        if (slot.pending_link.linked) registry.pending.remove(slots, "pending_link", index);
    }
}

/// Sends one datagram from the connection, or returns null when quiche has nothing to send.
pub fn sendOne(self: *Engine, index: u16, now: Now, out: []u8) ?Sent {
    if (index >= self.registry.slots.len) return null;
    const slot = &self.registry.slots[index];
    if (slot.state == .free or slot.state == .closed) return null;
    const datagram = slot.send(now.millis(), out) catch {
        self.refresh(index);
        return null;
    };
    if (datagram == null) {
        // The establishing pass acknowledges the server's Handshake flight, and quiche sends that
        // ACK regardless of congestion and then discards the Initial space's bytes in flight.
        // Cubic keeps two datagrams of window and the final flight fits one, so Done means it left.
        slot.flight_pending = false;
        self.refresh(index);
    }
    return datagram;
}

/// Ends one burst of sendOne calls: refreshes the timer key, then removes a drained
/// connection from dirty or moves an undrained one to its tail. The key adds quiche's
/// remaining time to `now`, so a live clock is read after the burst.
pub fn sent(self: *Engine, index: u16, now: Now, drained: bool) void {
    assert(index < self.registry.slots.len);
    self.visits.flush +|= 1;
    const slots = self.registry.slots;
    const slot = &slots[index];
    if (slot.dirty_link.linked) {
        self.registry.dirty.remove(slots, "dirty_link", index);
        const live = slot.state == .handshaking or slot.state == .established;
        if (!drained and live) self.registry.dirty.append(slots, "dirty_link", index);
    }
    self.rekey(index, now);
    self.noteEvents(index);
}

/// Ends a turn's flush pass. Test builds check the engine invariants here.
pub fn finishFlush(self: *Engine, now: Now) void {
    if (@import("builtin").is_test or @import("builtin").fuzz) self.checkInvariants(now);
}

/// E1 to E5. Runs after the turn's last send.
pub fn checkInvariants(self: *Engine, now: Now) void {
    const slots = self.registry.slots;
    var scratch: [constants.datagram_size_max]u8 = undefined;
    for (slots, 0..) |*slot, position| {
        const index: u16 = @intCast(position);
        if (slot.state == .free) {
            assert(!slot.pending_link.linked and !slot.dirty_link.linked and !slot.event_link.linked and !slot.release_link.linked);
            assert(self.registry.timers.get(index) == null);
            continue;
        }
        // E3: undelivered events if and only if the slot is on the events list.
        assert(slot.event_link.linked == slot.hasEvents());
        if (slot.state == .closed) {
            assert(!slot.pending_link.linked and !slot.dirty_link.linked);
            assert(self.registry.timers.get(index) == null);
            continue;
        }
        // E1: application deadlines remain covered. rekey checks the native deadline using
        // the timeout sampled there; resampling it here would mix two clock readings.
        const key = self.registry.timers.get(index);
        if (slot.closing == .none or (slot.closing == .after_flight and !slot.flight_pending)) assert(key != null);
        if (key) |deadline| {
            if (slot.closing == .none) {
                const due_ms = if (slot.state == .handshaking)
                    slot.created_ms +| self.handshakeLimitMs(slot)
                else
                    slot.last_send_ms +| self.limits.keep_alive_ms;
                assert(deadline <= due_ms *| std.time.ns_per_ms);
            }
            if (slot.closing == .after_flight and !slot.flight_pending) assert(deadline <= now.nanos());
        }
        // E2: a slot off the dirty list has no output.
        if (!slot.dirty_link.linked) {
            var info: binding.SendInfo = undefined;
            const rc = binding.connSend(slot.conn.?, &scratch, &info);
            assert(rc == c.QUICHE_ERR_DONE);
        }
        if (slot.pending_link.linked or slot.state != .established or slot.closing == .after_flight) continue;
        slot.checkStreamInvariants();
    }
}

pub fn releasesPending(self: *const Engine) bool {
    return self.registry.released.len > 0;
}

/// Retires the connections whose close event was delivered by an earlier pollEvents call.
pub fn releaseReported(self: *Engine) void {
    const slots = self.registry.slots;
    var released: usize = 0;
    while (self.registry.released.pop(slots, "release_link")) |row| : (released += 1) {
        assert(released < slots.len);
        const index: u16 = @intCast(row);
        const slot = &slots[index];
        assert(slot.state == .closed and slot.close_event == .reported);
        assert(!slot.hasEvents());
        self.registry.retire(index);
    }
}

/// The earliest deadline among quiche's timers, the handshake limit, keep-alive and a deferred
/// close whose flight left, or null when none is armed.
fn deadlineNs(self: *const Engine, index: u16, now: Now, native_deadline: ?u64) ?u64 {
    const slot = &self.registry.slots[index];
    if (slot.state != .handshaking and slot.state != .established) return null;
    var deadline = native_deadline;
    if (slot.closing == .none) {
        const due_ms = if (slot.state == .handshaking)
            slot.created_ms +| self.handshakeLimitMs(slot)
        else
            slot.last_send_ms +| self.limits.keep_alive_ms;
        const due = due_ms *| std.time.ns_per_ms;
        deadline = @min(deadline orelse due, due);
    }
    if (slot.closing == .after_flight and !slot.flight_pending) deadline = @min(deadline orelse now.nanos(), now.nanos());
    return deadline;
}

fn rekey(self: *Engine, index: u16, now: Now) void {
    const slot = &self.registry.slots[index];
    const live = slot.state == .handshaking or slot.state == .established;
    const remaining = if (live) slot.timeoutNs() else null;
    const native_deadline = if (remaining) |ns| now.nanos() +| ns else null;
    const scheduled = self.deadlineNs(index, now, native_deadline);
    if (scheduled) |deadline| {
        self.registry.timers.set(index, deadline);
    } else self.registry.timers.clear(index);
    assert(self.registry.timers.get(index) == scheduled);
    if (native_deadline) |deadline| assert(self.registry.timers.get(index).? <= deadline);
}

fn markPending(self: *Engine, index: u16) void {
    _ = self.registry.pending.insert(self.registry.slots, "pending_link", index);
}

fn markDirty(self: *Engine, index: u16) void {
    const slot = &self.registry.slots[index];
    assert(slot.state == .handshaking or slot.state == .established);
    _ = self.registry.dirty.insert(self.registry.slots, "dirty_link", index);
}

fn markLiveDirty(self: *Engine, index: u16) void {
    const slot = &self.registry.slots[index];
    if (slot.state == .handshaking or slot.state == .established) self.markDirty(index);
}

fn noteEvents(self: *Engine, index: u16) void {
    const slot = &self.registry.slots[index];
    if (slot.state == .free) return;
    if (slot.hasEvents()) {
        _ = self.registry.events.insert(self.registry.slots, "event_link", index);
    } else if (slot.event_link.linked) {
        // Retiring a routed stream can remove its last undelivered readiness event.
        self.registry.events.remove(self.registry.slots, "event_link", index);
    }
}

fn streamError(err: Connection.Error) StreamError {
    return switch (err) {
        error.UnknownStream => error.UnknownStream,
        error.WouldBlock => error.WouldBlock,
        error.StreamStopped => error.StreamStopped,
        error.StreamLimit => error.StreamLimit,
        error.StreamTableFull => error.StreamTableFull,
        error.NotEstablished => error.NotEstablished,
        else => return error.Transport,
    };
}

fn liveStream(self: *Engine, stream: StreamHandle) StreamError!Stream {
    const slot = try self.liveSlot(stream.conn);
    if (!slot.table.matches(stream.slot, stream.id)) return error.UnknownStream;
    assert(stream.slot < bounds.streams_per_connection);
    assert(slot.conn != null);
    return .{ .slot = slot, .index = stream.slot, .id = stream.id };
}

fn readableStream(self: *Engine, stream: StreamHandle) StreamError!Stream {
    const slot = try self.readableSlot(stream.conn);
    if (!slot.table.matches(stream.slot, stream.id)) return error.UnknownStream;
    assert(stream.slot < bounds.streams_per_connection);
    assert(slot.conn != null);
    return .{ .slot = slot, .index = stream.slot, .id = stream.id };
}

fn readableSlot(self: *Engine, conn: Handle) StreamError!*Connection {
    if (conn.index >= self.registry.slots.len) return error.StaleHandle;
    const slot = &self.registry.slots[conn.index];
    if (slot.generation != conn.generation or slot.conn == null) return error.StaleHandle;
    return slot;
}

fn liveSlot(self: *Engine, conn: Handle) StreamError!*Connection {
    const slot = try self.readableSlot(conn);
    if (slot.state == .free or slot.state == .closed or slot.closing != .none) {
        return error.StaleHandle;
    }
    return slot;
}

fn liveView(self: *const Engine, conn: Handle) ?*const Connection {
    if (conn.index >= self.registry.slots.len) return null;
    const slot = &self.registry.slots[conn.index];
    if (slot.generation != conn.generation or slot.state == .free) return null;
    return slot;
}

fn toHandle(self: *const Engine, index: u16) Handle {
    return .{ .index = index, .generation = self.registry.slots[index].generation };
}

fn localFor(self: *const Engine, peer: Address) ?Address {
    return self.local[
        switch (peer) {
            .ip4 => @as(usize, 0),
            .ip6 => 1,
        }
    ];
}

/// Returns false only when progress was required and quiche neither processed a packet nor
/// started closing.
fn feed(self: *Engine, index: u16, datagram: []u8, from: *const Address, require_progress: bool) bool {
    assert(index < self.registry.slots.len);
    assert(datagram.len > 0);
    const slot = &self.registry.slots[index];
    assert(slot.state != .free);
    if (slot.state == .closed) return !require_progress;
    const different_source = !from.eql(slot.peer);
    const received_before = if (require_progress or different_source) slot.receivedPackets() else 0;
    const source = binding.SockAddr.fromAddress(from.*);
    const destination = binding.SockAddr.fromAddress(self.localFor(from.*).?);
    const received = if (slot.recv(datagram, &source, &destination)) |_| true else |_| false;
    if (different_source and slot.receivedPackets() != received_before) slot.receive_endpoint_known = false;
    if (require_progress and slot.receivedPackets() == received_before and !slot.isFinished()) return false;
    if (received) slot.answered = true;
    // Admission permits must be released before receiving the next Initial in this batch.
    if (slot.state == .handshaking) self.refresh(index);
    // Address fallback for the next datagram needs the latest validated path.
    self.observePath(index);
    if (slot.state == .handshaking or slot.state == .established) {
        self.markPending(index);
        self.markDirty(index);
    }
    return true;
}

fn observePath(self: *Engine, index: u16) void {
    assert(index < self.registry.slots.len);
    const slot = &self.registry.slots[index];
    if (slot.state == .closed or slot.conn == null) return;
    const peer = slot.drainPathEvents() orelse return;
    assert(slot.state != .free);
    if (peer.eql(slot.peer)) return;
    slot.receive_endpoint_known = false;
    slot.peer = peer;
    slot.peer_sockaddr = binding.SockAddr.fromAddress(peer);
    slot.path_changed_pending = peer;
    self.noteEvents(index);
}

fn leaveHandshaking(self: *Engine, slot: *const Connection) void {
    assert(slot.state == .handshaking);
    if (slot.direction == .inbound) {
        assert(self.registry.handshaking > 0);
        self.registry.handshaking -= 1;
    } else {
        assert(self.registry.dialing > 0);
        self.registry.dialing -= 1;
    }
}

fn refresh(self: *Engine, index: u16) void {
    const slot = &self.registry.slots[index];
    if (slot.state == .handshaking and slot.isEstablished()) {
        self.leaveHandshaking(slot);
        slot.state = .established;
        slot.flight_pending = slot.direction == .outbound;
        slot.learnPeerWindows();
        if (slot.handshake.peer_id) |id| {
            assert(slot.peer_id == null);
            slot.peer_id = id;
            if (slot.expected_peer_id != null and !slot.expected_peer_id.?.eql(&id)) {
                slot.deferClose(.peer_id_mismatch, types.app_error_peer_id_mismatch);
            } else {
                slot.connected_pending = true;
                self.connection_metrics.established[@intFromEnum(slot.direction)] +|= 1;
                std.log.scoped(.network_quic).debug("connection_established connection={d}:{d} direction={s} peer={f}", .{ index, slot.generation, @tagName(slot.direction), logging.peer(&id) });
            }
        } else {
            slot.close(.tls_failed, types.app_error_normal);
        }
        if (slot.state == .established and slot.closing != .after_flight) self.markPending(index);
    }
    if (slot.state != .closed and slot.isFinished()) {
        self.markClosed(index, slot.closeReason());
    }
    self.noteEvents(index);
}

fn markClosed(self: *Engine, index: u16, reason: CloseReason) void {
    const slot = &self.registry.slots[index];
    assert(slot.state == .handshaking or slot.state == .established);
    self.connection_metrics.closed[@intFromEnum(slot.direction)][@intFromEnum(reason)] +|= 1;
    const code: u64 = switch (reason) {
        .peer_closed => |closed| closed.code,
        .transport_error => |value| value,
        else => 0,
    };
    std.log.scoped(.network_quic).debug("connection_closed connection={d}:{d} direction={s} state={s} reason={s} code={d}", .{ index, slot.generation, @tagName(slot.direction), @tagName(slot.state), @tagName(reason), code });
    if (slot.state == .handshaking) {
        self.leaveHandshaking(slot);
    }
    if (slot.direction == .outbound) {
        assert(self.registry.outbound > 0);
        self.registry.outbound -= 1;
    }
    slot.markClosed(reason);
    self.registry.removeRoute(index);
    const slots = self.registry.slots;
    if (slot.pending_link.linked) self.registry.pending.remove(slots, "pending_link", index);
    if (slot.dirty_link.linked) self.registry.dirty.remove(slots, "dirty_link", index);
    self.registry.timers.clear(index);
    self.noteEvents(index);
    assert(self.registry.dialing <= self.registry.outbound);
}

fn slotForPeer(self: *const Engine, from: *const Address) ?u16 {
    assert(self.registry.active_len <= self.registry.active.len);
    var found: ?u16 = null;
    for (self.registry.activeIndices()) |index| {
        const slot = &self.registry.slots[index];
        assert(slot.state != .free);
        if (slot.state == .closed or !slot.peer.eql(from.*)) continue;
        if (found != null) return null;
        found = index;
    }
    return found;
}

fn handshakingFromSource(self: *const Engine, from: *const Address, prefix: bool) u16 {
    assert(self.registry.active_len <= self.registry.active.len);
    var count: u16 = 0;
    for (self.registry.activeIndices()) |index| {
        const slot = &self.registry.slots[index];
        if (slot.state != .handshaking or slot.direction != .inbound) continue;
        const same_source = switch (slot.peer) {
            .ip4 => |peer| switch (from.*) {
                .ip4 => |source| std.mem.eql(u8, peer.octets[0..if (prefix) @as(usize, 3) else 4], source.octets[0..if (prefix) @as(usize, 3) else 4]),
                .ip6 => false,
            },
            .ip6 => |peer| switch (from.*) {
                .ip4 => false,
                .ip6 => |source| std.mem.eql(u8, peer.octets[0..if (prefix) @as(usize, 7) else 8], source.octets[0..if (prefix) @as(usize, 7) else 8]),
            },
        };
        if (same_source) count += 1;
    }
    assert(count <= self.registry.handshaking);
    return count;
}

comptime {
    assert(bounds.streams_per_connection <= std.math.maxInt(u8) + 1);
}

test {
    _ = Registry;
    _ = Connection;
    _ = retry;
    _ = @import("engine_admission_test.zig");
    _ = @import("engine_close_test.zig");
    _ = @import("engine_handshake_test.zig");
    _ = @import("engine_notifications_test.zig");
    _ = @import("engine_path_test.zig");
    _ = @import("engine_readiness_test.zig");
    _ = @import("engine_stream_test.zig");
    _ = @import("engine_retry_test.zig");
    _ = @import("engine_timer_test.zig");
}
