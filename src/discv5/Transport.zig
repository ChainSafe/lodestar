//! Owns discovery protocol state and bounded datagram I/O. The owner supplies time and received
//! input to advance; the standalone driver owns waiting and clock reads.

const std = @import("std");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const Lookup = @import("Lookup.zig");
const Maintenance = @import("Maintenance.zig");
const PendingResponse = @import("PendingResponse.zig");
const enr = @import("identity/enr.zig");
const Sockets = @import("udp").Sockets;
const types = @import("types.zig");
const constants = @import("wire/constants.zig");
const message = @import("wire/message.zig");
const KeyPair = @import("identity/crypto.zig").KeyPair;

pub const Error = Engine.Error || Sockets.DatagramError ||
    Sockets.SendError || std.Io.RandomSecureError || error{
    ClockOutOfRange,
    DestinationUnreachable,
    MissingExpiryStorage,
};

pub const StartResult = struct { started: bool = false, failure: ?Error = null };

pub const FailureStage = enum { coordinator, clock, receive, process };
pub const Failure = struct { stage: FailureStage, cause: Error };

pub const DatagramResult = union(enum) {
    timeout,
    accepted,
    rejected: types.RejectReason,
};

pub const AdvanceResult = struct {
    now_ms: u64 = 0,
    event: Engine.Event = .none,
    datagram: DatagramResult = .timeout,
    calls_expired: usize = 0,
    standard_responses: u8 = 0,
    cancelled: bool = false,
    failure: ?Failure = null,
};

const Transport = @This();

engine: Engine,
sockets: Sockets,
send_drops: Sockets.SendDrops = .{},
scratch: Engine.Scratch = .{},
response: PendingResponse = .{},
output: [constants.packet_size_max]u8 = undefined,
receive_buffer: [constants.packet_size_max]u8 = undefined,

/// Takes ownership of bound sockets on success. Initialize at the final address.
pub fn init(self: *Transport, allocator: std.mem.Allocator, sockets: Sockets, key: KeyPair, record: enr.Record, config: Engine.Config) !void {
    self.* = .{ .engine = undefined, .sockets = sockets };
    try self.engine.init(allocator, key, record, config);
}

pub fn deinit(self: *Transport, allocator: std.mem.Allocator, io: std.Io) void {
    self.engine.deinit(allocator);
    self.sockets.close(io);
    self.* = undefined;
}

pub fn localAddress(self: *const Transport) types.Address {
    return self.sockets.localAddress();
}

/// Encodes and sends one request immediately. A failed send cancels the call, so no unsent
/// request lingers.
pub fn startCall(
    self: *Transport,
    io: std.Io,
    peer: types.Endpoint,
    record: *const enr.Record,
    request: *const message.Message,
    now_ms: u64,
) Error!CallTable.Handle {
    var entropy = try startEntropy(io);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
    const started = try self.engine.startCall(
        &self.output,
        peer,
        record,
        request,
        now_ms,
        &entropy,
    );
    self.transmit(io, peer.address, self.output[0..started.packet_length]) catch |err| {
        const cancelled = self.engine.cancelCall(started.handle);
        std.debug.assert(cancelled);
        return err;
    };
    return started.handle;
}

pub fn startLookup(self: *Transport, io: std.Io, lookup: *Lookup, now_ms: u64) (Error || Lookup.Error)!StartResult {
    var entropy: Engine.StartEntropy = undefined;
    try io.randomSecure(std.mem.asBytes(&entropy));
    defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
    const started = try lookup.startNext(&self.engine, &self.output, try Transport.requestId(io), now_ms, &entropy) orelse return .{};
    self.transmit(io, started.peer.address, self.output[0..started.call.packet_length]) catch |err| {
        std.debug.assert(lookup.onFailure(&self.engine, started.call.handle));
        return .{ .started = true, .failure = err };
    };
    return .{ .started = true };
}

