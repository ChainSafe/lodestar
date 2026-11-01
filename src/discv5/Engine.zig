//! The Engine applies protocol policy over the channel, call table, and routing table. It is
//! single-threaded, so callers serialize entry and supply time and entropy.

const std = @import("std");
const CallTable = @import("CallTable.zig");
const Channel = @import("Channel.zig");
const crypto = @import("identity/crypto.zig");
const enr = @import("identity/enr.zig");
const RoutingTable = @import("RoutingTable.zig");
const PendingResponse = @import("PendingResponse.zig");
const types = @import("types.zig");
const constants = @import("wire/constants.zig");
const message = @import("wire/message.zig");
const SessionStore = @import("SessionStore.zig");
const Admission = @import("Admission.zig");

pub const Error = CallTable.Error || Channel.Error || RoutingTable.Error ||
    PendingResponse.Error || error{
    ApplicationResponseRequired,
    ClockOverflow,
    HandshakeUnsent,
    MissingCall,
    RecordAdmissionLimited,
    SessionRequired,
    UnexpectedChallenge,
};

pub const InitError = Channel.InitError || CallTable.InitError || RoutingTable.InitError || error{InvalidTimeout};

pub const StartEntropy = Channel.SealEntropy;

pub const ReceiveEntropy = struct {
    challenge: Channel.ChallengeEntropy,
    handshake: Channel.HandshakeEntropy,
};

pub const StartResult = struct {
    handle: CallTable.Handle,
    packet_length: u16,
};

pub const OutboundCall = struct {
    call: StartResult,
    peer: types.Endpoint,
};

pub const ExpiryCounts = struct {
    calls: usize,
    challenges: usize,
    sessions: usize,
};

pub const Request = union(enum) {
    ping: message.Ping,
    find_node: message.FindNode,
    talk_request: message.TalkRequest,
};

pub const AuthenticatedRequest = struct {
    peer: types.Endpoint,
    message: Request,
    /// The ENR update the handshake carried, if it carried one.
    record: ?enr.Record,
};

pub const AuthenticatedResponse = struct {
    peer: types.Endpoint,
    matched: CallTable.Matched,
    record: ?enr.Record,
    /// The validated records at requested distances, in NODES order. They borrow scratch.
    node_records: []const enr.Record,
};

pub const Event = union(enum) {
    none,
    request: AuthenticatedRequest,
    response: AuthenticatedResponse,
    failed: Failed,

    pub const Consumption = struct {
        consumed: bool = false,
        /// Copies the owner's known record before a terminal response releases its state.
        /// The authenticated endpoint remains in the response event.
        responder: ?enr.Record = null,
    };
};

pub const Failed = struct {
    handle: CallTable.Handle,
    peer: types.Endpoint,
    reason: Error,
};

pub const Accepted = struct {
    packet_length: u16 = 0,
    /// The call whose handshake the packet carries. A host that cannot send it fails the call
    /// with `failCall`.
    call: ?CallTable.Handle = null,
    event: Event = .none,
};

/// Invalid input and admission pressure arrive as `rejected`. Errors are local failures.
pub const Outcome = union(enum) {
    accepted: Accepted,
    rejected: types.RejectReason,
};

pub const Scratch = struct {
    channel: Channel.Scratch = .{},
    message_decode: message.DecodeScratch = .{},
    node_records: [types.findnode_result_max]enr.Record = undefined,
    node_ids: [types.findnode_result_max]types.NodeId = undefined,
};

pub const ReceiveArgs = struct {
    now_ms: u64,
    entropy: ReceiveEntropy,
};

pub const Config = struct {
    session_capacity: usize = 1_024,
    /// Ceiling; storage is derived from the challenge admission rate and timeout.
    challenge_capacity: usize = SessionStore.challenge_capacity_max,
    call_capacity: usize = 64,
    request_timeout_ms: u64 = 1_000,
    challenge_timeout_ms: u64 = 1_000,
    session_idle_timeout_ms: u64 = 86_400_000,
};

const Engine = @This();

config: Config,
channel: Channel,
calls: CallTable,
routing: RoutingTable,

