//! A Lookup is one iterative FINDNODE walk toward a target. It holds only candidates and call
//! handles, while deadlines and response accumulation stay in the call table.

const std = @import("std");
const address_policy = @import("address_policy.zig");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const enr = @import("identity/enr.zig");
const RoutingTable = @import("RoutingTable.zig");
const types = @import("types.zig");
const message = @import("wire/message.zig");

pub const result_max: usize = RoutingTable.bucket_size;
pub const parallelism: usize = 3;
pub const request_distance_count: usize = 3;
pub const candidate_capacity: usize = RoutingTable.table_capacity;
pub const discovered_port_min: u16 = 1_025;

pub const Error = Engine.Error || error{
    InvalidSeed,
    TooManySeeds,
    UnexpectedResponse,
    UnknownQuery,
};

pub const FinishReason = enum {
    converged,
    exhausted,
    budget_exhausted,
    cancelled,
};

pub const Statistics = struct {
    queries_started: u16,
    /// Saturating count of admissible records dropped at capacity, including repeated drops.
    capacity_drops: u32,
};

const State = union(enum) {
    unqueried,
    waiting: CallTable.Handle,
    succeeded,
    failed,
};

pub const Candidate = struct {
    peer: types.Endpoint,
    record: enr.Record,
    state: State,
    eligible_families: u2,
    attempted_families: u2 = 0,
};

/// The caller keeps context at a stable address until the lookup is cancelled or finished.
pub const Filter = struct {
    context: *const anyopaque,
    matches: *const fn (*const anyopaque, *const enr.Record) bool,
};

pub const Candidates = [candidate_capacity]Candidate;

const Lookup = @This();

local_id: types.NodeId,
target: types.NodeId,
candidates: *Candidates,
candidate_count: u16,
waiting_count: u8,
queries_started: u16,
capacity_drops: u32,
finish_reason: ?FinishReason,
filter: ?Filter = null,
ip_mode: types.Mode = .dual,
query_limit: u16 = candidate_capacity,

/// Borrows `candidates` for the life of the lookup and allocates nothing.
pub fn init(
    self: *Lookup,
    candidates: *Candidates,
    local_id: types.NodeId,
    target: types.NodeId,
    seeds: []const RoutingTable.Entry,
    ip_mode: types.Mode,
) Error!void {
    if (seeds.len > result_max) return error.TooManySeeds;
    self.* = .{
        .local_id = local_id,
        .ip_mode = ip_mode,
        .target = target,
        .candidates = candidates,
        .candidate_count = 0,
        .waiting_count = 0,
        .queries_started = 0,
        .capacity_drops = 0,
        .finish_reason = null,
    };
    for (seeds) |*seed| try self.addSeed(seed);
}

pub fn candidateCount(self: *const Lookup) usize {
    return self.candidate_count;
}

pub fn waitingCount(self: *const Lookup) usize {
    std.debug.assert(self.waiting_count <= parallelism);
    return self.waiting_count;
}

pub fn isFinished(self: *const Lookup) bool {
    return self.finish_reason != null;
}

pub fn finishReason(self: *const Lookup) ?FinishReason {
    return self.finish_reason;
}

pub fn statistics(self: *const Lookup) Statistics {
    return .{ .queries_started = self.queries_started, .capacity_drops = self.capacity_drops };
}

/// Starts at most one call to the closest eligible unqueried candidate. Busy peers remain
/// candidates for a later call, so a temporarily blocked lookup does not finish.
pub fn startNext(
    self: *Lookup,
    core: *Engine,
    out: []u8,
    request_id: message.RequestId,
    now_ms: u64,
    entropy: *const Engine.StartEntropy,
) Error!?Engine.OutboundCall {
    if (self.isFinished() or self.waiting_count == parallelism) return null;
    std.debug.assert(self.query_limit > 0 and self.query_limit <= candidate_capacity);
    if (self.queries_started >= self.query_limit) {
        if (self.waiting_count == 0) self.finish_reason = .budget_exhausted;
        return null;
    }
    const index = self.nextCandidateIndex(core) orelse {
        if (self.waiting_count == 0 and self.nextCandidateIndex(null) == null) {
            self.finish_reason = if (self.capacity_drops > 0)
                .budget_exhausted
            else if (self.successBoundary() != null)
                .converged
            else
                .exhausted;
        }
        return null;
    };
    const candidate = &self.candidates[index];
    const distances = requestDistances(&self.target, &candidate.peer.node_id);
    const request = message.Message{ .find_node = .{
        .request_id = request_id,
        .distances = &distances,
    } };
    const started = try core.startCall(
        out,
        candidate.peer,
        &candidate.record,
        &request,
        now_ms,
        entropy,
    );
    candidate.attempted_families |= familyBit(candidate.peer.address);
    candidate.state = .{ .waiting = started.handle };
    self.waiting_count += 1;
    self.queries_started += 1;
    std.debug.assert(self.queries_started <= candidate_capacity);
    return .{ .call = started, .peer = candidate.peer };
}

