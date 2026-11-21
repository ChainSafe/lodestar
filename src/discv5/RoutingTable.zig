//! Known contacts seed lookups without claiming reachability. Responsive contacts follow them
//! in least-to-most recently verified order. A full bucket holds one pending candidate until
//! a revalidation PING decides whether the incumbent stays.

const std = @import("std");
const address_policy = @import("address_policy.zig");
const enr = @import("identity/enr.zig");
const types = @import("types.zig");

pub const bucket_size: usize = 16;
pub const bucket_count: usize = 17;
pub const table_capacity: usize = bucket_size * bucket_count;
pub const bucket_subnet_limit: usize = 2;
pub const table_subnet_limit: usize = 10;

pub const InitError = std.mem.Allocator.Error;

pub const Error = error{
    AddressLimit,
    IncomingLimit,
    InvalidDistance,
    InvalidRecord,
    InvalidRemoteRecord,
    NoPendingRevalidation,
    SelfEntry,
    TooManyDistances,
};

pub const Direction = enum { incoming, outgoing };

pub const Entry = struct {
    direction: Direction,
    peer: types.Endpoint,
    record: enr.Record,
    last_verified_ms: ?u64,
};

pub const PutResult = union(enum) {
    inserted,
    refreshed,
    updated,
    pending: types.NodeId,
    pending_busy,
};

pub const ResolveResult = union(enum) {
    retained,
    replaced: types.NodeId,
};

const Pending = struct {
    entry: Entry,
    replace_id: types.NodeId,
};

const RoutingTable = @This();

local_id: types.NodeId,
entries: []Entry,
pending: []?Pending,
counts: [bucket_count]u8,
total: u16,

pub fn init(
    self: *RoutingTable,
    allocator: std.mem.Allocator,
    local_id: types.NodeId,
) InitError!void {
    const entries = try allocator.alloc(Entry, table_capacity);
    errdefer allocator.free(entries);
    const pending = try allocator.alloc(?Pending, bucket_count);
    @memset(pending, null);
    self.* = .{
        .local_id = local_id,
        .entries = entries,
        .pending = pending,
        .counts = [_]u8{0} ** bucket_count,
        .total = 0,
    };
}

pub fn deinit(self: *RoutingTable, allocator: std.mem.Allocator) void {
    allocator.free(self.pending);
    allocator.free(self.entries);
    self.* = undefined;
}

pub fn count(self: *const RoutingTable) usize {
    std.debug.assert(self.total <= table_capacity);
    return self.total;
}

pub fn pendingCount(self: *const RoutingTable) usize {
    var count_value: usize = 0;
    for (self.pending) |candidate| {
        if (candidate != null) count_value += 1;
    }
    return count_value;
}

/// Returns the incumbent that a pending candidate is waiting to replace, if there is one.
pub fn revalidationTarget(self: *const RoutingTable) ?Entry {
    for (self.pending, 0..) |candidate, index| {
        const pending = candidate orelse continue;
        const position = self.findInBucket(index, &pending.replace_id) orelse
            unreachable;
        return self.bucketEntries(index)[position];
    }
    return null;
}

pub fn contains(self: *const RoutingTable, node_id: *const types.NodeId) bool {
    const index = bucketIndex(types.logDistance(&self.local_id, node_id));
    return self.findInBucket(index, node_id) != null;
}

pub fn get(self: *const RoutingTable, node_id: *const types.NodeId) ?Entry {
    const index = bucketIndex(types.logDistance(&self.local_id, node_id));
    const position = self.findInBucket(index, node_id) orelse return null;
    return self.bucketEntries(index)[position];
}

/// Visits each slot at most once, starting at and advancing `cursor`. Entries are copied;
/// callers must not mutate the table during a traversal.
pub fn iterate(self: *const RoutingTable, cursor: *usize) Iterator {
    std.debug.assert(cursor.* < table_capacity);
    return .{ .table = self, .cursor = cursor };
}

pub const Iterator = struct {
    table: *const RoutingTable,
    cursor: *usize,
    remaining: usize = table_capacity,

    pub fn next(self: *Iterator) ?Entry {
        while (self.remaining > 0) {
            self.remaining -= 1;
            const offset = self.cursor.*;
            self.cursor.* = (offset + 1) % table_capacity;
            if (offset % bucket_size >= self.table.counts[offset / bucket_size]) continue;
            return self.table.entries[offset];
        }
        return null;
    }
};

pub fn maintenanceTarget(
    self: *const RoutingTable,
    cursor: *usize,
    now_ms: u64,
    stale_after_ms: u64,
) ?Entry {
    var iterator = self.iterate(cursor);
    while (iterator.next()) |entry| {
        const verified_ms = entry.last_verified_ms orelse continue;
        if (now_ms -| verified_ms < stale_after_ms) continue;
        const index = bucketIndex(types.logDistance(&self.local_id, &entry.peer.node_id));
        if (self.pending[index]) |candidate| {
            if (std.mem.eql(u8, &candidate.replace_id, &entry.peer.node_id)) continue;
        }
        return entry;
    }
    return null;
}