pub fn init(
    self: *Engine,
    allocator: std.mem.Allocator,
    local_key: crypto.KeyPair,
    local_record: enr.Record,
    config: Config,
) InitError!void {
    if (config.request_timeout_ms == 0) return error.InvalidTimeout;
    try self.channel.init(allocator, local_key, local_record, .{
        .session_capacity = config.session_capacity,
        .challenge_capacity = config.challenge_capacity,
        .challenge_timeout_ms = config.challenge_timeout_ms,
        .session_idle_timeout_ms = config.session_idle_timeout_ms,
    });
    errdefer self.channel.deinit(allocator);
    try self.calls.init(allocator, config.call_capacity);
    errdefer self.calls.deinit(allocator);
    try self.routing.init(allocator, local_record.node_id);
    self.config = config;
}

pub fn deinit(self: *Engine, allocator: std.mem.Allocator) void {
    self.routing.deinit(allocator);
    self.calls.deinit(allocator);
    self.channel.deinit(allocator);
    self.* = undefined;
}

pub fn localRecord(self: *const Engine) *const enr.Record {
    return &self.channel.local_record;
}

pub fn peerCount(self: *const Engine) usize {
    return self.routing.count();
}

pub fn isPeerBusy(self: *const Engine, node_id: *const types.NodeId) bool {
    return self.calls.isPeerBusy(node_id);
}

pub fn nextDeadlineMs(self: *const Engine) ?u64 {
    const calls = self.calls.nextDeadlineMs();
    const channel = self.channel.nextDeadlineMs();
    return if (calls) |value| @min(value, channel orelse value) else channel;
}

pub fn updateLocalRecord(self: *Engine, record: *const enr.Record) Error!void {
    try self.channel.updateLocalRecord(record);
}

pub fn maintenanceTarget(
    self: *const Engine,
    cursor: *usize,
    now_ms: u64,
    stale_after_ms: u64,
) ?RoutingTable.Entry {
    return self.routing.maintenanceTarget(cursor, now_ms, stale_after_ms);
}

pub fn peerRecord(self: *const Engine, node_id: *const types.NodeId) ?RoutingTable.Entry {
    return self.routing.get(node_id);
}

pub fn markPeerUnresponsive(self: *Engine, node_id: *const types.NodeId, verified_at_ms: u64) bool {
    return self.routing.markUnresponsive(node_id, verified_at_ms);
}

/// Encodes, seals, and registers one request. The packet in `out` is the caller's to send, and
/// on failure nothing is registered.
pub fn startCall(
    self: *Engine,
    out: []u8,
    peer: types.Endpoint,
    remote_record: *const enr.Record,
    request: *const message.Message,
    now_ms: u64,
    entropy: *const StartEntropy,
) Error!StartResult {
    if (!std.mem.eql(u8, &peer.node_id, &remote_record.node_id))
        return error.InvalidRemoteRecord;
    const deadline_ms = try deadline(now_ms, self.config.request_timeout_ms);
    const handle = self.calls.begin(
        peer,
        &remote_record.public_key,
        request,
        deadline_ms,
        try self.channel.requestCapacity(peer),
    ) catch |err| switch (err) {
        // The request would fit an established session but not a handshake packet.
        error.RequestTooLarge => return if (self.channel.hasSession(peer))
            err
        else
            error.SessionRequired,
        else => return err,
    };
    errdefer {
        const cancelled = self.calls.cancel(handle);
        std.debug.assert(cancelled);
    }
    const plaintext = self.calls.requestBytes(handle) orelse return error.MissingCall;
    const sealed = try self.channel.seal(out, peer, plaintext, entropy, now_ms);
    try self.calls.markSent(handle, &sealed.nonce, deadline_ms);
    return .{ .handle = handle, .packet_length = sealed.packet_length };
}

pub fn sendResponse(
    self: *Engine,
    out: []u8,
    peer: types.Endpoint,
    response: *const message.Message,
    now_ms: u64,
    entropy: *const StartEntropy,
) Error!u16 {
    try validateResponse(response);
    return self.sendPreparedResponse(out, peer, response, now_ms, entropy);
}

/// Stages the PONG or NODES reply to a request. TALKREQ is the host's to answer through
/// `sendResponse`.
pub fn prepareStandardResponse(
    self: *const Engine,
    request: *const AuthenticatedRequest,
    response: *PendingResponse,
) Error!void {
    return switch (request.message) {
        .ping => |ping| response.preparePong(
            request.peer,
            ping.request_id,
            self.channel.local_record.sequence,
        ),
        .find_node => |find_node| blk: {
            const records = try self.findNodes(
                request.peer.address,
                find_node.distances,
                &response.records,
            );
            break :blk try response.prepareNodes(
                request.peer,
                find_node.request_id,
                records.len,
            );
        },
        .talk_request => error.ApplicationResponseRequired,
    };
}

