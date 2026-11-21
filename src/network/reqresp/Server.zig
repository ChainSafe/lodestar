const RequestIO = @import("RequestIO.zig");
const std = @import("std");
const codec = @import("codec.zig");
const constants = @import("constants.zig");
const ReqResp = @import("ReqResp.zig");
const Engine = @import("../quic/Engine.zig");
const types = @import("../types.zig");
const assert = std.debug.assert;
const StreamHandle = Engine.StreamHandle;
const protocol = @import("protocol.zig");
const Now = types.Now;
const Router = @import("../router.zig").Router;
const request_policy = @import("request_policy.zig");
const RequestState = @import("RequestState.zig");
const ForkSeq = @import("config").ForkSeq;
const ReceiveLayout = @import("ReceiveLayout.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const InboundAdmission = @import("InboundAdmission.zig");
const control_wire = @import("../control_wire.zig");

const Event = ReqResp.Event;
const Failure = ReqResp.Failure;
const reads_per_pump_max = RequestIO.reads_per_pump_max;

pub const State = enum { receiving_request, ready, serving, writing_chunk, finishing };
pub const Rejection = codec.Error || request_policy.InspectError;

const Server = @This();

request: RequestState = .{ .direction = .inbound },
progress_ms: u64 = 0,
serving_started_ms: ?u64 = null,
pending_result: u8 = constants.result_success,
close_after_write: bool = false,
state: State = .receiving_request,
request_fork: ForkSeq = .phase0,
rejection: ?Rejection = null,
receive: ReceiveLayout.Buffers = .{ .sink = &.{}, .scratch = &.{}, .read = &.{} },
identity: PeerId = undefined,
execution: ?u16 = null,
admission: InboundAdmission.State = .{},

pub fn complete(self: *Server, owner: *ReqResp, engine: *Engine, router: *Router, index: u16, event: Event, now: Now) void {
    owner.complete(engine, router, &self.request, index, event, .{ .phase_name = @tagName(self.state), .rejection = self.rejection, .result_code = self.pending_result }, now);
}

pub fn fail(self: *Server, owner: *ReqResp, engine: *Engine, router: *Router, index: u16, reason: Failure, now: Now) void {
    self.complete(owner, engine, router, index, .{ .failed = .{ .request = self.request.handle(index), .reason = reason, .phase = null } }, now);
}

fn failIo(self: *Server, owner: *ReqResp, engine: *Engine, router: *Router, index: u16, err: (Engine.StreamError || codec.Error), now: Now) void {
    self.fail(owner, engine, router, index, self.request.ioFailure(err), now);
}

/// A finishing slot resumes its FIN once the host has taken its last event.
pub fn deliver(self: *Server, now: Now) ?Event {
    const request = &self.request;
    const event = request.deliver() orelse return null;
    if (request.running() and self.state == .finishing) self.progress_ms = now.millis();
    return event;
}

fn waitingHost(self: *const Server) bool {
    return self.request.waitingHost() or self.state == .serving;
}

pub fn occupancy(self: *const Server) ?ReqResp.metrics.InboundPhase {
    if (!self.request.occupied()) return null;
    if (!self.request.running()) return .terminal;
    if (self.waitingHost()) return .waiting_host;
    return switch (self.state) {
        .receiving_request => .receiving_request,
        .ready => if (self.admission.start_pending) .waiting_start else .ready,
        .writing_chunk, .finishing => .writing_response,
        .serving => unreachable,
    };
}

pub fn deadline(self: *const Server, ctx: *const ReqResp) ?u64 {
    const request = &self.request;
    if (!request.running()) return null;
    if (self.state == .receiving_request) return request.started_ms +| ctx.options.progress_timeout_ms;
    if (self.state == .ready) return self.progress_ms +| ctx.options.quota_timeout_ms;
    const duration = if (self.waitingHost())
        ctx.options.host_timeout_ms
    else
        ctx.options.progress_timeout_ms;
    const progress = self.progress_ms +| duration;
    // The entire response gets one host-work allowance and one transfer allowance.
    // Chunk progress cannot keep a serving lease alive indefinitely.
    const total = (self.serving_started_ms orelse self.progress_ms) +| ctx.options.host_timeout_ms +| ctx.options.progress_timeout_ms;
    return @min(progress, total);
}

pub fn advance(self: *Server, ctx: *ReqResp, engine: *Engine, router: *Router, index: u16, now: Now) void {
    const request = &self.request;
    if (!request.running()) return;
    if (self.deadline(ctx)) |due| if (now.millis() >= due) {
        const reason: Failure = if (self.waitingHost())
            .host_timeout
        else if (self.state == .ready)
            .quota_timeout
        else
            .timeout;
        if (reason == .timeout and self.state == .receiving_request and ctx.options.report_non_completion and
            !request.io.unread(engine, request.stream))
            request.peer_fault = .non_completion;
        self.fail(ctx, engine, router, index, reason, now);
        return;
    };
    // A peer stop surfaces here while the host holds the slot. With an event still queued
    // for the host, its next call on the slot observes the stop instead.
    if (self.state == .ready or (self.state == .serving and !request.waitingHost())) {
        _ = engine.streamCapacity(request.stream) catch |err| switch (err) {
            error.WouldBlock => 0,
            else => {
                self.failIo(ctx, engine, router, index, err, now);
                return;
            },
        };
    }
    if (request.waitingHost()) return;
    switch (self.state) {
        .serving, .ready => {},
        .receiving_request => readRequest(ctx, engine, router, self, index, now),
        .writing_chunk => writeChunk(ctx, engine, router, self, index, now),
        .finishing => finishStream(ctx, engine, router, self, index, now),
    }
}

fn readRequest(owner: *ReqResp, engine: *Engine, router: *Router, slot: *Server, index: u16, now: Now) void {
    const request = &slot.request;
    var reads: u32 = 0;
    while (reads < reads_per_pump_max) : (reads += 1) {
        const input = request.io.read(engine, request.stream) catch |err| {
            slot.failIo(owner, engine, router, index, err, now);
            return;
        };
        if (input.reset) {
            slot.fail(owner, engine, router, index, .stream_closed, now);
            return;
        }
        if (input.progressed) slot.progress_ms = now.millis();
        if (input.bytes.len == 0 and !input.fin) return;
        if (input.bytes.len > 0) {
            if (!request.io.decoding or request.io.decoder.isDone()) {
                request.peer_fault = .protocol;
                Server.rejectRequest(owner, slot, index, error.TooManyBytes, now);
                return;
            }
            _ = request.io.feed(input.bytes) catch |err| {
                if (request.io.decoder.protocolFault(err)) request.peer_fault = .protocol;
                Server.rejectRequest(owner, slot, index, err, now);
                return;
            };
            if (request.io.buffered_start < request.io.buffered_end) {
                request.peer_fault = .protocol;
                Server.rejectRequest(owner, slot, index, error.TooManyBytes, now);
                return;
            }
        }
        // Goodbye only closes this authenticated peer's connection. Handle its complete
        // bounded frame before FIN, which can race the peer's connection shutdown.
        if (input.fin or (request.protocol == .goodbye_v1 and request.io.decoding and request.io.decoder.isDone())) {
            request.io.fin_seen = input.fin;
            const finished = !request.io.decoding or request.io.decoder.isDone();
            if (!finished) {
                request.peer_fault = .protocol;
                Server.rejectRequest(owner, slot, index, error.Truncated, now);
                return;
            }
            const payload: []const u8 = if (request.io.decoding)
                request.io.decoder.payload()
            else
                &.{};
            const inspected = owner.inspectRequest(request.protocol, payload, slot.request_fork) catch |err| {
                if (err == error.MalformedSsz or err == error.InvalidRequest) request.peer_fault = .protocol;
                owner.admission.chargeRejected(owner, slot, now);
                Server.rejectRequest(owner, slot, index, err, now);
                return;
            };
            request.chunks_max = inspected.chunks_max;
            slot.progress_ms = now.millis();
            slot.admission.decoded(inspected.charged_cost, now.millis());
            slot.state = .ready;
            return;
        }
    }
    owner.markReady(.inbound, index);
}

/// The connection is authenticated before admission. Both undecided complete input and
/// an undelivered request notification can carry its final Goodbye, including before FIN.
pub fn closingGoodbye(self: *Server, owner: *ReqResp, engine: *Engine, router: *Router, index: u16, now: Now) ?u64 {
    const request = &self.request;
    assert(request.running() and request.protocol == .goodbye_v1);
    if (self.state != .receiving_request and self.state != .ready and
        (request.pendingEvent() == null or request.pendingEvent().? != .request)) return null;
    if (self.state == .receiving_request and request.pendingEvent() == null) readRequest(owner, engine, router, self, index, now);
    if (request.running() and self.state == .ready) {
        const bytes = request.io.decoder.payload();
        const code = control_wire.decodeScalar(bytes) catch unreachable;
        self.state = .serving;
        return code;
    }
    if (request.pendingEvent()) |event| if (event == .request) {
        const code = control_wire.decodeScalar(event.request.bytes) catch unreachable;
        request.notification = .none;
        self.state = .serving;
        return code;
    };
    std.log.scoped(.network_reqresp_errors).debug("goodbye_incomplete_on_close request={d}:{d} connection={d}:{d} stream={d} buffered_bytes={d} decoded_bytes={d} decoder_phase={s} fin={any} detail={s}", .{ index, request.generation, request.conn.index, request.conn.generation, request.stream.id, request.io.buffered_end - request.io.buffered_start, if (request.io.decoding) request.io.decoder.written else 0, if (request.io.decoding) @tagName(request.io.decoder.phase) else "cleared", request.io.fin_seen, request.failure_detail });
    return null;
}

pub fn admit(self: *Server, index: u16, storage: *const InboundAdmission.Storage, now: Now) void {
    const request = &self.request;
    assert(request.running() and self.state == .ready);
    assert(!self.admission.start_pending);
    assert((storage.execution == null) == request.protocol.isControl());
    const payload: []const u8 = if (request.io.decoding) request.io.decoder.payload() else &.{};
    request.io.decoding = false;
    request.io.scratch = storage.scratch;
    self.execution = storage.execution;
    self.state = .serving;
    self.serving_started_ms = now.millis();
    self.progress_ms = now.millis();
    request.queue(.{ .request = .{
        .request = request.handle(index),
        .conn = request.conn,
        .protocol = request.protocol,
        .bytes = payload,
    } });
}

fn rejectRequest(owner: *ReqResp, slot: *Server, index: u16, reason: Rejection, now: Now) void {
    assert(slot.rejection == null);
    slot.rejection = reason;
    reject(slot, constants.result_invalid_request, "invalid request", now);
    owner.markReady(.inbound, index);
}

fn reject(slot: *Server, code: u8, message: []const u8, now: Now) void {
    const request = &slot.request;
    assert(message.len <= request.inline_bytes.len);
    @memcpy(request.inline_bytes[0..message.len], message);
    request.error_len = @intCast(message.len);
    request.io.decoding = false;
    slot.admission.rejected();
    slot.state = .serving;
    Server.queueChunk(
        slot,
        code,
        null,
        request.inline_bytes[0..message.len],
        true,
        now,
    );
}

fn queueChunk(
    slot: *Server,
    result: u8,
    context: ?[constants.context_bytes_length]u8,
    ssz: []const u8,
    close_after: bool,
    now: Now,
) void {
    const request = &slot.request;
    assert(slot.state == .serving);
    assert(request.io.outbox.idle());
    slot.pending_result = result;
    slot.close_after_write = close_after;
    slot.progress_ms = now.millis();
    request.io.writer = codec.ChunkWriter.initChunk(result, context, ssz);
    request.io.writing = true;
    slot.state = .writing_chunk;
}

fn writeChunk(owner: *ReqResp, engine: *Engine, router: *Router, slot: *Server, index: u16, now: Now) void {
    const request = &slot.request;
    const flushed = request.io.flush(engine, request.stream, false) catch |err| {
        slot.failIo(owner, engine, router, index, err, now);
        return;
    };
    if (flushed != .done) {
        if (flushed == .yielded) owner.markReady(.inbound, index);
        return;
    }
    if (slot.pending_result == constants.result_success) {
        request.chunks += 1;
    }
    request.io.writer = undefined;
    if (slot.close_after_write) {
        request.io.outbox.queue("", true);
        slot.state = .finishing;
        owner.markReady(.inbound, index);
        slot.progress_ms = now.millis();
        return;
    }
    slot.state = .serving;
    slot.progress_ms = now.millis();
    request.queue(.{ .chunk_sent = .{
        .request = request.handle(index),
        .chunks = request.chunks,
    } });
}

fn finishStream(
    owner: *ReqResp,
    engine: *Engine,
    router: *Router,
    slot: *Server,
    index: u16,
    now: Now,
) void {
    const request = &slot.request;
    assert(slot.state == .finishing);
    const flushed = request.io.outbox.pump(engine, request.stream) catch |err| stopped: {
        // An error chunk ends the response, so a peer can stop the stream once it has read one.
        const answered = request.chunks > 0 or slot.pending_result != constants.result_success;
        if (err != error.StreamStopped or !answered or request.io.outbox.offset != request.io.outbox.bytes.len) {
            slot.failIo(owner, engine, router, index, err, now);
            return;
        }
        std.log.scoped(.network_reqresp).debug("response_finish_stopped request={d}:{d} connection={d}:{d} stream={d} method={s} chunks={d}", .{ index, request.generation, request.conn.index, request.conn.generation, request.stream.id, @tagName(request.protocol), request.chunks });
        request.io.outbox = .{};
        break :stopped .done;
    };
    if (flushed != .done) {
        if (flushed == .yielded) owner.markReady(.inbound, index);
        return;
    }
    slot.progress_ms = now.millis();
    slot.complete(owner, engine, router, index, .{ .served = .{ .request = request.handle(index), .chunks = request.chunks } }, now);
}

/// The coordinator has checked all capacity and handoff bounds before charging the start.
pub fn acceptPrepared(
    slot: *Server,
    stream: StreamHandle,
    ready: Router.Selection,
    accepted: *const InboundAdmission.Acceptance,
    request_fork: ForkSeq,
    now: Now,
) void {
    const which = accepted.protocol;
    const bounds = &accepted.bounds;
    const request_sink = slot.receive.sink;
    assert(slot.request.available());
    assert(ready.leftover.len <= slot.receive.read.len);
    assert(request_sink.len >= bounds.request_max);
    slot.* = .{
        .receive = slot.receive,
        .identity = accepted.identity,
        .request_fork = request_fork,
        .progress_ms = now.millis(),
        .admission = accepted.state,
        .request = .{
            .completion = .running,
            .direction = .inbound,
            .generation = slot.request.generation + 1,
            .conn = stream.conn,
            .stream = stream,
            .protocol = which,
            .started_ms = now.millis(),
            .io = .{
                .sink = request_sink,
                .scratch = slot.receive.scratch,
                .read_buffer = slot.receive.read,
                .buffered_end = ready.leftover.len,
                .fin_seen = ready.fin,
            },
        },
    };
    assert(ready.leftover.len <= slot.request.io.read_buffer.len);
    @memcpy(slot.request.io.read_buffer[0..ready.leftover.len], ready.leftover);
    if (bounds.request_max > 0) {
        slot.request.io.decoder = codec.Decoder.initRequest(
            .{ .min = bounds.request_min, .max = bounds.request_max, .protocol_max = which.info().request_max },
            request_sink,
            slot.request.io.scratch,
        );
        slot.request.io.decoding = true;
    }
    assert(slot.request.occupied());
}

pub fn respond(slot: *Server, ssz: []const u8, digest: ?[constants.context_bytes_length]u8, now: Now) void {
    assert(slot.responseReadiness() == .ready);
    const bytes = if (ssz.len <= slot.request.inline_bytes.len) copied: {
        @memcpy(slot.request.inline_bytes[0..ssz.len], ssz);
        break :copied slot.request.inline_bytes[0..ssz.len];
    } else ssz;
    queueChunk(slot, constants.result_success, digest, bytes, false, now);
}

pub fn responseReadiness(self: *const Server) ReqResp.ResponseReadiness {
    const request = &self.request;
    assert(request.occupied());
    if (!request.running()) return .terminal;
    if (request.waitingHost() or self.state != .serving) return .backpressured;
    return .ready;
}

pub fn respondError(slot: *Server, code: u8, message: []const u8, now: Now) void {
    assert(slot.responseReadiness() == .ready);
    assert(constants.isErrorResult(code) and message.len <= codec.error_message_max);
    const request = &slot.request;
    @memcpy(request.inline_bytes[0..message.len], message);
    request.error_len = @intCast(message.len);
    queueChunk(slot, code, null, request.inline_bytes[0..message.len], true, now);
}

pub fn finish(slot: *Server, now: Now) bool {
    const request = &slot.request;
    if (!request.running()) return false;
    if (request.pendingEvent()) |event| if (event == .request) return false;
    switch (slot.state) {
        .serving => {
            if (!request.io.outbox.idle()) return false;
            request.io.outbox.queue("", true);
            slot.state = .finishing;
            slot.progress_ms = now.millis();
        },
        .writing_chunk => {
            if (slot.close_after_write) return false;
            slot.close_after_write = true;
        },
        else => return false,
    }
    return true;
}
