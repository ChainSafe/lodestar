//! ReqResp host contract (all calls serialized by its owner):
//! - request borrows immutable request bytes and an exclusive response sink until terminal delivery.
//! - chunk borrows the sink until consume or terminal delivery; consume supplies current owner time.
//! - an inbound request borrows its receive bytes through served/failed delivery. respond borrows
//!   one immutable response through chunk_sent or terminal delivery; respondError copies its message.
//! - readiness grants no reservation. The binding reserves bytes before producing the next response;
//!   respond may still return Terminal while that terminal event awaits output capacity.
//! - pending chunk/chunk_sent notifications precede the terminal. Terminal delivery ends borrows;
//!   the slot is reusable as soon as its terminal is delivered. Explicit abandon ends outbound borrows
//!   immediately; the caller must first discard all delivered views for that request.
//! - retainServing/releaseServing cover asynchronous application execution independently of stream lifetime.
//! - every terminal transition detaches Router and transport ownership before returning.
//!   Undelivered events keep their payload borrows until delivery.
const time = @import("../time.zig");
const std = @import("std");
const codec = @import("codec.zig");
const constants = @import("constants.zig");
const request_policy = @import("request_policy.zig");
const admission_mod = @import("admission.zig");
const protocol_mod = @import("protocol.zig");
const config = @import("config");
const Engine = @import("../quic/Engine.zig");
const Client = @import("Client.zig");
const Server = @import("Server.zig");
const RequestState = @import("RequestState.zig");
const RequestIO = @import("RequestIO.zig");
const Router = @import("../router.zig").Router;
const types = @import("../types.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const ReceiveLayout = @import("ReceiveLayout.zig");
const ServingPool = @import("ServingPool.zig");
const index_list = @import("../index_list.zig");
const DeadlineHeap = @import("../deadline_heap.zig").DeadlineHeap;
const route_invariant = @import("route_invariant.zig");

const assert = std.debug.assert;
const Handle = Engine.Handle;
const StreamHandle = Engine.StreamHandle;
const Protocol = protocol_mod.Protocol;
const Now = types.Now;

const options_mod = @import("options.zig");
const InboundAdmission = @import("InboundAdmission.zig");
const ForkEntry = types.ForkEntry;

pub const Options = options_mod.Options;
pub const validateForkTable = options_mod.validateForkTable;
pub const outbound_stream_headroom = options_mod.outbound_stream_headroom;

const Settings = struct {
    routes: Options.Routes,
    report_non_completion: bool,
    connections: u16,
    outbound_per_connection_max: u8,
    inbound_per_connection_max: u8,
    progress_timeout_ms: u64,
    host_timeout_ms: u64,
    quota_timeout_ms: u64,
    work_per_pump_max: u16,
};

pub const RequestOptions = struct {
    expected_chunks: ?u32 = null,
    timeouts: Timeouts = .{},

    pub const Timeouts = struct {
        negotiation: std.Io.Duration = .fromMilliseconds(5_000),
        request: std.Io.Duration = .fromMilliseconds(5_000),
        /// Absolute response lifetime, including chunk credit and host holds.
        response: std.Io.Duration = .fromMilliseconds(60_000),
    };
};

const events_mod = @import("events.zig");
pub const PeerFault = events_mod.PeerFault;
pub const RequestPhase = events_mod.RequestPhase;
pub const RequestHandle = events_mod.RequestHandle;
pub const Failure = events_mod.Failure;
pub const Event = events_mod.Event;

pub const InitError = admission_mod.InitError || error{InvalidPolicy};

pub const RequestError = error{
    ProtocolDisabled,
    InvalidRequest,
    InvalidRequestOptions,
    InvalidCapacity,
    SlotsExhausted,
    TooManyRequests,
    SinkTooSmall,
    RequestTooLarge,
    RequestTooSmall,
    NegotiationTableFull,
    StaleHandle,
    StreamLimit,
    Transport,
};

pub const AcceptError = error{
    ProtocolConcurrency,
    InvalidCapacity,
    StaleHandle,
    InvalidHandoff,
    SlotsExhausted,
    ConnectionSlotsExhausted,
    UnknownProtocol,
    ProtocolDisabled,
};

pub const ResponseReadiness = enum { ready, backpressured, terminal, stale };

pub const RespondError = error{
    Terminal,
    InvalidError,
    InvalidContext,
    StaleHandle,
    Busy,
    UnknownFork,
    ChunkTooLarge,
    ChunkTooSmall,
    TooManyChunks,
};

pub const metrics = @import("metrics.zig");

pub const MemoryPlan = struct {
    facade_bytes: usize,
    slot_bytes: usize,
    io_bytes: usize,
    admission_bytes: usize = 0,
    request_sink_bytes: usize = 0,
    serving_bytes: usize = 0,
    scheduler_bytes: usize = 0,
    total_bytes: usize,
};

const ReqResp = @This();

allocator: std.mem.Allocator,
outbound_release_revision: u64 = 0,
options: Settings,
outbound: []Client,
inbound: []Server,
arena: []u8,
request_sinks: []u8,
receive_layout: ReceiveLayout,
serving: ?ServingPool,
/// Indexed by slot id: outbound slots are `[0, outbound.len)`, and inbound slot `i` is
/// `outbound.len + i`, which belongs to connection index `i / slots_per_connection`.
links: []SlotLinks,
/// Running slots whose next advance can progress without a new stream event.
ready: index_list.List = .{},
/// Slots with a pending notification or an undelivered terminal.
deliver: index_list.List = .{},
/// Running slots keyed on their deadline, or on their admission eligibility while waiting
/// for their start or tokens.
deadlines: DeadlineHeap,
/// Per connection index, its occupied outbound slots.
outbound_by_connection: []index_list.List,
/// Slots taken from a list or the heap by pump. An idle owner visits none.
visits: u64 = 0,
policy: request_policy.Policy,
admission: InboundAdmission,
request_fork: config.ForkSeq,
last_pump_ms: u64 = 0,
protocol_counters: [Protocol.count]metrics.ProtocolCounters = @splat(.{}),
outgoing_error_reasons: [metrics.error_reason_count]u64 = @splat(0),
forks: [64]ForkEntry = undefined,
fork_count: u8 = 0,

/// Occupied request slots and their undelivered events, inbound slots by phase, and serving
/// resources held or retiring.
pub const Resources = struct {
    outbound_occupied: usize = 0,
    inbound_phases: [metrics.inbound_phase_count]usize = @splat(0),
    pending_events: usize = 0,
    pending_terminals: usize = 0,
    serving_capacity: usize = 0,
    serving_occupied: usize = 0,
    retiring: usize = 0,
};

pub fn resourceSnapshot(self: *const ReqResp) Resources {
    var result: Resources = .{};
    if (self.serving) |*pool| {
        result.serving_capacity = pool.entries.len;
        for (pool.entries) |entry| {
            result.serving_occupied += @intFromBool(entry.request != null);
            result.retiring += @intFromBool(entry.retiring);
        }
    }
    for (self.outbound) |*slot| {
        if (slot.request.occupied()) result.outbound_occupied += 1;
        if (slot.request.pendingEvent() != null) result.pending_events += 1;
        if (slot.request.terminalEvent() != null) result.pending_terminals += 1;
    }
    for (self.inbound) |*slot| {
        if (slot.occupancy()) |phase| result.inbound_phases[@intFromEnum(phase)] += 1;
        if (slot.request.pendingEvent() != null) result.pending_events += 1;
        if (slot.request.terminalEvent() != null) result.pending_terminals += 1;
    }
    return result;
}

pub fn recordAdmissionRefusal(self: *ReqResp, stream: StreamHandle, which: Protocol, reason: metrics.AdmissionRefusal, cost: u128) void {
    const reason_index = @intFromEnum(reason);
    const counts = &self.protocol_counters[@intFromEnum(which)];
    counts.admission_refusals[reason_index] +|= 1;
    std.log.scoped(.network_reqresp_errors).debug("request_admission_refused connection={d}:{d} stream={d} method={s} reason={s} cost={d}", .{ stream.conn.index, stream.conn.generation, stream.id, @tagName(which), @tagName(reason), cost });
}

pub fn requestBounds(self: *const ReqResp, which: Protocol) protocol_mod.Info {
    return self.policy.requestBounds(which, self.request_fork);
}

pub fn responseBounds(self: *const ReqResp, which: Protocol, fork: config.ForkSeq) error{InvalidResponseContext}!codec.Bounds {
    var result = try which.responseBounds(fork);
    if (fork.gte(.gloas) and (which == .data_column_sidecars_by_range_v1 or which == .data_column_sidecars_by_root_v1))
        result.max = @intCast(@min(result.max, self.policy.config.gloas_column_max));
    result.protocol_max = result.max;
    result.max = @min(result.max, self.policy.config.max_payload_size);
    if (result.min > result.max) return error.InvalidResponseContext;
    return result;
}

pub fn inspectRequest(self: *const ReqResp, which: Protocol, bytes: []const u8, fork: config.ForkSeq) request_policy.InspectError!request_policy.Inspection {
    return self.policy.inspect(which, bytes, fork);
}

pub fn init(allocator: std.mem.Allocator, options: Options) InitError!ReqResp {
    try options.validate();
    const policy = try request_policy.Policy.init(&options.admission.policy);
    const receive = ReceiveLayout.init(&policy, options.protocols);
    var admission = try InboundAdmission.init(allocator, options.admission.limits, options.connections, options.protocols, receive.slots_per_connection, options.admission.scope);
    errdefer admission.deinit(allocator);

    const outbound = try allocator.alloc(Client, options.outbound_max);
    errdefer allocator.free(outbound);
    @memset(outbound, .{});
    const inbound = try allocator.alloc(Server, @as(usize, options.connections) * receive.slots_per_connection);
    errdefer allocator.free(inbound);
    @memset(inbound, .{});

    const request_sinks = try allocator.alloc(u8, @as(usize, options.connections) * receive.sink_bytes);
    errdefer allocator.free(request_sinks);

    const outbound_sizes = RequestIO.BufferSizes.init(options.protocols);
    const outbound_bytes = @as(usize, options.outbound_max) * outbound_sizes.bytes();
    const inbound_bytes = @as(usize, options.connections) * receive.io_bytes;
    const arena = try allocator.alloc(u8, outbound_bytes + inbound_bytes);
    errdefer allocator.free(arena);
    var cursor: usize = 0;
    for (outbound) |*slot| cursor = slot.request.io.assignBuffers(arena, cursor, outbound_sizes);
    for (inbound, 0..) |*slot, index| {
        const buffers = receive.buffers(index, request_sinks, arena[outbound_bytes..]);
        slot.receive = buffers;
        cursor += buffers.scratch.len + buffers.read.len;
    }
    assert(cursor == arena.len);

    var serving: ?ServingPool = if (options.protocols.bits & Protocol.Set.application.bits != 0)
        try ServingPool.init(allocator, options.serving_max, options.serving_per_source_max, outbound_sizes.scratch)
    else
        null;
    errdefer if (serving) |*pool| pool.deinit(allocator);
    const links = try allocator.alloc(SlotLinks, outbound.len + inbound.len);
    errdefer allocator.free(links);
    @memset(links, .{});
    var deadlines = try DeadlineHeap.init(allocator, @intCast(links.len));
    errdefer deadlines.deinit(allocator);
    const outbound_by_connection = try allocator.alloc(index_list.List, options.connections);
    errdefer allocator.free(outbound_by_connection);
    @memset(outbound_by_connection, .{});

    var result: ReqResp = .{
        .allocator = allocator,
        .options = .{
            .routes = options.routes,
            .report_non_completion = options.report_non_completion,
            .connections = options.connections,
            .outbound_per_connection_max = options.outbound_per_connection_max,
            .inbound_per_connection_max = options.inbound_per_connection_max,
            .progress_timeout_ms = options.progress_timeout_ms,
            .host_timeout_ms = options.host_timeout_ms,
            .quota_timeout_ms = options.quota_timeout_ms,
            .work_per_pump_max = options.work_per_pump_max,
        },
        .outbound = outbound,
        .inbound = inbound,
        .arena = arena,
        .request_sinks = request_sinks,
        .receive_layout = receive,
        .serving = serving,
        .links = links,
        .deadlines = deadlines,
        .outbound_by_connection = outbound_by_connection,
        .policy = policy,
        .admission = admission,
        .request_fork = options.request_fork,
        .fork_count = @intCast(options.forks.len),
    };
    @memcpy(result.forks[0..options.forks.len], options.forks);
    return result;
}

/// Call cancelAll first, or destroy the attached transport and Router before deinit.
pub fn deinit(self: *ReqResp) void {
    self.admission.deinit(self.allocator);
    if (self.serving) |*pool| pool.deinit(self.allocator);
    self.allocator.free(self.outbound_by_connection);
    self.deadlines.deinit(self.allocator);
    self.allocator.free(self.links);
    self.allocator.free(self.request_sinks);
    self.allocator.free(self.arena);
    self.allocator.free(self.inbound);
    self.allocator.free(self.outbound);
    self.* = undefined;
}

pub fn setRequestFork(self: *ReqResp, fork: config.ForkSeq) void {
    self.request_fork = fork;
}

pub fn pendingCounts(self: *const ReqResp) struct { outbound: u16, inbound: u16 } {
    var out: u16 = 0;
    for (self.outbound) |*slot| {
        if (slot.request.occupied()) out += 1;
    }
    var in: u16 = 0;
    for (self.inbound) |*slot| {
        if (slot.request.occupied()) in += 1;
    }
    assert(out <= self.outbound.len);
    assert(in <= self.inbound.len);
    return .{ .outbound = out, .inbound = in };
}

/// Request bytes stay immutable and the sink exclusive through terminal delivery.
/// Chunk slices remain stable until consume or terminal delivery.
pub fn request(
    self: *ReqResp,
    engine: *Engine,
    router: *Router,
    conn: Handle,
    which: Protocol,
    request_ssz: []const u8,
    sink: []u8,
    request_options: RequestOptions,
    now: Now,
) RequestError!RequestHandle {
    if (!self.receive_layout.protocols.contains(which)) return error.ProtocolDisabled;
    if (!router.capabilities().request.contains(.{ .reqresp = which })) return error.ProtocolDisabled;
    const bounds = self.requestBounds(which);
    const identity = engine.peerId(conn) orelse return error.StaleHandle;
    try self.validateTransportCapacity(engine);
    if (conn.index >= self.options.connections) return error.InvalidCapacity;
    inline for (.{ "negotiation", "request", "response" }) |field| {
        const duration = @field(request_options.timeouts, field);
        if (duration.nanoseconds <= 0 or duration.nanoseconds > std.Io.Duration.fromSeconds(60).nanoseconds) return error.InvalidRequestOptions;
    }
    if (request_ssz.len > bounds.request_max) return error.RequestTooLarge;
    if (request_ssz.len < bounds.request_min) return error.RequestTooSmall;
    const request_ceiling = (self.inspectRequest(which, request_ssz, self.request_fork) catch return error.InvalidRequest).chunks_max;
    const chunks_max = request_options.expected_chunks orelse request_ceiling;
    if (chunks_max > request_ceiling) return error.InvalidRequestOptions;
    if (sink.len < bounds.response_max) return error.SinkTooSmall;
    if (self.outboundProtocolPendingCount(conn, which) >= constants.MAX_CONCURRENT_REQUESTS) {
        return error.TooManyRequests;
    }
    if (self.options.outbound_per_connection_max > 0 and
        self.outboundOccupiedCount(conn) >= self.options.outbound_per_connection_max)
        return error.TooManyRequests;
    const index = self.availableOutbound() orelse return error.SlotsExhausted;
    const slot = &self.outbound[index];
    assert(!slot.conn_link.linked);
    const stream = router.beginReqRespTimed(engine, conn, which, now, request_options.timeouts.negotiation) catch |err| {
        return switch (err) {
            error.NegotiationTableFull => error.NegotiationTableFull,
            error.ProtocolDisabled => error.ProtocolDisabled,
            error.StaleHandle => error.StaleHandle,
            error.StreamLimit => error.StreamLimit,
            else => error.Transport,
        };
    };
    slot.start(&.{
        .identity = identity,
        .stream = stream,
        .protocol = which,
        .request_ssz = request_ssz,
        .sink = sink,
        .timeouts = request_options.timeouts,
        .protocol_chunks_max = request_ceiling,
        .chunks_max = chunks_max,
    }, now);
    self.outbound_by_connection[conn.index].append(self.outbound, "conn_link", index);
    self.protocol_counters[@intFromEnum(which)].outgoing +|= 1;
    std.log.scoped(.network_reqresp).debug("request_started direction=outbound request={d}:{d} connection={d}:{d} stream={d} method={s} bytes={d} max_chunks={d}", .{ index, slot.request.generation, conn.index, conn.generation, stream.id, @tagName(which), request_ssz.len, chunks_max });
    self.settle(index);
    return slot.request.handle(index);
}

pub fn negotiationResult(self: *ReqResp, router: *Router, engine: *Engine, outcome: Router.Outcome, now: Now) void {
    if (outcome.direction == .outbound) {
        if (!self.negotiated(engine, router, outcome, now)) engine.closeStream(outcome.stream, 0);
        return;
    }
    switch (outcome.result) {
        .ready => |selection| _ = self.accept(engine, outcome.stream, selection, now) catch |err| {
            const refusal: ?[]const u8 = switch (err) {
                error.ProtocolConcurrency => std.fmt.comptimePrint("Rate limited: already {d} active requests for this protocol", .{constants.MAX_CONCURRENT_REQUESTS}),
                error.ConnectionSlotsExhausted, error.SlotsExhausted => "Rate limited: connection receive capacity exhausted",
                else => null,
            };
            if (refusal) |message| {
                var wire: [codec.encodedLengthMax(codec.error_message_max)]u8 = undefined;
                const response = codec.encodeChunk(constants.result_rate_limited, null, message, &wire) catch unreachable;
                if (router.finishSelected(engine, outcome.stream, response, now)) return;
            }
            engine.closeStream(outcome.stream, 0);
        },
        else => {},
    }
}

/// Hands a negotiated stream to the outbound slot waiting for it. Returns false when none is.
pub fn negotiated(self: *ReqResp, engine: *Engine, router: *Router, outcome: Router.Outcome, now: Now) bool {
    for (self.outbound, 0..) |*slot, position| {
        if (!slot.request.running() or slot.phase != .negotiation) continue;
        if (!std.meta.eql(slot.request.stream, outcome.stream)) continue;
        const index: u16 = @intCast(position);
        slot.negotiated(self, engine, router, index, outcome, now);
        if (slot.request.running()) self.markReady(.outbound, index);
        self.settle(index);
        return true;
    }
    return false;
}

/// Borrows request bytes from the owned inbound slot through served/failed delivery.
pub fn accept(
    self: *ReqResp,
    engine: *Engine,
    stream: StreamHandle,
    ready: Router.Selection,
    now: Now,
) AcceptError!RequestHandle {
    const accepted = try self.admission.accept(self, engine, stream, ready, now);
    const index = accepted.index;
    const which = accepted.protocol;
    const slot = &self.inbound[index];
    slot.acceptPrepared(stream, ready, &accepted, self.request_fork, now);
    self.protocol_counters[@intFromEnum(which)].incoming +|= 1;
    std.log.scoped(.network_reqresp).debug("request_started direction=inbound request={d}:{d} connection={d}:{d} stream={d} method={s}", .{ index, slot.request.generation, stream.conn.index, stream.conn.generation, stream.id, @tagName(which) });
    if (slot.admission.start_pending) std.log.scoped(.network_reqresp_errors).debug("request_start_wait request={d}:{d} connection={d}:{d} stream={d} method={s} due_in_ms={d}", .{ index, slot.request.generation, stream.conn.index, stream.conn.generation, stream.id, @tagName(which), slot.admission.eligible_ms - now.millis() });
    // A stream that is already gone fails on the slot's first read.
    engine.bindStream(stream, .{ .owner = self.options.routes.inbound, .row = index }) catch {};
    self.markReady(.inbound, index);
    self.settle(self.inboundId(index));
    return slot.request.handle(index);
}

/// Copies responses up to codec.error_message_max bytes. Larger responses stay immutable
/// through chunk_sent or terminal delivery.
pub fn respond(
    self: *ReqResp,
    handle: RequestHandle,
    ssz: []const u8,
    context: ?ForkEntry,
    now: Now,
) RespondError!void {
    const slot = try self.servingSlot(handle);
    const request_state = &slot.request;
    const bounds = self.requestBounds(request_state.protocol);
    if (request_state.chunks >= request_state.chunks_max) return error.TooManyChunks;
    var response = codec.Bounds{ .min = bounds.response_min, .max = bounds.response_max };
    var digest: ?[constants.context_bytes_length]u8 = null;
    if (bounds.context_bytes) {
        const selected = context orelse return error.UnknownFork;
        const known = self.forkFor(selected.digest) orelse return error.UnknownFork;
        if (known != selected.fork) return error.UnknownFork;
        response = self.responseBounds(request_state.protocol, known) catch return error.InvalidContext;
        digest = selected.digest;
    }
    if (!bounds.context_bytes and context != null) return error.InvalidContext;
    if (ssz.len > response.max) return error.ChunkTooLarge;
    if (ssz.len < response.min) return error.ChunkTooSmall;
    slot.respond(ssz, digest, now);
    self.markReady(.inbound, handle.index);
    self.settle(self.inboundId(handle.index));
}

/// Copies the message; the caller may release it immediately.
pub fn respondError(
    self: *ReqResp,
    handle: RequestHandle,
    code: u8,
    message: []const u8,
    now: Now,
) RespondError!void {
    if (!constants.isErrorResult(code) or message.len > codec.error_message_max) return error.InvalidError;
    const slot = try self.servingSlot(handle);
    slot.respondError(code, message, now);
    self.markReady(.inbound, handle.index);
    self.settle(self.inboundId(handle.index));
}

/// Queues FIN, or asks the current chunk writer to finish after its bytes. A pending
/// chunk_sent is delivered first. False includes an already finishing, terminal or stale slot.
pub fn finish(self: *ReqResp, handle: RequestHandle, now: Now) bool {
    if (handle.direction != .inbound) return false;
    const slot = self.inboundSlot(handle) orelse return false;
    const was_serving = slot.state == .serving;
    if (!slot.finish(now)) return false;
    if (was_serving) self.markReady(.inbound, handle.index);
    self.settle(self.inboundId(handle.index));
    return true;
}

pub const ServingHandle = ServingPool.Handle;

/// Holds application execution capacity independently of the request. Control requests have no
/// serving lease. Does not extend payload borrows.
/// Release the returned handle when host execution ends, even if the request already ended.
pub fn retainServing(self: *ReqResp, handle: RequestHandle) ?ServingHandle {
    const pool = if (self.serving) |*pool| pool else return null;
    return pool.retain(handle);
}

/// A release may free serving capacity for a `.ready` slot.
pub fn releaseServing(self: *ReqResp, handle: ServingHandle) bool {
    const pool = if (self.serving) |*pool| pool else return false;
    if (!pool.release(handle)) return false;
    self.admission.capacityReleased();
    return true;
}

/// A snapshot only: the host reserves its own bytes and respond rechecks this state.
/// Terminal means the slot still owes its terminal event; stale includes already delivered terminals.
pub fn responseReadiness(self: *ReqResp, handle: RequestHandle) ResponseReadiness {
    if (handle.direction != .inbound) return .stale;
    const slot = self.inboundSlot(handle) orelse return .stale;
    return slot.responseReadiness();
}

/// Supply fresh owner time so host-held chunks cannot become remote timeout evidence.
pub fn consume(self: *ReqResp, engine: *Engine, router: *Router, handle: RequestHandle, now: Now) bool {
    if (handle.direction != .outbound) return false;
    const slot = self.outboundSlot(handle) orelse return false;
    if (!slot.consume(self, engine, router, handle.index, now)) return false;
    if (slot.request.running()) self.markReady(.outbound, handle.index);
    self.settle(handle.index);
    return true;
}

/// Recovers one complete Goodbye before the caller cancels the connection's requests.
pub fn closingGoodbye(self: *ReqResp, engine: *Engine, router: *Router, conn: Handle, now: Now) ?u64 {
    if (conn.index >= self.options.connections or !self.receive_layout.protocols.contains(.goodbye_v1)) return null;
    const first = self.receive_layout.first(conn.index, .goodbye_v1);
    for (first..first + constants.MAX_CONCURRENT_REQUESTS) |position| {
        const index: u16 = @intCast(position);
        const slot = &self.inbound[index];
        if (!slot.request.running() or !std.meta.eql(slot.request.conn, conn)) continue;
        defer self.settle(self.inboundId(index));
        if (slot.closingGoodbye(self, engine, router, index, now)) |code| return code;
    }
    return null;
}

/// Retains the configured peer or source-address account until connectionClosed, including path changes.
pub fn connectionOpened(self: *ReqResp, conn: Handle, identity: *const PeerId, endpoint: *const @import("udp").Address, now: Now) void {
    assert(conn.index < self.options.connections);
    self.admission.connected(conn, identity, endpoint, now.millis());
}

/// Fails the connection's slots and releases its source reservation, retaining quota usage.
pub fn connectionClosed(self: *ReqResp, engine: *Engine, router: *Router, conn: Handle, now: Now) void {
    if (conn.index >= self.options.connections) return;
    defer self.admission.disconnected(conn);
    const list = &self.outbound_by_connection[conn.index];
    var cursor = list.head;
    for (0..self.outbound.len) |_| {
        if (cursor == index_list.none) break;
        const index: u16 = @intCast(cursor);
        cursor = self.outbound[index].conn_link.next;
        const slot = &self.outbound[index];
        if (!slot.request.occupied() or !std.meta.eql(slot.request.conn, conn)) continue;
        slot.fail(self, engine, router, index, .connection_closed, now);
    }
    const first = @as(usize, conn.index) * self.receive_layout.slots_per_connection;
    for (first..first + self.receive_layout.slots_per_connection) |position| {
        const index: u16 = @intCast(position);
        const slot = &self.inbound[index];
        if (!slot.request.occupied() or !std.meta.eql(slot.request.conn, conn)) continue;
        slot.fail(self, engine, router, index, .connection_closed, now);
    }
}

/// A routed stream event. An event for a stream the slot no longer holds is dropped.
pub fn streamReady(self: *ReqResp, route: types.Route, stream: StreamHandle) void {
    const id = self.routedSlot(route, stream) orelse return;
    self.markId(id);
}

fn routedSlot(self: *const ReqResp, route: types.Route, stream: StreamHandle) ?u32 {
    const id: u32 = if (route.owner == self.options.routes.outbound)
        (if (route.row < self.outbound.len) route.row else return null)
    else if (route.owner == self.options.routes.inbound)
        (if (route.row < self.inbound.len) self.inboundId(@intCast(route.row)) else return null)
    else
        return null;
    const record = self.recordOf(id);
    if (!record.running() or !std.meta.eql(record.stream, stream)) return null;
    return id;
}

/// Includes reqresp-owned storage. Caller response sinks and Router storage are separate.
pub fn memoryPlan(self: *const ReqResp) MemoryPlan {
    const slot_bytes = self.outbound.len * @sizeOf(Client) + self.inbound.len * @sizeOf(Server);
    const admission_bytes = self.admission.limiter.memoryPlan().allocated_bytes;
    const serving_bytes = if (self.serving) |*pool| pool.memoryBytes() else 0;
    return .{
        .facade_bytes = @sizeOf(ReqResp),
        .slot_bytes = slot_bytes,
        .io_bytes = self.arena.len,
        .admission_bytes = admission_bytes,
        .request_sink_bytes = self.request_sinks.len,
        .serving_bytes = serving_bytes,
        .scheduler_bytes = self.schedulerBytes(),
        .total_bytes = @sizeOf(ReqResp) + slot_bytes + self.arena.len + admission_bytes + self.request_sinks.len + serving_bytes + self.schedulerBytes(),
    };
}

fn schedulerBytes(self: *const ReqResp) usize {
    return self.admission.schedulerBytes() + self.links.len * @sizeOf(SlotLinks) +
        self.deadlines.entries.len * (@sizeOf(DeadlineHeap.Entry) + @sizeOf(u32)) + self.outbound_by_connection.len * @sizeOf(index_list.List);
}

/// Zero capacity suppresses event-only work. Reads list lengths and the heap top only.
/// Router negotiation and transport deadlines remain separate.
pub fn schedule(self: *const ReqResp, event_capacity: usize) types.Schedule {
    return .{
        .runnable = self.ready.len > 0 or
            (event_capacity > 0 and self.deliver.len > 0) or self.admission.due(),
        .deadline = time.optionalMilliseconds(if (self.deadlines.peek()) |top| top.deadline else null),
    };
}

/// Checks that the receive layout covers every possible transport connection.
pub fn validateTransportCapacity(self: *const ReqResp, engine: *const Engine) error{InvalidCapacity}!void {
    if (engine.limits.connections_max > self.options.connections) return error.InvalidCapacity;
}

fn inboundId(self: *const ReqResp, index: u16) u32 {
    assert(index < self.inbound.len);
    return @intCast(self.outbound.len + index);
}

pub fn markReady(self: *ReqResp, direction: types.Direction, index: u16) void {
    self.markId(switch (direction) {
        .outbound => index,
        .inbound => self.inboundId(index),
    });
}

fn markId(self: *ReqResp, id: u32) void {
    assert(self.recordOf(id).running());
    _ = self.ready.insert(self.links, "ready", id);
}

fn recordOf(self: *const ReqResp, id: u32) *RequestState {
    if (id < self.outbound.len) return &self.outbound[id].request;
    return &self.inbound[id - self.outbound.len].request;
}

fn deadlineOf(self: *const ReqResp, id: u32) ?u64 {
    if (id < self.outbound.len) return self.outbound[id].deadline();
    const slot = &self.inbound[id - self.outbound.len];
    const due = slot.deadline(self) orelse return null;
    if (slot.state == .ready) return slot.admission.deadline(due);
    return due;
}

/// Brings the slot's scheduling in line with its state after a change made by its own module.
pub fn settleSlot(self: *ReqResp, direction: types.Direction, index: u16) void {
    self.settle(switch (direction) {
        .outbound => index,
        .inbound => self.inboundId(index),
    });
}

/// Brings the slot's delivery and admission memberships and its heap key in line
/// with its state. Every change to a slot outside `advance` ends here.
fn settle(self: *ReqResp, id: u32) void {
    const links = &self.links[id];
    const record = self.recordOf(id);
    const wanted = record.deliverable();
    if (wanted and !links.event.linked) self.deliver.append(self.links, "event", id);
    if (!wanted and links.event.linked) self.deliver.remove(self.links, "event", id);
    if (!record.running() and links.ready.linked) self.ready.remove(self.links, "ready", id);
    if (self.deadlineOf(id)) |key| self.deadlines.set(id, key) else self.deadlines.clear(id);
    if (id >= self.outbound.len) self.admission.settle(self.inbound, @intCast(id - self.outbound.len));
}

fn availableOutbound(self: *ReqResp) ?u16 {
    for (self.outbound, 0..) |*slot, index| {
        if (slot.request.available()) return @intCast(index);
    }
    return null;
}

pub const CompletionInfo = struct {
    phase_name: []const u8,
    rejection: ?Server.Rejection = null,
    result_code: u8 = constants.result_success,
};

pub fn complete(owner: *ReqResp, engine: *Engine, router: *Router, record: *RequestState, index: u16, event: Event, info: CompletionInfo, now: Now) void {
    var terminal = event;
    const fault: ?PeerFault = if (record.peer_fault) |kind| .{
        .identity = switch (record.direction) {
            .outbound => owner.outbound[index].identity,
            .inbound => owner.inbound[index].identity,
        },
        .origin = .{ .connection = record.conn, .endpoint = engine.receiveEndpoint(record.conn) },
        .kind = kind,
    } else null;
    switch (terminal) {
        .failed => |*failed| {
            failed.origin = .{ .connection = record.conn, .endpoint = engine.receiveEndpoint(record.conn) };
            failed.peer_fault = fault;
            if (failed.reason == .peer_error) {
                const len = failed.reason.peer_error.message_len;
                assert(len == record.error_len);
                @memcpy(failed.message[0..len], record.inline_bytes[0..len]);
            }
        },
        .served => |*served| served.peer_fault = fault,
        .done => {},
        else => unreachable,
    }
    if (!record.terminate(engine, router, terminal)) return;
    owner.settleSlot(record.direction, index);
    const counts = &owner.protocol_counters[@intFromEnum(record.protocol)];
    if (record.direction == .outbound and owner.outbound[index].phase != .negotiation) counts.outgoing_closed +|= 1;
    assert(now.millis() >= record.started_ms);
    const duration_ms = now.millis() - record.started_ms;
    if (event == .served and info.result_code != constants.result_success) {
        counts.incoming_errors +|= 1;
        std.log.scoped(.network_reqresp_errors).debug("request_error_response request={d}:{d} connection={d}:{d} method={s} code={d} detail={s} chunks={d} elapsed_ms={d}", .{ index, record.generation, record.conn.index, record.conn.generation, @tagName(record.protocol), info.result_code, if (info.rejection) |err| @errorName(err) else "", record.chunks, duration_ms });
    } else if (event != .failed) std.log.scoped(.network_reqresp).debug("request_completed direction={s} request={d}:{d} connection={d}:{d} method={s} chunks={d} elapsed_ms={d}", .{ @tagName(record.direction), index, record.generation, record.conn.index, record.conn.generation, @tagName(record.protocol), record.chunks, duration_ms });
    if (record.direction == .outbound) counts.outgoing_time.observe(duration_ms) else counts.incoming_time.observe(duration_ms);
    if (event == .failed) owner.recordFailure(record, index, event, info, duration_ms);
}

fn recordFailure(owner: *ReqResp, record: *const RequestState, index: u16, event: Event, info: CompletionInfo, duration_ms: u64) void {
    const reason = event.failed.reason;
    const counts = &owner.protocol_counters[@intFromEnum(record.protocol)];
    const request_detail = info.rejection;
    if (reason == .cancelled) {
        std.log.scoped(.network_reqresp).debug("request_cancelled direction={s} request={d}:{d} connection={d}:{d} method={s} request_detail={s} chunks={d} elapsed_ms={d}", .{ @tagName(record.direction), index, record.generation, record.conn.index, record.conn.generation, @tagName(record.protocol), if (request_detail) |err| @errorName(err) else "", record.chunks, duration_ms });
    } else {
        const detail: []const u8 = switch (reason) {
            .invalid_response => |err| @errorName(err),
            .negotiation_failed => |failure| @tagName(failure),
            else => record.failure_detail,
        };
        const peer_code: u16 = if (reason == .peer_error) reason.peer_error.code else 0;
        std.log.scoped(.network_reqresp_errors).debug("request_failed direction={s} request={d}:{d} connection={d}:{d} method={s} phase={s} reason={s} detail={s} request_detail={s} peer_code={d} chunks={d} elapsed_ms={d}", .{ @tagName(record.direction), index, record.generation, record.conn.index, record.conn.generation, @tagName(record.protocol), info.phase_name, @tagName(reason), detail, if (request_detail) |err| @errorName(err) else "", peer_code, record.chunks, duration_ms });
        if (record.direction == .outbound) {
            counts.outgoing_errors +|= 1;
            owner.outgoing_error_reasons[@intFromEnum(metrics.ErrorReason.fromFailure(reason, event.failed.phase.?))] +|= 1;
        } else counts.incoming_errors +|= 1;
    }
}

/// Detaches I/O and queues one terminal result, preserving pending chunk notifications.
pub fn cancel(self: *ReqResp, engine: *Engine, router: *Router, handle: RequestHandle, now: Now) bool {
    if (handle.direction == .outbound) {
        const slot = self.outboundSlot(handle) orelse return false;
        if (slot.request.terminalEvent() != null) return false;
        slot.fail(self, engine, router, handle.index, .cancelled, now);
    } else {
        const slot = self.inboundSlot(handle) orelse return false;
        if (slot.request.terminalEvent() != null) return false;
        slot.fail(self, engine, router, handle.index, .cancelled, now);
    }
    return true;
}

/// Detaches an outbound request, discards pending delivery and ends all payload borrows.
/// The caller relinquishes delivered views and must account for the returned, owned peer fault.
/// Stale handles do nothing.
pub fn abandon(self: *ReqResp, engine: *Engine, router: *Router, handle: RequestHandle, now: Now) ?PeerFault {
    assert(handle.direction == .outbound);
    const record = &(self.outboundSlot(handle) orelse return null).request;
    _ = self.cancel(engine, router, handle, now);
    const terminal = record.terminalEvent().?;
    const fault = if (terminal.peerFault()) |value| value.* else null;
    record.notification = .none;
    _ = record.deliver().?;
    self.retire(handle.index);
    self.settle(handle.index);
    return fault;
}

/// Cancels current operations. Admission stays enabled; pump delivers notifications and terminals.
pub fn cancelAll(self: *ReqResp, engine: *Engine, router: *Router, now: Now) void {
    for (self.outbound, 0..) |*slot, index| if (slot.request.occupied()) {
        _ = self.cancel(engine, router, slot.request.handle(@intCast(index)), now);
    };
    for (self.inbound, 0..) |*slot, index| if (slot.request.occupied()) {
        _ = self.cancel(engine, router, slot.request.handle(@intCast(index)), now);
    };
}

pub fn pump(self: *ReqResp, engine: *Engine, router: *Router, now: Now, events: []Event) usize {
    const exhausted = self.advance(engine, router, now);
    const count = self.drain(now, events);
    if (@import("builtin").is_test or @import("builtin").fuzz) self.checkInvariants(engine, now, exhausted);
    return count;
}

/// Services the due keys and the ready slots up to
/// `work_per_pump_max`, then admits `.ready` slots. Returns whether the budget ran out.
/// A due key goes first, so runnable slots cannot hold a deadline past its time; servicing
/// one retires its slot or moves its key into the future. A slot re-marked while serviced
/// waits for the next pump, behind the slots marked before it.
fn advance(self: *ReqResp, engine: *Engine, router: *Router, now: Now) bool {
    assert(now.millis() >= self.last_pump_ms or self.last_pump_ms == 0);
    self.last_pump_ms = now.millis();
    // The slots marked before this pump that are still on `ready`.
    var marked = self.ready.len;
    const keyed: usize = self.deadlines.len;
    var serviced: usize = 0;
    // A due key comes back at most once more, when its start or token wait ended before its
    // deadline.
    for (0..marked + 2 * keyed + 1) |_| {
        if (serviced == self.options.work_per_pump_max) break;
        const due = self.deadlines.popDue(now.millis());
        const id: u32 = due orelse ready: {
            if (marked == 0) break;
            marked -= 1;
            break :ready self.ready.pop(self.links, "ready").?;
        };
        self.visits +|= 1;
        if (due != null and id >= self.outbound.len) {
            const slot = &self.inbound[id - self.outbound.len];
            if (slot.request.running() and slot.state == .ready and now.millis() < slot.deadline(self).?) {
                // Only its start or token wait ended.
                self.admission.waitEnded(slot);
                self.settle(id);
                continue;
            }
        }
        if (self.links[id].ready.linked) {
            // A serviced slot's key lies in the future, so a due slot was not serviced
            // earlier in this pump and is on `ready` from a mark made before it.
            assert(marked > 0);
            marked -= 1;
            self.ready.remove(self.links, "ready", id);
        }
        if (id < self.outbound.len) {
            self.outbound[id].advance(self, engine, router, @intCast(id), now);
        } else self.inbound[id - self.outbound.len].advance(self, engine, router, @intCast(id - self.outbound.len), now);
        serviced += 1;
        self.settle(id);
    }
    const exhausted = serviced == self.options.work_per_pump_max;
    self.admission.promoteReady(self, now);
    return exhausted;
}

/// Delivers at most one event per queued slot, in queue order.
fn drain(self: *ReqResp, now: Now, events: []Event) usize {
    const list = &self.deliver;
    const queued = list.len;
    var count: usize = 0;
    for (0..queued) |_| {
        if (count == events.len) break;
        const id = list.pop(self.links, "event").?;
        self.visits +|= 1;
        if (id < self.outbound.len) {
            events[count] = self.outbound[id].request.deliver().?;
        } else {
            const slot = &self.inbound[id - self.outbound.len];
            events[count] = slot.deliver(now).?;
            if (slot.request.running() and slot.state == .finishing) self.markId(id);
        }
        if (!self.recordOf(id).occupied()) self.retire(id);
        count += 1;
        self.settle(id);
    }
    return count;
}

fn retire(self: *ReqResp, id: u32) void {
    assert(!self.recordOf(id).occupied());
    if (id < self.outbound.len) {
        const slot = &self.outbound[id];
        self.outbound_by_connection[slot.request.conn.index].remove(self.outbound, "conn_link", id);
        self.outbound_release_revision += 1;
    } else {
        const slot = &self.inbound[id - self.outbound.len];
        if (slot.execution) |index| {
            self.serving.?.retire(index);
            self.admission.capacityReleased();
        }
        slot.execution = null;
    }
}

/// Test builds check, after every pump, that the lists, the heap and the admission masks
/// match the slot states, that no slot with stream work is off `ready`, that a pump with
/// budget to spare left no due key, and that each live stream a slot holds routes to it and
/// back.
pub fn checkInvariants(self: *const ReqResp, engine: *const Engine, now: Now, exhausted: bool) void {
    var lengths: struct { ready: usize = 0, events: usize = 0 } = .{};
    for (self.links, 0..) |*links, position| {
        const id: u32 = @intCast(position);
        const record = self.recordOf(id);
        lengths.ready += @intFromBool(links.ready.linked);
        lengths.events += @intFromBool(links.event.linked);
        if (record.completion == .terminal) assert(record.stream_owner == .closed);
        assert(links.event.linked == record.deliverable());
        assert(!links.ready.linked or record.running());
        if (!record.running()) {
            assert(self.deadlines.get(id) == null);
        } else if (!links.ready.linked) assert(self.deadlines.get(id).? == self.deadlineOf(id).?);
        const direction: types.Direction = if (id < self.outbound.len) .outbound else .inbound;
        const index: u16 = @intCast(if (direction == .outbound) id else id - self.outbound.len);
        // Admission, which runs after servicing, alone keys a slot due now: a token wait
        // that ends within this millisecond.
        if (!exhausted) if (self.deadlines.get(id)) |key| if (key <= now.millis()) {
            assert(direction == .inbound);
            const slot = &self.inbound[index];
            assert(slot.state == .ready and slot.admission.wait == .tokens and slot.admission.eligible_ms == now.millis());
        };
        if (direction == .inbound) self.admission.checkSlot(&self.inbound[index], index);
        if (!record.occupied() or record.stream_owner != .protocol) continue;
        const bound = engine.route(record.stream) orelse continue;
        assert(bound.owner == self.options.routes.owner(direction) and bound.row == index);
        if (!record.running() or links.ready.linked) continue;
        const waits = engine.streamWaits(record.stream) orelse continue;
        switch (direction) {
            .outbound => {
                const slot = &self.outbound[index];
                if (record.waitingHost()) continue;
                switch (slot.phase) {
                    .negotiation => {},
                    .request => if (record.io.writing or !record.io.outbox.idle()) assert(waits.write_waiting),
                    .response => assertDrained(record, waits),
                }
            },
            .inbound => {
                const slot = &self.inbound[index];
                if (record.waitingHost() or slot.state == .serving) continue;
                switch (slot.state) {
                    .ready, .serving => {},
                    .receiving_request => assertDrained(record, waits),
                    .writing_chunk, .finishing => assert(waits.write_waiting),
                }
            },
        }
    }
    assert(lengths.ready == self.ready.len);
    assert(lengths.events == self.deliver.len);
    route_invariant.check(engine, self.options.routes, self.outbound, self.inbound) catch unreachable;
}

/// A reading slot off `ready` has consumed its buffered input and read its last delivered
/// readable edge to Done.
fn assertDrained(record: *const RequestState, waits: Engine.StreamWaits) void {
    assert(record.io.buffered_start == record.io.buffered_end and !record.io.fin_seen);
    assert(!waits.read_open);
}

fn servingSlot(self: *ReqResp, handle: RequestHandle) RespondError!*Server {
    if (handle.direction != .inbound) return error.StaleHandle;
    const slot = self.inboundSlot(handle) orelse return error.StaleHandle;
    return switch (slot.responseReadiness()) {
        .ready => slot,
        .backpressured => error.Busy,
        .terminal => error.Terminal,
        .stale => unreachable,
    };
}

fn outboundSlot(self: *ReqResp, handle: RequestHandle) ?*Client {
    const slots = self.outbound;
    if (handle.index >= slots.len) return null;
    const slot = &slots[handle.index];
    if (slot.request.generation != handle.generation or !slot.request.occupied()) return null;
    return slot;
}
fn inboundSlot(self: *ReqResp, handle: RequestHandle) ?*Server {
    const slots = self.inbound;
    if (handle.index >= slots.len) return null;
    const slot = &slots[handle.index];
    if (slot.request.generation != handle.generation or !slot.request.occupied()) return null;
    return slot;
}

pub fn outboundProtocolPendingCount(self: *const ReqResp, conn: Handle, which: Protocol) u8 {
    var count: u8 = 0;
    var cursor = if (conn.index < self.options.connections) self.outbound_by_connection[conn.index].head else index_list.none;
    for (0..self.outbound.len) |_| {
        if (cursor == index_list.none) break;
        const slot = &self.outbound[cursor];
        cursor = slot.conn_link.next;
        if (!slot.request.occupied() or slot.request.protocol != which) continue;
        if (!std.meta.eql(slot.request.conn, conn)) continue;
        count +|= 1;
    }
    return count;
}

pub fn outboundOccupiedCount(self: *const ReqResp, conn: Handle) u16 {
    var count: u16 = 0;
    var cursor = if (conn.index < self.options.connections) self.outbound_by_connection[conn.index].head else index_list.none;
    for (0..self.outbound.len) |_| {
        if (cursor == index_list.none) break;
        const slot = &self.outbound[cursor];
        cursor = slot.conn_link.next;
        if (!slot.request.occupied()) continue;
        if (std.meta.eql(slot.request.conn, conn)) count += 1;
    }
    return count;
}

/// The connection's block of the receive layout.
fn inboundOf(self: *const ReqResp, conn: Handle) []const Server {
    if (conn.index >= self.options.connections) return &.{};
    return self.inbound[@as(usize, conn.index) * self.receive_layout.slots_per_connection ..][0..self.receive_layout.slots_per_connection];
}

pub fn inboundProtocolRunningCount(self: *const ReqResp, conn: Handle, which: Protocol) u8 {
    var count: u8 = 0;
    for (self.inboundOf(conn)) |*slot| {
        if (!slot.request.running() or slot.request.protocol != which) continue;
        if (std.meta.eql(slot.request.conn, conn)) count +|= 1;
    }
    return count;
}

pub fn inboundPendingCount(self: *const ReqResp, conn: Handle) u8 {
    var count: u8 = 0;
    for (self.inboundOf(conn)) |*slot| {
        if (!slot.request.occupied()) continue;
        if (std.meta.eql(slot.request.conn, conn)) count +|= 1;
    }
    return count;
}

pub fn forkFor(
    self: *const ReqResp,
    digest: [constants.context_bytes_length]u8,
) ?config.ForkSeq {
    for (self.forks[0..self.fork_count]) |entry| {
        if (std.mem.eql(u8, &entry.digest, &digest)) return entry.fork;
    }
    return null;
}

const SlotLinks = struct {
    ready: index_list.Link = .{},
    event: index_list.Link = .{},
};

comptime {
    assert(@sizeOf(Client) <= 2 * 1024);
    assert(@sizeOf(Server) <= 2 * 1024);
}

test {
    _ = @import("req_resp_admission_lifecycle_test.zig");
    _ = @import("req_resp_active_protocols_test.zig");
    _ = @import("req_resp_attribution_test.zig");
    _ = @import("req_resp_control_capacity_test.zig");
    _ = @import("req_resp_control_partition_test.zig");
    _ = @import("req_resp_failures_test.zig");
    _ = @import("req_resp_metrics_test.zig");
    _ = @import("req_resp_deadlines_test.zig");
    _ = @import("req_resp_validation_test.zig");
    _ = @import("req_resp_flow_control_test.zig");
    _ = @import("req_resp_scheduling_test.zig");
    _ = @import("req_resp_half_close_test.zig");
    _ = @import("req_resp_request_start_test.zig");
    _ = @import("req_resp_terminal_test.zig");
    _ = @import("req_resp_host_contract_test.zig");
    _ = @import("req_resp_test.zig");
}