/// Adds discovered records as candidates and, on the terminal fragment, confirms the responder
/// in routing.
pub fn onEvent(
    self: *Lookup,
    core: *Engine,
    event: *const Engine.Event,
    now_ms: u64,
) Error!Engine.Event.Consumption {
    const response = switch (event.*) {
        .response => |*response| response,
        .failed => |failed| return .{ .consumed = self.onFailure(core, failed.handle) },
        else => return .{},
    };
    const index = self.waitingIndex(response.matched.handle) orelse return .{};
    errdefer self.failCandidate(core, index, response.matched.handle);
    if (response.matched.response != .nodes) return error.UnexpectedResponse;
    if (!response.peer.eql(&self.candidates[index].peer))
        return error.UnknownQuery;
    const result = Engine.Event.Consumption{
        .consumed = true,
        .responder = if (response.matched.terminal) self.candidates[index].record else null,
    };
    const source = response.peer.address;
    for (response.node_records) |*record| self.addDiscovered(record, source);
    if (!response.matched.terminal) return result;

    self.candidates[index].state = .succeeded;
    self.waiting_count -= 1;
    const candidate = &self.candidates[index];
    _ = core.confirmPeer(
        &candidate.peer,
        &candidate.record,
        now_ms,
    ) catch {};
    return result;
}

pub fn onFailure(
    self: *Lookup,
    core: *Engine,
    handle: CallTable.Handle,
) bool {
    const index = self.waitingIndex(handle) orelse return false;
    self.failCandidate(core, index, handle);
    return true;
}

fn failCandidate(self: *Lookup, core: *Engine, index: usize, handle: CallTable.Handle) void {
    _ = core.cancelCall(handle);
    const candidate = &self.candidates[index];
    candidate.state = .failed;
    for (candidate.record.endpoints()) |endpoint| {
        const address = endpoint orelse continue;
        const family = familyBit(address);
        if (candidate.eligible_families & family == 0 or candidate.attempted_families & family != 0) continue;
        candidate.peer.address = address;
        candidate.state = .unqueried;
        break;
    }
    self.waiting_count -= 1;
}

pub fn cancel(self: *Lookup, core: *Engine) void {
    if (self.isFinished()) return;
    for (self.activeCandidatesMut()) |*candidate| switch (candidate.state) {
        .waiting => |handle| {
            _ = core.cancelCall(handle);
            candidate.state = .failed;
        },
        else => {},
    };
    self.waiting_count = 0;
    self.finish_reason = .cancelled;
}

fn addSeed(self: *Lookup, seed: *const RoutingTable.Entry) Error!void {
    if (!std.mem.eql(u8, &seed.peer.node_id, &seed.record.node_id))
        return error.InvalidSeed;
    if (std.mem.eql(u8, &seed.peer.node_id, &self.local_id)) return;
    if (self.findCandidate(&seed.peer.node_id) != null) return;
    var peer = seed.peer;
    if (!self.ip_mode.supports(peer.address)) peer.address = seed.record.endpointFor(self.ip_mode) orelse return;
    self.appendCandidate(peer, &seed.record, self.eligibleFamilies(&seed.record, seed.peer.address, 0));
}

fn addDiscovered(
    self: *Lookup,
    record: *const enr.Record,
    source: types.Address,
) void {
    if (std.mem.eql(u8, &record.node_id, &self.local_id)) return;
    const eligible = self.eligibleFamilies(record, source, discovered_port_min);
    const address = for (record.endpoints()) |candidate| {
        const address = candidate orelse continue;
        if (eligible & familyBit(address) != 0) break address;
    } else return;
    if (self.findCandidate(&record.node_id)) |index| {
        const candidate = &self.candidates[index];
        if (candidate.state == .unqueried and candidate.attempted_families == 0 and
            record.sequence > candidate.record.sequence)
        {
            candidate.peer.address = address;
            candidate.record = record.*;
            candidate.eligible_families = eligible;
        }
        return;
    }
    if (self.candidate_count == candidate_capacity) {
        self.capacity_drops +|= 1;
        return;
    }
    self.appendCandidate(.{ .node_id = record.node_id, .address = address }, record, eligible);
}

fn appendCandidate(
    self: *Lookup,
    peer: types.Endpoint,
    record: *const enr.Record,
    eligible_families: u2,
) void {
    std.debug.assert(self.candidate_count < candidate_capacity);
    self.candidates[self.candidate_count] = .{
        .peer = peer,
        .record = record.*,
        .state = .unqueried,
        .eligible_families = eligible_families,
    };
    self.candidate_count += 1;
}

