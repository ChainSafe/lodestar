//! A CallTable holds one entry per in-flight request. The entry owns the encoded request, the
//! deadline, and NODES accumulation. Handles carry a generation, so a stale handle can never
//! touch a reused slot.

const std = @import("std");
const message = @import("wire/message.zig");
const constants = @import("wire/constants.zig");
const types = @import("types.zig");

const CallTable = @This();

pub const capacity_max: usize = 256;

pub const InitError = std.mem.Allocator.Error || error{InvalidCapacity};

pub const Error = message.Error || error{
    CallExpired,
    HandshakeAttempted,
    DuplicateResponse,
    InvalidNodeCount,
    InvalidRequest,
    InvalidResponseCount,
    NonceInUse,
    PeerBusy,
    RequestIdMismatch,
    RequestTooLarge,
    StaleHandle,
    TableFull,
    UnexpectedResponse,
    UnknownCall,
};

pub const Handle = struct {
    index: u16,
    generation: u64,
};

pub const Response = union(enum) {
    pong: message.Pong,
    nodes: message.Nodes,
    talk_response: message.TalkResponse,
};

pub const Matched = struct {
    handle: Handle,
    response: Response,
    terminal: bool,
};

pub const AcceptedNodes = std.StaticBitSet(types.findnode_result_max);

pub const MatchResult = struct {
    matched: Matched,
    accepted_nodes: AcceptedNodes = AcceptedNodes.empty,
};

pub const Expired = struct {
    handle: Handle,
    peer: types.Endpoint,
};

const NodesState = struct {
    distances: std.StaticBitSet(types.distance_count),
    seen: [types.findnode_result_max]types.NodeId = undefined,
    accepted: u8 = 0,
    total: u8 = 0,
    received: u8 = 0,
    nonces: [types.findnode_response_packets_max][constants.nonce_size]u8 = undefined,
};

const Expected = union(enum) {
    pong,
    nodes: NodesState,
    talk_response,
};

const Entry = struct {
    generation: u64,
    peer: types.Endpoint,
    request_id: message.RequestId,
    expected: Expected,
    request: [constants.ordinary_plaintext_size_max]u8,
    request_length: u16,
    sent_nonce: [constants.nonce_size]u8 = undefined,
    sent: bool = false,
    deadline_ms: u64,
    handshake_attempted: bool = false,
    remote_public_key: [33]u8,
};

entries: []?Entry,
next_generations: []u64,
next_deadline_ms: ?u64 = null,

pub fn init(
    self: *CallTable,
    allocator: std.mem.Allocator,
    capacity: usize,
) InitError!void {
    if (capacity == 0 or capacity > capacity_max) return error.InvalidCapacity;

    const entries = try allocator.alloc(?Entry, capacity);
    errdefer allocator.free(entries);
    const next_generations = try allocator.alloc(u64, capacity);

    @memset(entries, null);
    @memset(next_generations, 1);
    self.* = .{
        .entries = entries,
        .next_generations = next_generations,
    };
}

pub fn deinit(self: *CallTable, allocator: std.mem.Allocator) void {
    for (self.entries) |*entry| clearEntry(entry);
    allocator.free(self.next_generations);
    allocator.free(self.entries);
    self.* = undefined;
}

/// Encodes and stores the request. The call takes part in matching only after `markSent`.
pub fn begin(
    self: *CallTable,
    peer: types.Endpoint,
    remote_public_key: *const [33]u8,
    request: *const message.Message,
    deadline_ms: u64,
    request_capacity: usize,
) Error!Handle {
    if (self.findNode(&peer.node_id) != null) return error.PeerBusy;
    const expected = try expectedResponse(request);
    var encoded: [constants.ordinary_plaintext_size_max]u8 = undefined;
    defer std.crypto.secureZero(u8, &encoded);
    const request_bytes = try request.encode(&encoded);
    if (request_bytes.len > request_capacity) return error.RequestTooLarge;
    const index = try self.availableIndex();
    const generation = self.next_generations[index];
    std.debug.assert(generation < std.math.maxInt(u64));
    const successor = generation + 1;
    var entry = Entry{
        .generation = generation,
        .peer = peer,
        .request_id = request.requestId(),
        .expected = expected,
        .request = undefined,
        .request_length = @intCast(request_bytes.len),
        .deadline_ms = deadline_ms,
        .remote_public_key = remote_public_key.*,
    };
    @memcpy(entry.request[0..request_bytes.len], request_bytes);
    self.entries[index] = entry;
    self.next_generations[index] = successor;
    self.next_deadline_ms = @min(self.next_deadline_ms orelse deadline_ms, deadline_ms);
    return .{ .index = @intCast(index), .generation = generation };
}

