const std = @import("std");
pub const ForkSeq = @import("config").ForkSeq;

pub const Peer = [128]u8;
pub const policy = @import("limits.zig");
const lists = @import("index_list.zig");
const SourceUsage = struct {
    items: [policy.kind_count]usize = @splat(0),
    bytes: [policy.kind_count]usize = @splat(0),
    waiting: [policy.kind_count]u16 = @splat(0),
    total: usize = 0,
    drop_before: u64 = 0,
};
const Groups = @import("groups.zig").Groups;
const Dependencies = @import("dependencies.zig").Dependencies;
const none = lists.none;
const state_count = @typeInfo(State).@"enum".fields.len;
const metadata_mod = @import("metadata.zig");
pub const Kind = policy.Kind;
const assert = std.debug.assert;
pub const batch_max = 64;
pub const dependency_search_slots = .{ .past = 2, .future = 1 };
pub const batch_bytes = 16 * 1024 * 1024;
pub const payload_max = 16 * 1024 * 1024;
comptime {
    assert(payload_max <= batch_bytes);
}

cells: []Cell,
backing: std.mem.Allocator,
occupied: usize = 0,
ages: [policy.kind_count]lists.List = @splat(.{}),
order: u64 = 0,
queues: [policy.kind_count][state_count]lists.List = @splat(@splat(.{})),
ready: [policy.kind_count]lists.List = @splat(.{}),
expiry: lists.List = .{},
groups: Groups,
dependencies: Dependencies,

limits: policy.Limits,
execution: policy.Limits,
slot: u64 = 0,
last_now: u64 = 0,
prune_cursor: usize = 0,
prune_remaining: usize = 0,
drop_before: u64 = 0,
closed: bool = false,
capacity_drops: [policy.kind_count]u64 = @splat(0),
used_bytes: [policy.kind_count]usize = @splat(0),
waiting_items: [policy.kind_count]usize = @splat(0),
executing_items: [policy.kind_count]usize = @splat(0),
executing_bytes: [policy.kind_count]usize = @splat(0),

sources: std.AutoHashMapUnmanaged(Peer, SourceUsage) = .empty,
/// The victims `admit` selects and retires within one call. Fields rather than locals so
/// ReleaseSafe does not fill them for every admission.
victims: [batch_max]u32 = undefined,

pub const Token = struct { index: u16, generation: u64 };
pub const State = enum { free, needs_check, checking, waiting, queued, copying, delivered };
pub const Cell = struct {
    state: State = .free,
    generation: u64 = 0,
    /// Original admission order survives dependency promotion.
    order: u64 = 0,
    peer: Peer = undefined,
    context: []const u8 = &.{},

    fork_digest: [4]u8 = @splat(0),
    deadline: u64 = 0,
    admitted_ms: u64 = 0,
    input: []const u8 = &.{},
    kind: Kind = .beacon_block,
    metadata: metadata_mod.Metadata = .{},
    check_notification: u64 = 0,
    state_link: lists.Link = .{},
    ready_link: lists.Link = .{},
    expiry_link: lists.Link = .{},
    group_link: lists.Link = .{},
    root_link: lists.Link = .{},
    group_index: u32 = none,
    root_index: u32 = none,
    deneb: bool = false,
    executing: bool = false,
    execution_bytes: usize = 0,
    source_charge: usize = 0,
    retired: bool = false,
    age_link: lists.Link = .{},

    pub fn replaceable(self: *const Cell) bool {
        if (self.executing or self.retired) return false;
        return switch (self.state) {
            .queued, .needs_check, .checking, .waiting => true,
            else => false,
        };
    }
};
pub const Job = struct { start: usize, len: usize };
pub const Batch = struct {
    tokens: [batch_max]Token = undefined,
    len: usize = 0,
    jobs: [batch_max]Job = undefined,
    job_count: usize = 0,
};
const GossipProcessor = @This();