pub fn encodeNextStandardResponse(
    self: *Engine,
    out: []u8,
    response: *PendingResponse,
    now_ms: u64,
    entropy: *const StartEntropy,
) Error!?u16 {
    var raw_records: PendingResponse.RawRecords = undefined;
    const message_response = response.next(&raw_records) orelse return null;
    const packet_length = try self.sendPreparedResponse(
        out,
        response.peer,
        &message_response,
        now_ms,
        entropy,
    );
    response.advance();
    return packet_length;
}

fn sendPreparedResponse(
    self: *Engine,
    out: []u8,
    peer: types.Endpoint,
    response: *const message.Message,
    now_ms: u64,
    entropy: *const StartEntropy,
) Error!u16 {
    var plaintext_buffer: [constants.ordinary_plaintext_size_max]u8 = undefined;
    const plaintext = try response.encode(&plaintext_buffer);
    const sealed = try self.channel.sealEstablished(out, peer, plaintext, entropy, now_ms);
    return sealed.packet_length;
}

/// Processes one datagram. `out` receives at most one immediate reply, either a WHOAREYOU or
/// the local handshake. Standard responses are staged separately.
pub fn receive(
    self: *Engine,
    out: []u8,
    raw: []const u8,
    from: types.Address,
    args: ReceiveArgs,
    scratch: *Scratch,
) Error!Outcome {
    if (!self.admitDatagram(&from, args.now_ms)) return .{ .rejected = .admission_limited };
    return self.receiveAdmitted(out, raw, from, args, scratch);
}

pub fn admitDatagram(self: *Engine, from: *const types.Address, now_ms: u64) bool {
    const stage: Admission.Stage = if (self.calls.expectsResponseFrom(from, now_ms)) .response else .packet;
    return self.channel.admission.allow(stage, from, now_ms);
}

/// Requires one successful `admitDatagram` for this datagram, endpoint, and timestamp.
/// Transport admits before obtaining entropy; other callers can use `receive` directly.
pub fn receiveAdmitted(
    self: *Engine,
    out: []u8,
    raw: []const u8,
    from: types.Address,
    args: ReceiveArgs,
    scratch: *Scratch,
) Error!Outcome {
    return self.process(out, raw, from, args, scratch) catch |err| {
        const reason = rejectReason(err) orelse return err;
        return .{ .rejected = reason };
    };
}

fn process(
    self: *Engine,
    out: []u8,
    raw: []const u8,
    from: types.Address,
    args: ReceiveArgs,
    scratch: *Scratch,
) Error!Outcome {
    return switch (self.channel.receive(raw, from, args.now_ms, &scratch.channel)) {
        .authenticated => |authenticated| self.receiveAuthenticated(
            authenticated,
            args.now_ms,
            scratch,
        ),
        .unauthenticated => |unauthenticated| self.issueChallenge(out, unauthenticated, args),
        .whoareyou => |whoareyou| self.recoverCall(out, whoareyou, args),
        .rejected => |reason| .{ .rejected = reason },
    };
}

/// Expires calls, challenges, and sessions. Every call expiry is returned to its host owner.
pub fn expire(
    self: *Engine,
    now_ms: u64,
    expired_calls: []CallTable.Expired,
) ExpiryCounts {
    const expired_count = self.calls.expire(now_ms, expired_calls);
    const expired = self.channel.expire(now_ms);
    return .{
        .calls = expired_count,
        .challenges = expired.challenges,
        .sessions = expired.sessions,
    };
}

pub fn cancelCall(self: *Engine, handle: CallTable.Handle) bool {
    return self.calls.cancel(handle);
}

/// Cancels a live call that cannot proceed and reports the failure to its owner.
pub fn failCall(self: *Engine, handle: CallTable.Handle, reason: Error) Event {
    const peer = self.calls.endpoint(handle) orelse unreachable;
    const cancelled = self.calls.cancel(handle);
    std.debug.assert(cancelled);
    return .{ .failed = .{ .handle = handle, .peer = peer, .reason = reason } };
}

pub fn confirmPeer(
    self: *Engine,
    peer: *const types.Endpoint,
    record: *const enr.Record,
    now_ms: u64,
) RoutingTable.Error!RoutingTable.PutResult {
    return self.routing.upsertVerified(peer, record, now_ms, .outgoing);
}