pub fn remotePublicKey(self: *const CallTable, handle: Handle) ?[33]u8 {
    const entry = self.get(handle) orelse return null;
    return entry.remote_public_key;
}

pub fn requestBytes(self: *const CallTable, handle: Handle) ?[]const u8 {
    const entry = self.get(handle) orelse return null;
    return entry.request[0..entry.request_length];
}

pub fn endpoint(self: *const CallTable, handle: Handle) ?types.Endpoint {
    const entry = self.get(handle) orelse return null;
    return entry.peer;
}

pub fn isPeerBusy(self: *const CallTable, node_id: *const types.NodeId) bool {
    return self.findNode(node_id) != null;
}

pub fn nextDeadlineMs(self: *const CallTable) ?u64 {
    return self.next_deadline_ms;
}

/// Endpoint matching grants only bounded receive admission; responses still need authentication
/// and request matching. Unsent and expired calls grant no allowance.
pub fn expectsResponseFrom(self: *const CallTable, address: *const types.Address, now_ms: u64) bool {
    if (self.next_deadline_ms == null) return false;
    for (self.entries) |slot| {
        const entry = slot orelse continue;
        if (entry.sent and now_ms < entry.deadline_ms and entry.peer.address.eql(address.*)) return true;
    }
    return false;
}

fn refreshDeadline(self: *CallTable) void {
    var next: ?u64 = null;
    for (self.entries) |slot| {
        const entry = slot orelse continue;
        next = @min(next orelse entry.deadline_ms, entry.deadline_ms);
    }
    self.next_deadline_ms = next;
}

/// Records the nonce the packet carried. A WHOAREYOU is matched back to its call by that nonce.
pub fn markSent(
    self: *CallTable,
    handle: Handle,
    sent_nonce: *const [constants.nonce_size]u8,
    deadline_ms: u64,
) Error!void {
    const entry = self.getMut(handle) orelse return error.StaleHandle;
    if (self.findNonce(entry.peer.address, sent_nonce, handle) != null)
        return error.NonceInUse;
    entry.sent_nonce = sent_nonce.*;
    entry.sent = true;
    entry.deadline_ms = deadline_ms;
    self.refreshDeadline();
}

/// Claims the live call whose packet carried `nonce` for one handshake attempt. Returns null
/// when no live call matches.
pub fn acceptChallenge(
    self: *CallTable,
    address: types.Address,
    nonce: *const [constants.nonce_size]u8,
    now_ms: u64,
) Error!?Handle {
    const index = self.findNonce(address, nonce, null) orelse return null;
    const entry = &self.entries[index].?;
    if (now_ms >= entry.deadline_ms) return null;
    if (entry.handshake_attempted) return error.HandshakeAttempted;
    entry.handshake_attempted = true;
    return .{ .index = @intCast(index), .generation = entry.generation };
}

/// Runs every check that can fail without touching state, so callers can validate NODES
/// records between `match` and `accept`.
pub fn match(
    self: *const CallTable,
    peer: types.Endpoint,
    response: *const message.Message,
    now_ms: u64,
) Error!Handle {
    const index = self.findPeer(peer) orelse return error.UnknownCall;
    const entry = &self.entries[index].?;
    if (now_ms >= entry.deadline_ms) return error.CallExpired;
    const response_id = response.requestId();
    if (!std.mem.eql(u8, entry.request_id.slice(), response_id.slice()))
        return error.RequestIdMismatch;
    if (!expectsResponse(entry.expected, response)) return error.UnexpectedResponse;
    if (response.* == .nodes) {
        try validateNodesHeader(&entry.expected.nodes, response.nodes.total);
    }
    return .{ .index = @intCast(index), .generation = entry.generation };
}