pub fn init(backing: std.mem.Allocator, limits: policy.Limits, seed: u64) !GossipProcessor {
    try policy.validate(&limits);
    const capacity = policy.items(&limits);
    const cells = try backing.alloc(Cell, capacity);
    errdefer backing.free(cells);
    @memset(cells, .{});
    var groups = try Groups.init(backing, limits[@intFromEnum(Kind.beacon_attestation)].items);
    errdefer groups.deinit(backing);
    var dependencies = try Dependencies.init(backing, capacity);
    errdefer dependencies.deinit(backing);
    var execution = limits;
    for (&execution) |*limit| limit.items = @max(1, limit.items / 2);
    var self: GossipProcessor = .{
        .cells = cells,
        .backing = backing,
        .groups = groups,
        .dependencies = dependencies,
        .limits = limits,
        .execution = execution,
    };
    self.groups.index.seed = seed ^ 3;
    self.dependencies.index.seed = seed ^ 4;
    var k: usize = 0;
    var end: usize = limits[0].items;
    for (cells, 0..) |*cell, i| {
        if (i == end) {
            k += 1;
            end += limits[k].items;
        }
        cell.kind = @enumFromInt(k);
        self.queues[k][@intFromEnum(State.free)].append(cells, "state_link", @intCast(i));
    }
    return self;
}
/// The owner must exclude concurrent admissions and claims during teardown.
pub fn deinit(self: *GossipProcessor) void {
    self.close();
    for (self.cells, 0..) |cell, i| if (cell.state == .copying) {
        self.transition(@intCast(i), .delivered);
        self.retire(self.token(@intCast(i)));
    };
    assert(self.occupied == 0);
    self.backing.free(self.cells);
    self.groups.deinit(self.backing);
    self.dependencies.deinit(self.backing);
    self.sources.deinit(self.backing);
}
fn queue(self: *GossipProcessor, kind: Kind, state: State) *lists.List {
    return &self.queues[@intFromEnum(kind)][@intFromEnum(state)];
}
fn queueValue(self: *const GossipProcessor, kind: Kind, state: State) lists.List {
    return self.queues[@intFromEnum(kind)][@intFromEnum(state)];
}
fn token(self: *const GossipProcessor, index: u32) Token {
    return .{ .index = @intCast(index), .generation = self.cells[index].generation };
}
pub fn get(self: *GossipProcessor, handle: Token) ?*Cell {
    if (handle.index >= self.cells.len) return null;
    const cell = &self.cells[handle.index];
    return if (cell.state != .free and cell.generation == handle.generation) cell else null;
}
fn indexOf(self: *const GossipProcessor, cell: *const Cell) u32 {
    return @intCast((@intFromPtr(cell) - @intFromPtr(self.cells.ptr)) / @sizeOf(Cell));
}
pub const Input = struct {
    peer: Peer,
    kind: Kind,
    fork: ForkSeq,
    digest: [4]u8,
    context: []const u8,
    bytes: []const u8,
    slot: u64,
    latest: ?u64 = null,
    now: u64,
    deadline: u64,
};

