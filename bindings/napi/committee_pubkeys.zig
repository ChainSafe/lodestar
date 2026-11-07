//! Process-wide committee pubkey aggregates, one entry per epoch shuffling.
//!
//! Entries are addressed by id so BLS worker threads, which cannot share JS
//! objects with the main thread, can use them through the same native state.
const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const state_transition = @import("state_transition");
const CommitteePubkeys = state_transition.CommitteePubkeys;
const PubkeyCache = state_transition.PubkeyCache;

const pubkeys = @import("./pubkeys.zig");

const allocator = std.heap.page_allocator;

/// Bounds memory if a caller never releases. A mainnet entry holds about 4 MB.
pub const MAX_ENTRIES = 64;

const State = struct {
    lock: std.Io.RwLock = .init,
    entries: std.AutoHashMapUnmanaged(u32, *CommitteePubkeys) = .empty,
    /// Computations in flight, counted against `MAX_ENTRIES` so the bound holds
    /// when they complete.
    reserved: u32 = 0,
    next_id: u32 = 1,

    fn reserve(self: *State, io: std.Io) !void {
        try self.lock.lock(io);
        defer self.lock.unlock(io);

        if (self.entries.count() + self.reserved >= MAX_ENTRIES) return error.TooManyCommitteePubkeys;
        self.reserved += 1;
    }

    fn unreserve(self: *State, io: std.Io) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        self.reserved -= 1;
    }

    /// Consumes a reservation.
    fn insert(self: *State, io: std.Io, entry: *CommitteePubkeys) !u32 {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);

        std.debug.assert(self.reserved > 0);
        try self.entries.ensureUnusedCapacity(allocator, 1);
        self.reserved -= 1;
        const id = self.next_id;
        // 0 stays invalid. Wrapping onto a live id would take 4 billion entries.
        self.next_id = if (id == std.math.maxInt(u32)) 1 else id + 1;
        self.entries.putAssumeCapacityNoClobber(id, entry);
        return id;
    }

    fn remove(self: *State, io: std.Io, id: u32) !bool {
        try self.lock.lock(io);
        const removed = self.entries.fetchRemove(id);
        self.lock.unlock(io);

        const entry = (removed orelse return false).value;
        entry.deinit();
        allocator.destroy(entry);
        return true;
    }

    /// Null when `id` is unknown, for example after a release.
    pub fn aggregateParticipants(
        self: *State,
        io: std.Io,
        pubkey_cache: *const PubkeyCache,
        id: u32,
        slot_in_epoch: u64,
        committee_indices: []const u32,
        bits: []const u8,
        bit_len: usize,
    ) !?state_transition.CommitteeParticipants {
        self.lock.lockSharedUncancelable(io);
        defer self.lock.unlockShared(io);

        const entry = self.entries.get(id) orelse return null;
        return try entry.aggregateParticipants(io, pubkey_cache, slot_in_epoch, committee_indices, bits, bit_len);
    }

    /// Drop every entry. In-flight computations keep their reservations.
    pub fn clear(self: *State, io: std.Io) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);

        var it = self.entries.valueIterator();
        while (it.next()) |entry| {
            entry.*.deinit();
            allocator.destroy(entry.*);
        }
        self.entries.clearRetainingCapacity();
    }

    pub fn deinit(self: *State) void {
        var it = self.entries.valueIterator();
        while (it.next()) |entry| {
            entry.*.deinit();
            allocator.destroy(entry.*);
        }
        self.entries.deinit(allocator);
        self.* = .{};
    }
};

pub var state: State = .{};

const ComputeTask = struct {
    io: std.Io,
    shuffling: ?[]u32,
    committees_per_slot: u32,
    entry: ?*CommitteePubkeys = null,
    reserved: bool = true,

    pub fn compute(self: *ComputeTask) !void {
        const entry = try allocator.create(CommitteePubkeys);
        errdefer allocator.destroy(entry);
        entry.* = try CommitteePubkeys.init(
            allocator,
            self.io,
            &pubkeys.state.cache,
            self.shuffling.?,
            self.committees_per_slot,
        );
        self.shuffling = null;
        self.entry = entry;
    }

    pub fn resolve(self: *ComputeTask, _: napi.Env) !js.Number {
        const id = try state.insert(self.io, self.entry.?);
        self.entry = null;
        self.reserved = false;
        return js.Number.from(id);
    }

    pub fn deinit(self: *ComputeTask) void {
        if (self.reserved) state.unreserve(self.io);
        if (self.entry) |entry| {
            entry.deinit();
            allocator.destroy(entry);
        }
        if (self.shuffling) |shuffling| allocator.free(shuffling);
    }
};

/// Aggregate the pubkeys of every committee of a shuffling on a libuv worker
/// thread. `shuffling` is copied before this returns. Throws when the cache and
/// the computations in flight already hold `MAX_ENTRIES`.
///
/// JS: committeePubkeys.compute(shuffling, committeesPerSlot) → Promise<number>
pub fn compute(shuffling: js.Uint32Array, committees_per_slot: js.Number) !js.Value {
    if (!pubkeys.state.initialized) return error.PubkeyIndexNotInitialized;
    const io = js.io();
    const count = try committees_per_slot.toU32Exact();

    try state.reserve(io);
    errdefer state.unreserve(io);
    const owned = try allocator.dupe(u32, try shuffling.toSlice());
    errdefer allocator.free(owned);

    return js.spawn(ComputeTask, .{
        .io = io,
        .shuffling = owned,
        .committees_per_slot = count,
    }, "committeePubkeys.compute");
}

/// JS: committeePubkeys.release(id) → boolean, false if `id` is unknown
pub fn release(id: js.Number) !js.Boolean {
    return js.Boolean.from(try state.remove(js.io(), try id.toU32Exact()));
}

/// JS: committeePubkeys.size() → number
pub fn size() !js.Number {
    const io = js.io();
    state.lock.lockSharedUncancelable(io);
    defer state.lock.unlockShared(io);
    return js.Number.from(state.entries.count());
}