/// Selects new identities at requested distances without advancing the call. Authenticate
/// selected records before accept; unsigned claims may only exclude work.
pub fn selectNodes(self: *const CallTable, handle: Handle, node_ids: []const types.NodeId) Error!AcceptedNodes {
    const entry = self.get(handle) orelse return error.StaleHandle;
    if (entry.expected != .nodes) return error.UnexpectedResponse;
    if (node_ids.len > types.findnode_result_max) return error.InvalidNodeCount;
    const state = &entry.expected.nodes;
    var selected = AcceptedNodes.empty;
    for (node_ids, 0..) |*node_id, index| {
        if (state.accepted + selected.count() == types.findnode_result_max) break;
        if (!state.distances.isSet(types.logDistance(&entry.peer.node_id, node_id))) continue;
        if (containsNode(state.seen[0..state.accepted], node_id)) continue;
        if (containsNode(node_ids[0..index], node_id)) continue;
        selected.set(index);
    }
    return selected;
}

/// Applies a matched response. A non-terminal NODES fragment keeps the entry open, and
/// `accepted_nodes` marks the records that were new and at a requested distance.
pub fn accept(
    self: *CallTable,
    handle: Handle,
    response: *const message.Message,
    node_ids: []const types.NodeId,
    nonce: *const [constants.nonce_size]u8,
) Error!MatchResult {
    const entry = self.getMut(handle) orelse return error.StaleHandle;
    if (!expectsResponse(entry.expected, response)) return error.UnexpectedResponse;
    const index: usize = handle.index;
    return switch (response.*) {
        .pong => |pong| self.complete(index, handle, .{ .pong = pong }),
        .talk_response => |talk| self.complete(
            index,
            handle,
            .{ .talk_response = talk },
        ),
        .nodes => |nodes| try self.acceptNodes(index, handle, nodes, node_ids, nonce),
        else => unreachable,
    };
}

pub fn checkResponseNonce(
    self: *const CallTable,
    handle: Handle,
    nonce: *const [constants.nonce_size]u8,
) Error!void {
    const entry = self.get(handle) orelse return error.StaleHandle;
    if (entry.expected != .nodes) return;
    const state = &entry.expected.nodes;
    for (state.nonces[0..state.received]) |*seen| {
        if (std.mem.eql(u8, seen, nonce)) return error.DuplicateResponse;
    }
}

pub fn cancel(self: *CallTable, handle: Handle) bool {
    const index: usize = handle.index;
    if (index >= self.entries.len) return false;
    const entry = self.entries[index] orelse return false;
    if (entry.generation != handle.generation) return false;
    clearEntry(&self.entries[index]);
    self.refreshDeadline();
    return true;
}

/// Removes calls past their deadline, at most `out.len` per invocation. The rest wait for the
/// next tick.
pub fn expire(self: *CallTable, now_ms: u64, out: []Expired) usize {
    if (now_ms < (self.next_deadline_ms orelse return 0)) return 0;
    var expired_count: usize = 0;
    for (self.entries, 0..) |*slot, index| {
        if (expired_count == out.len) break;
        const entry = slot.* orelse continue;
        if (now_ms < entry.deadline_ms) continue;
        out[expired_count] = .{
            .handle = .{
                .index = @intCast(index),
                .generation = entry.generation,
            },
            .peer = entry.peer,
        };
        expired_count += 1;
        clearEntry(slot);
    }
    self.refreshDeadline();
    return expired_count;
}

pub fn count(self: *const CallTable) usize {
    var result: usize = 0;
    for (self.entries) |entry| if (entry != null) {
        result += 1;
    };
    return result;
}

fn acceptNodes(
    self: *CallTable,
    index: usize,
    handle: Handle,
    nodes: message.Nodes,
    node_ids: []const types.NodeId,
    nonce: *const [constants.nonce_size]u8,
) Error!MatchResult {
    if (node_ids.len != nodes.enrs.len or node_ids.len > types.findnode_result_max)
        return error.InvalidNodeCount;
    const state = &self.entries[index].?.expected.nodes;
    try self.checkResponseNonce(handle, nonce);
    try validateNodesHeader(state, nodes.total);
    const total: u8 = @intCast(nodes.total);

    var accepted_nodes = AcceptedNodes.empty;
    for (node_ids, 0..) |*node_id, node_index| {
        if (state.accepted == types.findnode_result_max) break;
        const distance = types.logDistance(&self.entries[index].?.peer.node_id, node_id);
        if (!state.distances.isSet(distance)) continue;
        if (containsNode(state.seen[0..state.accepted], node_id)) continue;
        state.seen[state.accepted] = node_id.*;
        state.accepted += 1;
        accepted_nodes.set(node_index);
    }

    state.total = total;
    state.nonces[state.received] = nonce.*;
    state.received += 1;
    const terminal = state.received == total or
        state.accepted == types.findnode_result_max;
    const result = MatchResult{
        .matched = .{
            .handle = handle,
            .response = .{ .nodes = nodes },
            .terminal = terminal,
        },
        .accepted_nodes = accepted_nodes,
    };
    if (terminal) {
        clearEntry(&self.entries[index]);
        self.refreshDeadline();
    }
    return result;
}