fn eligibleFamilies(self: *const Lookup, record: *const enr.Record, source: types.Address, port_min: u16) u2 {
    var mask: u2 = 0;
    for (record.endpoints()) |endpoint| {
        const address = endpoint orelse continue;
        if (self.ip_mode.supports(address) and address.port() >= port_min and address_policy.relayAllowed(source, address))
            mask |= familyBit(address);
    }
    return mask;
}

fn familyBit(address: types.Address) u2 {
    return switch (address) {
        .ip4 => 1,
        .ip6 => 2,
    };
}

fn nextCandidateIndex(self: *const Lookup, core: ?*const Engine) ?usize {
    const boundary = self.successBoundary();
    var selected: ?usize = null;
    var selected_preferred = false;
    for (self.activeCandidates(), 0..) |*candidate, index| {
        if (candidate.state != .unqueried) continue;
        if (!self.ip_mode.supports(candidate.peer.address)) continue;
        if (boundary) |node_id| {
            if (!types.xorCloser(&candidate.peer.node_id, &node_id, &self.target))
                continue;
        }
        if (core) |engine| {
            if (engine.isPeerBusy(&candidate.peer.node_id)) continue;
        }
        const preferred = self.matches(&candidate.record);
        if (selected) |previous| {
            if (!preferred and selected_preferred) continue;
            if (preferred == selected_preferred and !types.xorCloser(
                &candidate.peer.node_id,
                &self.candidates[previous].peer.node_id,
                &self.target,
            )) continue;
        }
        selected = index;
        selected_preferred = preferred;
    }
    return selected;
}

// Only matching successes count toward convergence for a filtered lookup.
fn successBoundary(self: *const Lookup) ?types.NodeId {
    var closest: [result_max]*const Candidate = undefined;
    var length: usize = 0;
    for (self.activeCandidates()) |*candidate| {
        if (candidate.state != .succeeded or !self.matches(&candidate.record)) continue;
        length = types.insertClosest(
            *const Candidate,
            candidateNodeId,
            &closest,
            length,
            candidate,
            &self.target,
        );
    }
    if (length < result_max) return null;
    return closest[result_max - 1].peer.node_id;
}

fn matches(self: *const Lookup, record: *const enr.Record) bool {
    const filter = self.filter orelse return true;
    return filter.matches(filter.context, record);
}

fn findCandidate(
    self: *const Lookup,
    node_id: *const types.NodeId,
) ?usize {
    for (self.activeCandidates(), 0..) |*candidate, index| {
        if (std.mem.eql(u8, &candidate.peer.node_id, node_id)) return index;
    }
    return null;
}

fn waitingIndex(self: *const Lookup, handle: CallTable.Handle) ?usize {
    for (self.activeCandidates(), 0..) |*candidate, index| switch (candidate.state) {
        .waiting => |stored| if (std.meta.eql(stored, handle)) return index,
        else => {},
    };
    return null;
}

fn activeCandidates(self: *const Lookup) []const Candidate {
    return self.candidates[0..self.candidate_count];
}

fn activeCandidatesMut(self: *Lookup) []Candidate {
    return self.candidates[0..self.candidate_count];
}

/// Returns the target's distance from `destination` together with the nearest distance on
/// either side, so one query covers the bucket and its neighbours.
pub fn requestDistances(
    target: *const types.NodeId,
    destination: *const types.NodeId,
) [request_distance_count]u16 {
    const center: usize = types.logDistance(target, destination);
    var result: [request_distance_count]u16 = undefined;
    result[0] = @intCast(center);
    var count: usize = 1;
    for (1..257) |offset| {
        if (count == result.len) break;
        if (center + offset <= 256) {
            result[count] = @intCast(center + offset);
            count += 1;
        }
        if (count == result.len) break;
        if (center > offset) {
            result[count] = @intCast(center - offset);
            count += 1;
        }
    }
    std.debug.assert(count == result.len);
    return result;
}

fn candidateNodeId(candidate: *const *const Candidate) *const types.NodeId {
    return &candidate.*.peer.node_id;
}

comptime {
    std.debug.assert(result_max == 16);
    std.debug.assert(candidate_capacity == 272);
    std.debug.assert(parallelism > 0);
    std.debug.assert(parallelism <= std.math.maxInt(u8));
    std.debug.assert(request_distance_count > 0);
    std.debug.assert(request_distance_count < types.distance_count);
    std.debug.assert(@sizeOf(Candidate) <= 512);
    std.debug.assert(@sizeOf(Lookup) <= 128);
}

test {
    _ = @import("lookup_test.zig");
}