/// The adapter supplies serialized ingress time and a common validation timeout.
pub fn admit(self: *GossipProcessor, input: Input) !bool {
    const kind = input.kind;
    const k = @intFromEnum(kind);
    if (self.closed or input.now >= input.deadline or input.bytes.len > payload_max or input.context.len > policy.context_max) return false;
    const cost = input.bytes.len + input.context.len;
    if (self.expiry.tail != none and self.cells[self.expiry.tail].deadline > input.deadline) return error.UnorderedDeadline;
    const metadata = metadata_mod.extract(kind, input.fork, input.bytes);
    const deneb = input.fork.gte(.deneb);
    if (input.latest) |latest| if (metadata.slot) |slot| {
        if (slot > latest +| @intFromBool(kind == .execution_payload_bid)) return false;
    };
    if (!metadata_mod.eligible(&metadata, kind, deneb, input.slot)) return false;
    const limit = self.limits[k];
    if (self.sources.getPtr(input.peer)) |source| {
        if (source.items[k] >= policy.sourceItems(kind, limit) or cost > @max(limit.bytes / 2, payload_max + policy.context_max) -| source.bytes[k]) {
            self.capacity_drops[k] +|= 1;
            return false;
        }
    }
    const order = try std.math.add(u64, self.order, 1);
    var free = self.queueValue(kind, .free).len;
    var used = self.used_bytes[k];
    var victims: usize = 0;
    var index = self.ages[k].head;
    var visited: usize = 0;
    while (free == 0 or cost > limit.bytes -| used) {
        if (!policy.newestFirst(kind) or index == none or visited == batch_max) {
            self.capacity_drops[k] +|= 1;
            return false;
        }
        visited += 1;
        const cell = &self.cells[index];
        if (cell.replaceable()) {
            self.victims[victims] = index;
            victims += 1;
            free += @intFromBool(cell.generation < std.math.maxInt(u48));
            used -= cell.input.len + cell.context.len;
        }
        index = cell.age_link.next;
    }
    const bytes = try self.backing.dupe(u8, input.bytes);
    errdefer self.backing.free(bytes);
    const context = try self.backing.dupe(u8, input.context);
    errdefer self.backing.free(context);
    try self.sources.ensureUnusedCapacity(self.backing, 1);
    for (self.victims[0..victims]) |victim| self.retire(self.token(victim));
    self.capacity_drops[k] +|= victims;
    index = self.queueValue(kind, .free).head;
    const cell = &self.cells[index];
    cell.* = .{
        .generation = cell.generation + 1,
        .state_link = cell.state_link,
        .order = order,
        .kind = kind,
        .input = bytes,
        .context = context,
        .metadata = metadata,
        .fork_digest = input.digest,
        .deneb = deneb,
        .peer = input.peer,
        .deadline = input.deadline,
        .admitted_ms = input.now,
        .source_charge = cost,
    };
    const row = self.sources.getOrPutAssumeCapacity(input.peer);
    if (!row.found_existing) row.value_ptr.* = .{};
    row.value_ptr.items[k] += 1;
    row.value_ptr.bytes[k] += cost;
    row.value_ptr.total += 1;
    self.ages[k].append(self.cells, "age_link", index);
    self.used_bytes[k] += cost;
    self.occupied += 1;
    self.order = order;
    self.expiry.append(self.cells, "expiry_link", index);
    self.transition(index, if (metadata.root != null) .needs_check else .queued);
    return true;
}
fn transition(self: *GossipProcessor, index: u32, state: State) void {
    const cell = &self.cells[index];
    const previous = cell.state;
    const k = @intFromEnum(cell.kind);
    if (previous == .queued) {
        if (cell.group_index != none) self.groups.leave(self.cells, index, self.last_now) else self.ready[k].remove(self.cells, "ready_link", index);
    }
    if (previous == .waiting) {
        self.dependencies.leave(self.cells, index);
        self.waiting_items[k] -= 1;
        self.sources.getPtr(cell.peer).?.waiting[k] -= 1;
    }
    self.queue(cell.kind, previous).remove(self.cells, "state_link", index);
    cell.state = state;
    self.queue(cell.kind, state).append(self.cells, "state_link", index);
    if (state == .queued) {
        if (cell.kind == .beacon_attestation and cell.metadata.group != null) self.groups.join(self.cells, index, self.last_now) else self.ready[k].append(self.cells, "ready_link", index);
    }
    if (state == .waiting) {
        self.dependencies.join(self.cells, index);
        self.waiting_items[k] += 1;
        self.sources.getPtr(cell.peer).?.waiting[k] += 1;
    }
}
fn releasePayload(self: *GossipProcessor, cell: *Cell) void {
    self.used_bytes[@intFromEnum(cell.kind)] -= cell.input.len;
    self.backing.free(cell.input);
    cell.input = &.{};
}
fn releaseExecution(self: *GossipProcessor, cell: *Cell) void {
    if (!cell.executing) return;
    const k = @intFromEnum(cell.kind);
    self.executing_items[k] -= 1;
    self.executing_bytes[k] -= cell.execution_bytes;
    cell.executing = false;
}
pub fn retire(self: *GossipProcessor, handle: Token) void {
    const cell = self.get(handle).?;
    assert(cell.state != .copying);
    if (cell.expiry_link.linked) self.expiry.remove(self.cells, "expiry_link", handle.index);
    self.releasePayload(cell);
    self.releaseExecution(cell);
    self.transition(handle.index, .free);
    self.ages[@intFromEnum(cell.kind)].remove(self.cells, "age_link", handle.index);
    const k = @intFromEnum(cell.kind);
    self.used_bytes[k] -= cell.context.len;
    self.backing.free(cell.context);
    const usage = self.sources.getPtr(cell.peer).?;
    usage.items[k] -= 1;
    usage.bytes[k] -= cell.source_charge;
    usage.total -= 1;
    if (usage.total == 0) {
        const removed = self.sources.remove(cell.peer);
        assert(removed);
    }
    const state = cell.state;
    const generation = cell.generation;
    const kind = cell.kind;
    const link = cell.state_link;
    cell.* = .{ .state = state, .generation = generation, .kind = kind, .state_link = link };
    self.freed(handle.index);
    self.occupied -= 1;
}
/// A cell whose last generation is spent leaves the free list for good.
fn freed(self: *GossipProcessor, index: u32) void {
    const cell = &self.cells[index];
    if (cell.generation == std.math.maxInt(u48)) self.queue(cell.kind, .free).remove(self.cells, "state_link", index);
}
/// Work an exchange can take now: dependency checks, and executable urgent and ordinary jobs.
pub const Work = struct { checks: bool = false, urgent: bool = false, ordinary: bool = false };
/// O(kinds).
pub fn readiness(self: *const GossipProcessor) Work {
    var result: Work = .{};
    if (self.closed) return result;
    for (policy.priority) |kind| {
        if (self.queueValue(kind, .needs_check).len > 0) result.checks = true;
        const index = self.nextKind(kind);
        if (index == none or !self.executable(&self.cells[index])) continue;
        if (policy.urgent(kind)) result.urgent = true else result.ordinary = true;
    }
    return result;
}
pub fn expire(self: *GossipProcessor, now: u64) void {
    self.last_now = @max(self.last_now, now);
    var bytes: usize = 0;
    for (0..batch_max) |_| {
        const index = self.expiry.head;
        if (index == none or self.cells[index].deadline > now) break;
        const cell = &self.cells[index];
        const cost = if (cell.state == .copying or cell.state == .delivered) 0 else cell.input.len;
        if (bytes > 0 and cost > batch_bytes -| bytes) break;
        bytes += cost;
        self.expiry.remove(self.cells, "expiry_link", index);
        cell.retired = true;
        if (cell.state != .copying and cell.state != .delivered) self.retire(self.token(index));
    }
}
pub fn maintain(self: *GossipProcessor, now: u64, slot: u64) void {
    if (self.closed) return;
    self.expire(now);
    self.groups.advance(now, batch_max);
    if (self.slot != slot) {
        self.slot = slot;
        self.prune_remaining = if (self.occupied == 0) 0 else self.cells.len;
    }
    for (0..batch_max) |_| {
        const index = self.dependencies.next() orelse break;
        self.transition(index, .needs_check);
    }
    for (0..@min(batch_max, self.prune_remaining)) |_| {
        const index = self.prune_cursor;
        self.prune_cursor = (self.prune_cursor + 1) % self.cells.len;
        self.prune_remaining -= 1;
        const cell = &self.cells[index];
        switch (cell.state) {
            .needs_check, .waiting, .queued => if (!self.eligible(cell) or self.peerDropped(cell)) self.cancel(cell),
            .checking => if (!self.eligible(cell) or self.peerDropped(cell)) self.cancel(cell),
            else => {},
        }
    }
}
fn eligible(self: *const GossipProcessor, cell: *const Cell) bool {
    return cell.order > self.drop_before and metadata_mod.eligible(&cell.metadata, cell.kind, cell.deneb, self.slot);
}
pub fn close(self: *GossipProcessor) void {
    self.closed = true;
    for (self.cells, 0..) |*cell, i| {
        if (cell.state == .free) continue;
        cell.retired = true;
        if (cell.state != .copying) self.retire(self.token(@intCast(i)));
    }
}
/// One claim's bounds; `ordinary` admits ordinary kinds besides the urgent ones.
pub const Claim = struct { items: usize = batch_max, bytes: usize = batch_bytes, ordinary: bool = true };
/// Whether the kind's execution limits admit `cell`.
fn executable(self: *const GossipProcessor, cell: *const Cell) bool {
    const execution = &self.execution;
    const k = @intFromEnum(cell.kind);
    // A single item may exceed its lane share. It then runs alone, within the per-message limit.
    return self.executing_items[k] < execution[k].items and (self.executing_items[k] == 0 or cell.input.len <= execution[k].bytes -| self.executing_bytes[k]);
}
fn nextKind(self: *const GossipProcessor, kind: Kind) u32 {
    const ready = self.ready[@intFromEnum(kind)];
    const index = if (policy.newestFirst(kind)) ready.tail else ready.head;
    if (kind != .beacon_attestation or self.groups.ready.tail == none) return index;
    const group = self.groups.rows[self.groups.ready.tail].members.tail;
    return if (index == none or self.cells[group].order > self.cells[index].order) group else index;
}
pub fn claim(self: *GossipProcessor, now: u64) Batch {
    return self.claimDemand(now, .{});
}
pub fn claimDemand(self: *GossipProcessor, now: u64, demand: Claim) Batch {
    var batch: Batch = .{};
    if (self.closed) return batch;
    var size: usize = 0;
    var work: usize = 0;
    for (policy.priority) |kind| {
        if (!demand.ordinary and !policy.urgent(kind)) continue;
        for (0..batch_max) |_| {
            if (batch.len >= @min(batch_max, demand.items) or work == batch_max) return batch;
            const index = self.nextKind(kind);
            if (index == none) break;
            const cell = &self.cells[index];
            if (now >= cell.deadline or !self.eligible(cell) or self.peerDropped(cell)) {
                work += 1;
                self.cancel(cell);
                continue;
            }
            if (!self.executable(cell)) break;
            const group = cell.group_index;
            const start = batch.len;
            const group_count = if (group == none) 1 else self.groups.rows[group].members.len;
            for (0..@min(batch_max - work, group_count)) |_| {
                if (batch.len >= @min(batch_max, demand.items)) break;
                const member = if (group == none) index else self.groups.rows[group].members.tail;
                if (now >= self.cells[member].deadline or !self.eligible(&self.cells[member]) or self.peerDropped(&self.cells[member])) {
                    self.cancel(&self.cells[member]);
                    work += 1;
                    continue;
                }
                if (!self.executable(&self.cells[member])) break;
                if (!self.append(&batch, member, &size, demand.bytes)) break;
                work += 1;
            }
            if (batch.len == start) break;
            batch.jobs[batch.job_count] = .{ .start = start, .len = batch.len - start };
            batch.job_count += 1;
        }
    }
    return batch;
}
fn append(self: *GossipProcessor, batch: *Batch, index: u32, size: *usize, limit: usize) bool {
    const cell = &self.cells[index];
    assert(cell.input.len <= batch_bytes);
    // An empty batch takes its first item whatever the host's byte cap, so no item blocks its lane.
    if (batch.len > 0 and cell.input.len > @min(batch_bytes, limit) -| size.*) return false;
    size.* += cell.input.len;
    self.transition(index, .copying);
    cell.executing = true;
    cell.execution_bytes = cell.input.len;
    self.executing_items[@intFromEnum(cell.kind)] += 1;
    self.executing_bytes[@intFromEnum(cell.kind)] += cell.input.len;
    batch.tokens[batch.len] = self.token(index);
    batch.len += 1;
    return true;
}
pub fn claimChecks(self: *GossipProcessor, now: u64, limit: usize) Batch {
    var batch: Batch = .{};
    if (self.closed) return batch;
    var work: usize = 0;
    for (policy.priority) |kind| {
        for (0..batch_max) |_| {
            if (work == @min(batch_max, limit)) return batch;
            const index = self.queueValue(kind, .needs_check).head;
            if (index == none) break;
            work += 1;
            const cell = &self.cells[index];
            if (now >= cell.deadline or !self.eligible(cell) or self.peerDropped(cell)) {
                self.cancel(cell);
                continue;
            }
            self.transition(index, .checking);
            cell.check_notification = self.dependencies.notification;
            batch.tokens[batch.len] = self.token(index);
            batch.len += 1;
        }
    }
    return batch;
}
pub fn classify(self: *GossipProcessor, handle: Token, available: bool) bool {
    const cell = self.get(handle) orelse return false;
    if (cell.state != .checking or cell.retired) return false;
    const searchable = if (cell.metadata.slot) |slot|
        slot >= self.slot -| dependency_search_slots.past and slot <= self.slot +| dependency_search_slots.future
    else
        true;
    if (self.last_now >= cell.deadline or !self.eligible(cell) or self.peerDropped(cell)) {
        self.cancel(cell);
    } else if (available) {
        self.transition(handle.index, .queued);
    } else if (cell.check_notification != self.dependencies.notification or self.dependencies.notification == std.math.maxInt(u64)) {
        self.transition(handle.index, .needs_check);
    } else if (!searchable) {
        self.cancel(cell);
    } else {
        const k = @intFromEnum(cell.kind);
        const peer_full = self.sources.getPtr(cell.peer).?.waiting[k] >= @max(1, self.limits[k].items / 4);
        if (peer_full or self.waiting_items[k] >= self.limits[k].items / 2) {
            self.cancel(cell);
        } else self.transition(handle.index, .waiting);
    }
    return true;
}
pub fn notifyBlock(self: *GossipProcessor, root: [32]u8) void {
    self.dependencies.notify(&root);
}
pub fn cancel(self: *GossipProcessor, cell: *Cell) void {
    assert(!cell.executing);
    self.retire(self.token(self.indexOf(cell)));
}
pub fn queuedForDelivery(self: *const GossipProcessor, cell: *const Cell) bool {
    return cell.state == .queued and self.eligible(cell) and !self.peerDropped(cell);
}
pub fn dropQueued(self: *GossipProcessor) void {
    self.drop_before = self.order;
    self.prune_remaining = if (self.occupied == 0) 0 else self.cells.len;
}
/// Marks the identity's currently captured source work for bounded pruning, not future admissions.
pub fn dropPeer(self: *GossipProcessor, peer: Peer) void {
    if (self.sources.getPtr(peer)) |source| {
        source.drop_before = self.order;
        self.prune_remaining = if (self.occupied == 0) 0 else self.cells.len;
    }
}
fn peerDropped(self: *const GossipProcessor, cell: *const Cell) bool {
    return cell.order <= self.sources.getPtr(cell.peer).?.drop_before;
}
/// Transfers the claimed buffers to the caller while execution remains charged until completion.
pub fn take(self: *GossipProcessor, handle: Token) struct { data: []const u8, context: []const u8 } {
    const cell = self.get(handle).?;
    assert(cell.state == .copying);
    const data = cell.input;
    const context = cell.context;
    self.used_bytes[@intFromEnum(cell.kind)] -= data.len + context.len;
    cell.input = &.{};
    cell.context = &.{};
    return .{ .data = data, .context = context };
}
pub fn finish(self: *GossipProcessor, batch: *const Batch) void {
    for (batch.tokens[0..batch.len]) |handle| {
        const cell = self.get(handle).?;
        assert(cell.state == .copying);
        self.transition(handle.index, .delivered);
        self.releasePayload(cell);
        if (self.closed) self.retire(handle);
    }
}
/// Release the execution reservation once. Only a live claim may send its libp2p verdict.
pub fn complete(self: *GossipProcessor, handle: Token, now: u64) bool {
    const cell = self.get(handle) orelse return false;
    if (cell.state != .delivered) return false;
    const live = !cell.retired and now < cell.deadline;
    self.retire(handle);
    return live;
}
/// Work carried over to the next bounded maintenance turn.
pub fn pending(self: *const GossipProcessor) bool {
    return !self.closed and (self.prune_remaining > 0 or self.dependencies.promoting.len > 0);
}
/// Earliest attestation group or expiry deadline. O(1).
pub fn deadline(self: *const GossipProcessor) ?u64 {
    var result = self.groups.deadline();
    if (self.expiry.head != none) {
        const expiry = self.cells[self.expiry.head].deadline;
        result = @min(result orelse expiry, expiry);
    }
    return result;
}

test {
    _ = metadata_mod;
    _ = @import("gossip_processor_test.zig");
}
