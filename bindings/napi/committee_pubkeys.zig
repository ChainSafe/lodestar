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
const MAX_SLOTS = 16;
const MAX_AGGREGATES = preset.SLOTS_PER_EPOCH * preset.MAX_COMMITTEES_PER_SLOT;

pub const MAX_ENTRIES = MAX_SLOTS;

const SlotState = enum { free, computing, ready };

// Workers exclusively own computing slots. The locked transition to ready publishes
// their entry and aggregate storage; readers and clear only access ready slots.
const Slot = struct {
    state: SlotState = .free,
    id: u32 = 0,
    entry: ?CommitteePubkeys = null,
    storage: [MAX_AGGREGATES]bls.AggregatePublicKey = undefined,
};

const State = struct {
    lock: std.Io.RwLock = .init,
    slots: [MAX_SLOTS]Slot = [_]Slot{.{}} ** MAX_SLOTS,
    next_id: u32 = 1,

    fn reserve(self: *State, io: std.Io) !usize {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        for (&self.slots, 0..) |*slot, i| {
            if (slot.state == .free) {
                slot.state = .computing;
                return i;
            }
        }
        return error.TooManyCommitteePubkeys;
    }

    fn unreserve(self: *State, io: std.Io, index: usize) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        const slot = &self.slots[index];
        if (slot.entry) |*entry| entry.deinit();
        slot.entry = null;
        slot.id = 0;
        slot.state = .free;
    }

    fn publish(self: *State, io: std.Io, index: usize) !u32 {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        const slot = &self.slots[index];
        std.debug.assert(slot.state == .computing);
        var id = self.next_id;
        var attempts: usize = 0;
        while (id == 0 or self.hasId(id)) : (attempts += 1) {
            if (attempts == MAX_ENTRIES) return error.NoAvailableCommitteePubkeyId;
            id = if (id == std.math.maxInt(u32)) 1 else id + 1;
        }
        self.next_id = if (id == std.math.maxInt(u32)) 1 else id + 1;
        slot.id = id;
        slot.state = .ready;
        return id;
    }

    fn hasId(self: *const State, id: u32) bool {
        for (&self.slots) |*slot| {
            if (slot.state == .ready and slot.id == id) return true;
        }
        return false;
    }

    fn remove(self: *State, io: std.Io, id: u32) !bool {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        for (&self.slots) |*slot| {
            if (slot.state == .ready and slot.id == id) {
                slot.entry.?.deinit();
                slot.entry = null;
                slot.id = 0;
                slot.state = .free;
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
        for (&self.slots) |*slot| {
            if (slot.state == .ready and slot.id == id) {
                return try slot.entry.?.aggregateParticipants(io, pubkey_cache, slot_in_epoch, committee_indices, bits, bit_len);
            }
        }
        return null;
    }

    pub fn clear(self: *State, io: std.Io) void {
        self.lock.lockUncancelable(io);
        defer self.lock.unlock(io);
        for (&self.slots) |*slot| {
            if (slot.state == .ready) {
                slot.entry.?.deinit();
                slot.entry = null;
                slot.id = 0;
                slot.state = .free;
            }
        }
    }

    /// All compute tasks and readers must have stopped before this call.
    pub fn deinit(self: *State) void {
        for (&self.slots) |*slot| {
            if (slot.entry) |*entry| entry.deinit();
        }
        self.* = .{};
    }
};

pub var state: State = .{};

const ComputeTask = struct {
    io: std.Io,
    shuffling: ?[]u32,
    committees_per_slot: u32,
    slot: usize,
    reserved: bool = true,

    pub fn compute(self: *ComputeTask) !void {
        state.slots[self.slot].entry = try CommitteePubkeys.init(
            allocator,
            self.io,
            &pubkeys.state.cache,
            self.shuffling.?,
            self.committees_per_slot,
            state.slots[self.slot].storage[0..],
        );
        self.shuffling = null;
    }

    pub fn resolve(self: *ComputeTask, _: napi.Env) !js.Number {
        const id = try state.publish(self.io, self.slot);
        self.reserved = false;
        return js.Number.from(id);
    }

    pub fn deinit(self: *ComputeTask) void {
        if (self.reserved) state.unreserve(self.io, self.slot);
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

    const slot = try state.reserve(io);
    errdefer state.unreserve(io, slot);
    const owned = try allocator.dupe(u32, try shuffling.toSlice());
    errdefer allocator.free(owned);

    return js.spawn(ComputeTask, .{
        .io = io,
        .shuffling = owned,
        .committees_per_slot = count,
        .slot = slot,
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
    for (&state.slots) |*slot| count += @intFromBool(slot.state == .ready);
    return js.Number.from(count);
}