pub fn startMaintenance(self: *Transport, io: std.Io, maintenance: *Maintenance, now_ms: u64) (Error || Maintenance.Error)!StartResult {
    var entropy: Engine.StartEntropy = undefined;
    try io.randomSecure(std.mem.asBytes(&entropy));
    defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
    const started = try maintenance.startNext(&self.engine, &self.output, try Transport.requestId(io), now_ms, &entropy) orelse return .{};
    self.transmit(io, started.peer.address, self.output[0..started.call.packet_length]) catch |err| {
        std.debug.assert(maintenance.onFailure(&self.engine, started.call.handle, now_ms, .local));
        return .{ .started = true, .failure = err };
    };
    return .{ .started = true };
}

pub fn sendResponse(
    self: *Transport,
    io: std.Io,
    peer: types.Endpoint,
    response: *const message.Message,
    now_ms: u64,
) Error!void {
    var entropy = try startEntropy(io);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
    const packet_length = try self.engine.sendResponse(
        &self.output,
        peer,
        response,
        now_ms,
        &entropy,
    );
    try self.transmit(io, peer.address, self.output[0..packet_length]);
}

/// Failures tied to the destination collapse into `DestinationUnreachable`.
pub fn transmit(
    self: *Transport,
    io: std.Io,
    destination: types.Address,
    bytes: []const u8,
) Error!void {
    return self.sockets.sendTo(io, destination, bytes, constants.packet_size_max) catch |err| {
        if (Sockets.SendDrops.Reason.fromError(err)) |reason| self.send_drops.add(reason, bytes.len);
        std.log.scoped(.network_discovery).debug("discovery_send_failed endpoint={any} bytes={d} reason={s}", .{ destination, bytes.len, @errorName(err) });
        return if (Sockets.destinationUnreachable(err)) error.DestinationUnreachable else err;
    };
}

pub const Input = Sockets.DatagramError!?Sockets.Datagram;

/// Reads at most one datagram without waiting. Input bytes borrow receive_buffer until the next
/// receive. Pass this result to advance even on failure, so expiry delivery still progresses.
pub fn receive(self: *Transport, io: std.Io, ready: *[2]bool) Input {
    return self.sockets.receiveReadyDatagram(io, &self.receive_buffer, ready);
}

/// Expires once at the supplied time, then processes input and sends standard replies. Consume
/// every result, including failures, before the next advance; events borrow protocol scratch.
pub fn advance(self: *Transport, io: std.Io, now_ms: u64, expired_calls: []CallTable.Expired, input: Input) Error!AdvanceResult {
    if (expired_calls.len == 0) return error.MissingExpiryStorage;
    var result: AdvanceResult = .{ .now_ms = now_ms };
    const expired = self.engine.expire(now_ms, expired_calls);
    result.calls_expired = expired.calls;
    const datagram = input catch |err| switch (err) {
        error.Timeout => null,
        error.InvalidSourceAddress => blk: {
            result.datagram = .{ .rejected = .malformed_packet };
            break :blk null;
        },
        error.DatagramTooLarge => blk: {
            result.datagram = .{ .rejected = .oversized_datagram };
            break :blk null;
        },
        else => {
            recordFailure(&result, err, .receive);
            return result;
        },
    };
    if (datagram) |packet| self.processDatagram(io, packet, &result) catch |err| {
        recordFailure(&result, err, .process);
    };
    return result;
}

fn recordFailure(result: *AdvanceResult, err: Error, stage: FailureStage) void {
    result.cancelled = result.cancelled or err == error.Canceled;
    if (result.failure != null) return;
    result.failure = .{ .cause = err, .stage = stage };
}