/// Retains an unresponsive contact for future lookups without displacing newer authentication.
pub fn markUnresponsive(
    self: *RoutingTable,
    node_id: *const types.NodeId,
    verified_at_ms: u64,
) bool {
    const index = bucketIndex(types.logDistance(&self.local_id, node_id));
    const position = self.findInBucket(index, node_id) orelse return false;
    if (self.bucketEntries(index)[position].last_verified_ms != verified_at_ms) return false;
    if (self.pending[index]) |candidate| {
        if (std.mem.eql(u8, &candidate.replace_id, node_id)) return false;
    }
    const entries = self.bucketEntriesMut(index);
    var entry = entries[position];
    entry.last_verified_ms = null;
    std.mem.copyBackwards(Entry, entries[1 .. position + 1], entries[0..position]);
    entries[0] = entry;
    return true;
}

/// Adds an operator-supplied contact for lookups. Existing entries retain their state and record.
pub fn addKnown(self: *RoutingTable, peer: *const types.Endpoint, record: *const enr.Record) Error!bool {
    try validateEntry(&self.local_id, peer, record);
    const index = bucketIndex(types.logDistance(&self.local_id, &peer.node_id));
    if (self.findInBucket(index, &peer.node_id) != null) return false;
    if (self.pending[index]) |candidate| {
        if (std.mem.eql(u8, &candidate.entry.peer.node_id, &peer.node_id)) return false;
    }
    const length = self.counts[index];
    if (length == bucket_size) return false;
    try self.requireAddressCapacity(index, peer.address, &peer.node_id);
    const offset = bucketOffset(index);
    const entries = self.entries[offset .. offset + length + 1];
    std.mem.copyBackwards(Entry, entries[1..], entries[0..length]);
    entries[0] = .{ .direction = .outgoing, .peer = peer.*, .record = record.*, .last_verified_ms = null };
    self.counts[index] += 1;
    self.total += 1;
    std.debug.assert(self.total <= table_capacity);
    return true;
}

/// Admits or refreshes a directly authenticated peer. When the bucket is full, the record
/// becomes its one pending candidate and the result names the incumbent to revalidate.
pub fn upsertVerified(
    self: *RoutingTable,
    peer: *const types.Endpoint,
    record: *const enr.Record,
    now_ms: u64,
    direction: Direction,
) Error!PutResult {
    try validateEntry(&self.local_id, peer, record);
    const index = bucketIndex(types.logDistance(&self.local_id, &peer.node_id));
    if (self.findInBucket(index, &peer.node_id)) |position| {
        const updated = try self.refreshEntry(index, &self.entries[bucketOffset(index) + position], peer, record);
        if (self.pending[index]) |candidate| {
            if (std.mem.eql(u8, &candidate.replace_id, &peer.node_id)) {
                self.pending[index] = null;
            }
        }
        self.touch(index, position, now_ms);
        return if (updated) .updated else .refreshed;
    }
    if (self.pending[index]) |*candidate| {
        if (!std.mem.eql(u8, &candidate.entry.peer.node_id, &peer.node_id)) {
            return .pending_busy;
        }
        _ = try self.refreshEntry(index, &candidate.entry, peer, record);
        candidate.entry.last_verified_ms = now_ms;
        return .{ .pending = candidate.replace_id };
    }

    if (direction == .incoming) {
        var incoming: usize = 0;
        for (self.bucketEntries(index)) |entry| incoming += @intFromBool(entry.direction == .incoming);
        if (incoming >= bucket_size / 2) return error.IncomingLimit;
    }
    try self.requireAddressCapacity(index, peer.address, &peer.node_id);
    const bucket_length: usize = self.counts[index];
    if (bucket_length < bucket_size) {
        const offset = bucketOffset(index) + bucket_length;
        self.entries[offset] = makeEntry(peer, record, now_ms, direction);
        self.counts[index] += 1;
        self.total += 1;
        std.debug.assert(self.total <= table_capacity);
        return .inserted;
    }

    const oldest = self.entries[bucketOffset(index)].peer.node_id;
    self.pending[index] = .{
        .entry = makeEntry(peer, record, now_ms, direction),
        .replace_id = oldest,
    };
    return .{ .pending = oldest };
}

pub fn abandonRevalidation(self: *RoutingTable, node_id: *const types.NodeId) void {
    const index = bucketIndex(types.logDistance(&self.local_id, node_id));
    const candidate = self.pending[index] orelse return;
    if (std.mem.eql(u8, &candidate.replace_id, node_id)) self.pending[index] = null;
}