fn complete(
    self: *CallTable,
    index: usize,
    handle: Handle,
    response: Response,
) MatchResult {
    clearEntry(&self.entries[index]);
    self.refreshDeadline();
    return .{ .matched = .{
        .handle = handle,
        .response = response,
        .terminal = true,
    } };
}

fn availableIndex(self: *const CallTable) Error!usize {
    for (self.entries, 0..) |entry, index| if (entry == null) return index;
    return error.TableFull;
}

fn get(self: *const CallTable, handle: Handle) ?*const Entry {
    const index: usize = handle.index;
    if (index >= self.entries.len) return null;
    const entry = if (self.entries[index]) |*value| value else return null;
    if (entry.generation != handle.generation) return null;
    return entry;
}

fn getMut(self: *CallTable, handle: Handle) ?*Entry {
    const index: usize = handle.index;
    if (index >= self.entries.len) return null;
    const entry = if (self.entries[index]) |*value| value else return null;
    if (entry.generation != handle.generation) return null;
    return entry;
}

fn findPeer(self: *const CallTable, peer: types.Endpoint) ?usize {
    for (self.entries, 0..) |entry, index| {
        const stored = entry orelse continue;
        if (!stored.sent) continue;
        if (stored.peer.eql(&peer)) return index;
    }
    return null;
}

fn findNode(self: *const CallTable, node_id: *const types.NodeId) ?usize {
    for (self.entries, 0..) |entry, index| {
        const stored = entry orelse continue;
        if (std.mem.eql(u8, &stored.peer.node_id, node_id)) return index;
    }
    return null;
}

fn findNonce(
    self: *const CallTable,
    address: types.Address,
    nonce: *const [constants.nonce_size]u8,
    excluded: ?Handle,
) ?usize {
    for (self.entries, 0..) |entry, index| {
        const stored = entry orelse continue;
        if (!stored.sent) continue;
        if (excluded) |handle| {
            if (index == handle.index and stored.generation == handle.generation) continue;
        }
        if (!stored.peer.address.eql(address)) continue;
        if (std.mem.eql(u8, &stored.sent_nonce, nonce)) return index;
    }
    return null;
}

fn expectedResponse(request: *const message.Message) Error!Expected {
    return switch (request.*) {
        .ping => .pong,
        .find_node => |find_node| blk: {
            if (find_node.distances.len > types.distance_count)
                return error.InvalidMessage;
            var distances = std.StaticBitSet(types.distance_count).empty;
            for (find_node.distances) |distance| {
                if (distance > types.distance_max) return error.InvalidMessage;
                distances.set(distance);
            }
            break :blk .{ .nodes = .{ .distances = distances } };
        },
        .talk_request => .talk_response,
        else => error.InvalidRequest,
    };
}

fn expectsResponse(expected: Expected, response: *const message.Message) bool {
    return switch (response.*) {
        .pong => expected == .pong,
        .nodes => expected == .nodes,
        .talk_response => expected == .talk_response,
        else => false,
    };
}

fn containsNode(nodes: []const types.NodeId, target: *const types.NodeId) bool {
    for (nodes) |*node| if (std.mem.eql(u8, node, target)) return true;
    return false;
}

fn validateNodesHeader(state: *const NodesState, total_value: u64) Error!void {
    if (total_value == 0 or total_value > types.findnode_response_packets_max)
        return error.InvalidResponseCount;
    const total: u8 = @intCast(total_value);
    if (state.total != 0 and state.total != total) return error.InvalidResponseCount;
    if (state.received >= total) return error.InvalidResponseCount;
}

fn clearEntry(entry: *?Entry) void {
    if (entry.*) |*stored| {
        std.crypto.secureZero(u8, stored.request[0..stored.request_length]);
    }
    entry.* = null;
}

comptime {
    std.debug.assert(@sizeOf(Entry) <= 2_304);
    std.debug.assert(@sizeOf(CallTable) <= 48);
}

test {
    _ = @import("call_table_test.zig");
}