fn processDatagram(
    self: *Transport,
    io: std.Io,
    datagram: Sockets.Datagram,
    result: *AdvanceResult,
) Error!void {
    if (!self.engine.admitDatagram(&datagram.from, result.now_ms)) {
        result.datagram = .{ .rejected = .admission_limited };
        return;
    }
    var entropy = try receiveEntropy(io);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
    const accepted = switch (try self.engine.receiveAdmitted(
        &self.output,
        datagram.bytes,
        datagram.from,
        .{ .now_ms = result.now_ms, .entropy = entropy },
        &self.scratch,
    )) {
        .accepted => |accepted| accepted,
        .rejected => |reason| {
            result.datagram = .{ .rejected = reason };
            return;
        },
    };
    result.datagram = .accepted;
    result.event = accepted.event;
    const packet = self.output[0..accepted.packet_length];
    if (accepted.call) |handle| {
        std.debug.assert(packet.len > 0 and accepted.event == .none);
        // An unsent handshake fails its call now, so the owner records a local failure rather
        // than a remote timeout later. A local fault still fails the step.
        const sent = self.reply(io, datagram.from, packet) catch |err| {
            result.event = self.engine.failCall(handle, error.HandshakeUnsent);
            return err;
        };
        if (!sent) result.event = self.engine.failCall(handle, error.HandshakeUnsent);
        return;
    }
    if (packet.len > 0) _ = try self.reply(io, datagram.from, packet);
    result.event = try self.handleEvent(io, accepted.event, result);
}

fn handleEvent(
    self: *Transport,
    io: std.Io,
    event: Engine.Event,
    result: *AdvanceResult,
) Error!Engine.Event {
    const request = switch (event) {
        .request => |request| request,
        else => return event,
    };
    switch (request.message) {
        .talk_request => return event,
        .ping, .find_node => {},
    }
    try self.engine.prepareStandardResponse(&request, &self.response);
    for (0..types.findnode_response_packets_max) |_| {
        var entropy = try startEntropy(io);
        defer std.crypto.secureZero(u8, std.mem.asBytes(&entropy));
        const packet_length = try self.engine.encodeNextStandardResponse(
            &self.output,
            &self.response,
            result.now_ms,
            &entropy,
        ) orelse break;
        // The destination refuses the remaining fragments too.
        if (!try self.reply(io, request.peer.address, self.output[0..packet_length])) return .none;
        result.standard_responses += 1;
    }
    std.debug.assert(self.response.complete());
    return .none;
}

/// Sends a packet this step produced and returns false when its destination refuses it. The
/// refusal fails only that destination: a requester retries a dropped reply.
fn reply(self: *Transport, io: std.Io, destination: types.Address, bytes: []const u8) Error!bool {
    self.transmit(io, destination, bytes) catch |err| switch (err) {
        error.DestinationUnreachable => return false,
        else => return err,
    };
    return true;
}

pub fn monotonicMilliseconds(io: std.Io) error{ClockOutOfRange}!u64 {
    const nanos = std.Io.Clock.awake.now(io).nanoseconds;
    if (nanos < 0) return error.ClockOutOfRange;
    const millis = @divTrunc(nanos, std.time.ns_per_ms);
    if (millis > std.math.maxInt(u64)) return error.ClockOutOfRange;
    return @intCast(millis);
}

fn requestId(io: std.Io) std.Io.RandomSecureError!message.RequestId {
    var bytes: [8]u8 = undefined;
    try std.Io.randomSecure(io, &bytes);
    return message.RequestId.init(&bytes) catch unreachable;
}

fn startEntropy(io: std.Io) std.Io.RandomSecureError!Engine.StartEntropy {
    var entropy: Engine.StartEntropy = undefined;
    try std.Io.randomSecure(io, std.mem.asBytes(&entropy));
    return entropy;
}

fn receiveEntropy(io: std.Io) std.Io.RandomSecureError!Engine.ReceiveEntropy {
    var entropy: Engine.ReceiveEntropy = undefined;
    try std.Io.randomSecure(io, std.mem.asBytes(&entropy));
    return entropy;
}

comptime {
    std.debug.assert(@sizeOf(Transport) <= 32 * 1_024);
}

test {
    _ = @import("transport_test.zig");
    _ = @import("transport_socket_test.zig");
}