/// An alive incumbent becomes the most recent entry; a dead one is replaced.
pub fn resolveRevalidation(
    self: *RoutingTable,
    node_id: *const types.NodeId,
    alive: bool,
    now_ms: u64,
) Error!ResolveResult {
    const index = bucketIndex(types.logDistance(&self.local_id, node_id));
    const candidate = self.pending[index] orelse return error.NoPendingRevalidation;
    if (!std.mem.eql(u8, &candidate.replace_id, node_id))
        return error.NoPendingRevalidation;
    const position = self.findInBucket(index, node_id) orelse
        return error.NoPendingRevalidation;
    self.pending[index] = null;
    if (alive) {
        self.touch(index, position, now_ms);
        return .retained;
    }

    self.removeAt(index, position);
    const bucket_length: usize = self.counts[index];
    std.debug.assert(bucket_length < bucket_size);
    self.entries[bucketOffset(index) + bucket_length] = candidate.entry;
    self.counts[index] += 1;
    self.total += 1;
    std.debug.assert(self.total <= table_capacity);
    return .{ .replaced = candidate.entry.peer.node_id };
}

/// Returns responsive records at the requested distances, most recently verified first, with the local
/// record standing in for distance 0. The folded bucket is filtered by exact distance, and every
/// record is filtered by relay scope against `requester`.
pub fn findNodes(
    self: *const RoutingTable,
    local_record: *const enr.Record,
    requester: ?types.Address,
    distances: []const u16,
    out: []enr.Record,
) Error![]enr.Record {
    std.debug.assert(std.mem.eql(u8, &local_record.node_id, &self.local_id));
    if (distances.len > types.distance_count) return error.TooManyDistances;
    var requested = [_]bool{false} ** types.distance_count;
    for (distances) |distance| {
        if (distance > types.distance_max) return error.InvalidDistance;
        requested[distance] = true;
    }

    const limit = @min(out.len, types.findnode_result_max);
    var result_length: usize = 0;
    const local_has_address = local_record.ip4 != null or local_record.ip6 != null;
    if (requested[0] and result_length < limit and
        (!local_has_address or recordRelayAllowed(local_record, requester)))
    {
        out[result_length] = local_record.*;
        result_length += 1;
    }
    for (distances) |distance| {
        if (result_length == limit) break;
        if (distance == 0 or !requested[distance]) continue;
        requested[distance] = false;
        const index = bucketIndex(@intCast(distance));
        const entries = self.bucketEntries(index);
        var position = entries.len;
        while (position > 0 and result_length < limit) {
            position -= 1;
            const entry = &entries[position];
            if (entry.last_verified_ms == null) continue;
            if (types.logDistance(&self.local_id, &entry.peer.node_id) != distance)
                continue;
            if (requester) |source| {
                if (!address_policy.relayAllowed(source, entry.peer.address)) continue;
            }
            out[result_length] = entry.record;
            result_length += 1;
        }
    }
    return out[0..result_length];
}

pub fn closest(
    self: *const RoutingTable,
    target: *const types.NodeId,
    out: []Entry,
) []Entry {
    const bounded = out[0..@min(out.len, bucket_size)];
    var length: usize = 0;
    for (0..bucket_count) |index| {
        for (self.bucketEntries(index)) |entry| {
            length = types.insertClosest(Entry, entryNodeId, bounded, length, entry, target);
        }
    }
    return bounded[0..length];
}

fn refreshEntry(
    self: *RoutingTable,
    bucket_index: usize,
    entry: *Entry,
    peer: *const types.Endpoint,
    record: *const enr.Record,
) Error!bool {
    const updated = record.sequence > entry.record.sequence;
    const retained = if (updated) record else &entry.record;
    // Signed revisions govern membership; authenticated traffic selects the live endpoint.
    if (recordHasAddress(retained, peer.address) and !entry.peer.address.eql(peer.address)) {
        try self.requireAddressCapacity(bucket_index, peer.address, &peer.node_id);
        entry.peer = peer.*;
    }
    if (updated) entry.record = record.*;
    return updated;
}

fn touch(
    self: *RoutingTable,
    bucket_index: usize,
    position: usize,
    now_ms: u64,
) void {
    const entries = self.bucketEntriesMut(bucket_index);
    std.debug.assert(position < entries.len);
    var entry = entries[position];
    entry.last_verified_ms = now_ms;
    std.mem.copyForwards(Entry, entries[position .. entries.len - 1], entries[position + 1 ..]);
    entries[entries.len - 1] = entry;
}