pub fn findNodes(
    self: *const Engine,
    requester: types.Address,
    distances: []const u16,
    out: []enr.Record,
) RoutingTable.Error![]enr.Record {
    return self.routing.findNodes(&self.channel.local_record, requester, distances, out);
}

pub fn closestNodes(
    self: *const Engine,
    target: *const types.NodeId,
    out: []RoutingTable.Entry,
) []RoutingTable.Entry {
    return self.routing.closest(target, out);
}

fn receiveAuthenticated(
    self: *Engine,
    authenticated: Channel.Authenticated,
    now_ms: u64,
    scratch: *Scratch,
) Error!Outcome {
    const decoded = try message.Message.decode(
        authenticated.plaintext,
        &scratch.message_decode,
    );
    const event = try self.dispatch(
        authenticated.peer,
        decoded,
        authenticated.record,
        now_ms,
        scratch,
        &authenticated.nonce,
    );
    self.routeAuthenticated(authenticated.peer, authenticated.record, now_ms, if (event == .response) .outgoing else .incoming);
    return .{ .accepted = .{ .event = event } };
}

fn issueChallenge(
    self: *Engine,
    out: []u8,
    unauthenticated: Channel.Unauthenticated,
    args: ReceiveArgs,
) Error!Outcome {
    const packet_length = try self.channel.challenge(
        out,
        unauthenticated.peer,
        &unauthenticated.request_nonce,
        self.knownIdentity(&unauthenticated.peer.node_id),
        &args.entropy.challenge,
        args.now_ms,
    );
    return .{ .accepted = .{ .packet_length = packet_length orelse 0 } };
}

fn knownIdentity(self: *const Engine, node_id: *const types.NodeId) ?Channel.KnownIdentity {
    const entry = self.routing.get(node_id) orelse return null;
    return .{ .sequence = entry.record.sequence, .public_key = entry.record.public_key };
}

fn recoverCall(
    self: *Engine,
    out: []u8,
    whoareyou: Channel.Whoareyou,
    args: ReceiveArgs,
) Error!Outcome {
    const handle = (try self.calls.acceptChallenge(
        whoareyou.from,
        &whoareyou.request_nonce,
        args.now_ms,
    )) orelse return error.UnexpectedChallenge;
    const peer = self.calls.endpoint(handle) orelse unreachable;
    const packet_length = self.recoverAcceptedCall(out, handle, peer, whoareyou, args) catch |err| {
        return .{ .accepted = .{ .event = self.failCall(handle, err) } };
    };
    return .{ .accepted = .{ .packet_length = packet_length, .call = handle } };
}

fn recoverAcceptedCall(
    self: *Engine,
    out: []u8,
    handle: CallTable.Handle,
    peer: types.Endpoint,
    whoareyou: Channel.Whoareyou,
    args: ReceiveArgs,
) Error!u16 {
    const remote_public_key = self.calls.remotePublicKey(handle) orelse
        return error.MissingCall;
    const plaintext = self.calls.requestBytes(handle) orelse return error.MissingCall;
    const deadline_ms = try deadline(args.now_ms, self.config.request_timeout_ms);
    // Reserve the nonce before encoding so a collision cannot leave a session behind for a
    // cancelled call.
    try self.calls.markSent(
        handle,
        &Channel.handshakeNonce(&args.entropy.handshake),
        deadline_ms,
    );
    const sealed = try self.channel.answerChallenge(out, .{
        .peer = peer,
        .remote_public_key = &remote_public_key,
        .plaintext = plaintext,
        .challenge_data = &whoareyou.challenge_data,
        .enr_sequence = whoareyou.enr_sequence,
        .entropy = &args.entropy.handshake,
        .now_ms = args.now_ms,
    });
    return sealed.packet_length;
}

fn dispatch(
    self: *Engine,
    peer: types.Endpoint,
    decoded: message.Message,
    record: ?enr.Record,
    now_ms: u64,
    scratch: *Scratch,
    nonce: *const [constants.nonce_size]u8,
) Error!Event {
    return switch (decoded) {
        .ping => |ping| requestEvent(peer, .{ .ping = ping }, record),
        .find_node => |find_node| requestEvent(peer, .{ .find_node = find_node }, record),
        .talk_request => |talk| requestEvent(peer, .{ .talk_request = talk }, record),
        .pong, .nodes, .talk_response => self.dispatchResponse(
            peer,
            decoded,
            record,
            now_ms,
            scratch,
            nonce,
        ),
    };
}

