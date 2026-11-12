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
const bls = @import("bls");
const preset = @import("preset").preset;

const pubkeys = @import("./pubkeys.zig");

const allocator = std.heap.c_allocator;
const MAX_AGGREGATES = preset.SLOTS_PER_EPOCH * preset.MAX_COMMITTEES_PER_SLOT;

/// Budget four shufflings for each of four retained epochs, including in-flight work.
/// This is a shared budget, not a per-epoch limit. At capacity, verification falls back
/// to participant aggregation.
pub const MAX_ENTRIES = 16;

const EntryState = enum { free, computing, ready };

// Workers exclusively own entries being computed. The locked transition to ready
// publishes their data; readers and clear only access ready entries.
const CacheEntry = struct {
    state: EntryState = .free,
    id: u32 = 0,
    committeePubkeys: ?CommitteePubkeys = null,
    storage: [MAX_AGGREGATES]bls.AggregatePublicKey = undefined,
};

const State = struct {
    lock: std.Io.RwLock = .init,
    entries: [MAX_ENTRIES]CacheEntry = [_]CacheEntry{.{}} ** MAX_ENTRIES,
    next_id: u32 = 1,

    fn reserve(self: *State, io: std.Io) !usize {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        for (&self.entries, 0..) |*entry, i| {
            if (entry.state == .free) {
                entry.state = .computing;
                return i;
            }
        }
        return error.TooManyCommitteePubkeys;
    }

    fn unreserve(self: *State, io: std.Io, index: usize) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        const entry = &self.entries[index];
        if (entry.committeePubkeys) |*committeePubkeys| committeePubkeys.deinit();
        entry.committeePubkeys = null;
        entry.id = 0;
        entry.state = .free;
    }

    fn publish(self: *State, io: std.Io, index: usize) !u32 {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        const entry = &self.entries[index];
        std.debug.assert(entry.state == .computing);
        var id = self.next_id;
        var attempts: usize = 0;
        while (id == 0 or self.hasId(id)) : (attempts += 1) {
            if (attempts == MAX_ENTRIES) return error.NoAvailableCommitteePubkeyId;
            id = if (id == std.math.maxInt(u32)) 1 else id + 1;
        }
        self.next_id = if (id == std.math.maxInt(u32)) 1 else id + 1;
        entry.id = id;
        entry.state = .ready;
        return id;
    }

    fn hasId(self: *const State, id: u32) bool {
        for (&self.entries) |*entry| {
            if (entry.state == .ready and entry.id == id) return true;
        }
        return false;
    }

    fn remove(self: *State, io: std.Io, id: u32) !bool {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        for (&self.entries) |*entry| {
            if (entry.state == .ready and entry.id == id) {
                entry.committeePubkeys.?.deinit();
                entry.committeePubkeys = null;
                entry.id = 0;
                entry.state = .free;
                return true;
            }
        }
        return false;
    }

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
        for (&self.entries) |*entry| {
            if (entry.state == .ready and entry.id == id) {
                return try entry.committeePubkeys.?.aggregateParticipants(io, pubkey_cache, slot_in_epoch, committee_indices, bits, bit_len);
            }
        }
        return null;
    }

    pub fn clear(self: *State, io: std.Io) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        for (&self.entries) |*entry| {
            if (entry.state == .ready) {
                entry.committeePubkeys.?.deinit();
                entry.committeePubkeys = null;
                entry.id = 0;
                entry.state = .free;
            }
        }
    }

    /// All compute tasks and readers must have stopped before this call.
    pub fn deinit(self: *State) void {
        for (&self.entries) |*entry| {
            if (entry.committeePubkeys) |*committeePubkeys| committeePubkeys.deinit();
        }
        self.* = .{};
    }
};

pub var state: State = .{};

const ComputeTask = struct {
    io: std.Io,
    shuffling: ?[]u32,
    committees_per_slot: u32,
    entryIndex: usize,
    reserved: bool = true,

    pub fn compute(self: *ComputeTask) !void {
        state.entries[self.entryIndex].committeePubkeys = try CommitteePubkeys.init(
            allocator,
            self.io,
            &pubkeys.state.cache,
            self.shuffling.?,
            self.committees_per_slot,
            state.entries[self.entryIndex].storage[0..],
        );
        self.shuffling = null;
    }

    pub fn resolve(self: *ComputeTask, _: napi.Env) !js.Number {
        const id = try state.publish(self.io, self.entryIndex);
        self.reserved = false;
        return js.Number.from(id);
    }

    pub fn deinit(self: *ComputeTask) void {
        if (self.reserved) state.unreserve(self.io, self.entryIndex);
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

    const entryIndex = try state.reserve(io);
    errdefer state.unreserve(io, entryIndex);
    const owned = try allocator.dupe(u32, try shuffling.toSlice());
    errdefer allocator.free(owned);

    return js.spawn(ComputeTask, .{
        .io = io,
        .shuffling = owned,
        .committees_per_slot = count,
        .entryIndex = entryIndex,
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
    var count: usize = 0;
    for (&state.entries) |*entry| count += @intFromBool(entry.state == .ready);
    return js.Number.from(count);
}