fn removeAt(self: *RoutingTable, bucket_index: usize, position: usize) void {
    const entries = self.bucketEntriesMut(bucket_index);
    std.debug.assert(position < entries.len);
    std.mem.copyForwards(Entry, entries[position .. entries.len - 1], entries[position + 1 ..]);
    self.counts[bucket_index] -= 1;
    self.total -= 1;
}

fn requireAddressCapacity(
    self: *const RoutingTable,
    bucket_index: usize,
    address: types.Address,
    exclude_id: *const types.NodeId,
) Error!void {
    var bucket_matches: usize = 0;
    var table_matches: usize = 0;
    for (0..bucket_count) |index| {
        for (self.bucketEntries(index)) |entry| {
            if (std.mem.eql(u8, &entry.peer.node_id, exclude_id)) continue;
            if (!address_policy.sameSubnet(entry.peer.address, address)) continue;
            table_matches += 1;
            if (index == bucket_index) bucket_matches += 1;
        }
        if (self.pending[index]) |candidate| {
            if (std.mem.eql(u8, &candidate.entry.peer.node_id, exclude_id)) continue;
            if (!address_policy.sameSubnet(candidate.entry.peer.address, address)) continue;
            table_matches += 1;
            if (index == bucket_index) bucket_matches += 1;
        }
    }
    if (bucket_matches >= bucket_subnet_limit or table_matches >= table_subnet_limit)
        return error.AddressLimit;
}

fn findInBucket(
    self: *const RoutingTable,
    bucket_index: usize,
    node_id: *const types.NodeId,
) ?usize {
    for (self.bucketEntries(bucket_index), 0..) |entry, position| {
        if (std.mem.eql(u8, &entry.peer.node_id, node_id)) return position;
    }
    return null;
}

fn bucketEntries(self: *const RoutingTable, bucket_index: usize) []const Entry {
    std.debug.assert(bucket_index < bucket_count);
    const offset = bucketOffset(bucket_index);
    return self.entries[offset .. offset + self.counts[bucket_index]];
}

fn bucketEntriesMut(self: *RoutingTable, bucket_index: usize) []Entry {
    std.debug.assert(bucket_index < bucket_count);
    const offset = bucketOffset(bucket_index);
    return self.entries[offset .. offset + self.counts[bucket_index]];
}

fn makeEntry(
    peer: *const types.Endpoint,
    record: *const enr.Record,
    now_ms: u64,
    direction: Direction,
) Entry {
    return .{
        .direction = direction,
        .peer = peer.*,
        .record = record.*,
        .last_verified_ms = now_ms,
    };
}

fn validateEntry(
    local_id: *const types.NodeId,
    peer: *const types.Endpoint,
    record: *const enr.Record,
) Error!void {
    if (std.mem.eql(u8, local_id, &peer.node_id)) return error.SelfEntry;
    if (!std.mem.eql(u8, &peer.node_id, &record.node_id))
        return error.InvalidRemoteRecord;
    if (record.length > record.bytes.len) return error.InvalidRecord;
    if (!recordHasAddress(record, peer.address)) return error.InvalidRemoteRecord;
    if (!peer.address.isUsable()) return error.InvalidRemoteRecord;
}

fn entryNodeId(entry: *const Entry) *const types.NodeId {
    return &entry.peer.node_id;
}

fn recordHasAddress(record: *const enr.Record, address: types.Address) bool {
    return switch (address) {
        .ip4 => |value| if (record.ip4) |ip|
            record.udp == value.port and std.mem.eql(u8, &ip, &value.octets)
        else
            false,
        .ip6 => |value| if (record.ip6) |ip|
            (record.udp6 orelse record.udp) == value.port and
                std.mem.eql(u8, &ip, &value.octets)
        else
            false,
    };
}

fn recordRelayAllowed(record: *const enr.Record, requester: ?types.Address) bool {
    const source = requester orelse return true;
    for (record.endpoints()) |candidate| if (candidate) |address| {
        if (address.isUsable() and address_policy.relayAllowed(source, address)) return true;
    };
    return false;
}

// Bucket 0 folds distances 1 through 240 together and every remaining distance gets its own
// bucket. Random node IDs are almost never that close, so the fold loses nothing in practice.
fn bucketIndex(distance: u16) usize {
    const bucket_min_distance = types.distance_max - bucket_count;
    if (distance <= bucket_min_distance) return 0;
    return @intCast(distance - bucket_min_distance - 1);
}

fn bucketOffset(index: usize) usize {
    std.debug.assert(index < bucket_count);
    return index * bucket_size;
}

comptime {
    std.debug.assert(bucket_count == types.distance_max / 15);
    std.debug.assert(table_capacity == 272);
    std.debug.assert(bucket_subnet_limit <= bucket_size);
    std.debug.assert(table_subnet_limit <= table_capacity);
}

test {
    _ = @import("routing_table_test.zig");
}