fn dispatchResponse(
    self: *Engine,
    peer: types.Endpoint,
    decoded: message.Message,
    record: ?enr.Record,
    now_ms: u64,
    scratch: *Scratch,
    nonce: *const [constants.nonce_size]u8,
) Error!Event {
    const handle = try self.calls.match(peer, &decoded, now_ms);
    try self.calls.checkResponseNonce(handle, nonce);
    var filtered = decoded;
    const parsed_records = switch (decoded) {
        .nodes => |nodes| blk: {
            for (nodes.enrs, scratch.node_ids[0..nodes.enrs.len]) |raw, *node_id|
                node_id.* = try enr.Record.unverifiedNodeId(raw);
            const selected = try self.calls.selectNodes(handle, scratch.node_ids[0..nodes.enrs.len]);
            if (selected.count() != 0 and !self.channel.admission.allowRecords(&peer.address, @intCast(selected.count()), now_ms))
                return error.RecordAdmissionLimited;
            var count: usize = 0;
            for (nodes.enrs, 0..) |raw, index| {
                if (!selected.isSet(index)) continue;
                scratch.node_records[count] = try enr.Record.init(raw);
                scratch.node_ids[count] = scratch.node_records[count].node_id;
                scratch.message_decode.enrs[count] = raw;
                count += 1;
            }
            filtered.nodes.enrs = scratch.message_decode.enrs[0..count];
            break :blk scratch.node_records[0..count];
        },
        else => &.{},
    };
    const match_result = try self.calls.accept(
        handle,
        &filtered,
        scratch.node_ids[0..parsed_records.len],
        nonce,
    );
    std.debug.assert(match_result.accepted_nodes.count() == parsed_records.len);
    return .{ .response = .{
        .peer = peer,
        .matched = match_result.matched,
        .record = record,
        .node_records = parsed_records,
    } };
}

// Unsolicited authenticated peers may occupy at most half of a routing bucket.
fn routeAuthenticated(
    self: *Engine,
    peer: types.Endpoint,
    supplied_record: ?enr.Record,
    now_ms: u64,
    direction: RoutingTable.Direction,
) void {
    const record = supplied_record orelse
        (self.routing.get(&peer.node_id) orelse return).record;
    _ = self.routing.upsertVerified(&peer, &record, now_ms, direction) catch return;
}

// Admission pressure and invalid input become values here. Unmapped errors are local failures.
fn rejectReason(err: Error) ?types.RejectReason {
    return switch (err) {
        error.AdmissionLimited => .admission_limited,
        error.RecordAdmissionLimited => .record_admission_limited,
        error.InvalidMessage,
        error.UnsupportedMessage,
        error.InvalidEncoding,
        error.Overflow,
        error.UnexpectedType,
        => .malformed_message,
        error.InvalidRecord,
        error.TooManyFields,
        error.UnsupportedScheme,
        error.InvalidSignature,
        error.InvalidPublicKey,
        error.InvalidRemoteRecord,
        => .invalid_record,
        error.UnexpectedChallenge, error.HandshakeAttempted => .unexpected_challenge,
        error.RequestTooLargeForHandshake => .request_too_large,
        error.UnknownCall,
        error.CallExpired,
        error.RequestIdMismatch,
        error.UnexpectedResponse,
        => .unsolicited_response,
        error.InvalidResponseCount, error.InvalidNodeCount => .invalid_response,
        error.DuplicateResponse => .duplicate_response,
        else => null,
    };
}

fn requestEvent(peer: types.Endpoint, request: Request, record: ?enr.Record) Event {
    return .{ .request = .{ .peer = peer, .message = request, .record = record } };
}

fn deadline(now_ms: u64, timeout_ms: u64) Error!u64 {
    std.debug.assert(timeout_ms != 0);
    return std.math.add(u64, now_ms, timeout_ms) catch error.ClockOverflow;
}

fn validateResponse(value: *const message.Message) Error!void {
    switch (value.*) {
        .pong, .talk_response => {},
        .nodes => |nodes| {
            if (nodes.total == 0 or nodes.total > types.findnode_response_packets_max)
                return error.InvalidResponseCount;
            if (nodes.enrs.len > types.findnode_result_max)
                return error.InvalidMessage;
            for (nodes.enrs) |raw| _ = try enr.Record.init(raw);
        },
        else => return error.UnexpectedResponse,
    }
}

comptime {
    std.debug.assert(@sizeOf(Engine) <= 1_152);
}

test {
    _ = @import("engine_schedule_test.zig");
    _ = @import("engine_test.zig");
}
