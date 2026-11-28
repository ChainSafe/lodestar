const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;

const types = @import("consensus_types");
const state_transition = @import("state_transition");
const time = @import("time");
const metrics = @import("metrics.zig");

const CachedBeaconState = state_transition.CachedBeaconState;
const CachedBeaconStateRc = state_transition.CachedBeaconStateRc;
const Root = types.primitive.Root.Type;
const Slot = types.primitive.Slot.Type;

/// Given `maxSkipSlots` = 32 and `DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE` = 32, lodestar doesn't need to
/// reload states in order to process a gossip block.
///
/// |-----------------------------------------------|-----------------------------------------------|
///                 maxSkipSlots                      DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE    ^
///                                                                                             clock slot
pub const DEFAULT_MAX_BLOCK_STATES: usize = 64;

pub const StateCacheItem = struct {
    slot: Slot,
    root: Root,
    reads: u64,
    last_read: ?std.Io.Timestamp,
    checkpoint_state: bool,
};

/// New implementation of BlockStateCache that keeps the most recent n states consistently.
///  - Maintain a FIFO order with special handling for the head state, which is always the first item.
///  - Prune per `add` instead of per checkpoint so it only keeps n historical states consistently, prune from tail.
///  - No need to prune per finalized checkpoint.
///
/// Intrusive-pooled doubly-linked-list design: O(1) reorder/insert/evict and zero per-`add` heap allocation.
/// Two intrusive `std.DoublyLinkedList`s thread through one pooled slab of `Entry`:
///  - The EVICTION list (`ev_list`, via each entry's `ev_node`) is the FIFO order: `first` is the
///    head/most-recent, `last` is the oldest and is pruned first. `moveToHead`/`moveToSecond`/
///    insert-at-head/insert-at-second are O(1) splices.
///  - The INSERTION list (`in_list`, via each entry's `in_node`) records insertion order so
///    `refSeedState` returns the `first` resident = the oldest-by-insertion, stable across
///    `setHeadState` (head pinning touches only the eviction list).
/// Every public method holds `mutex` for the whole call; even lookups reorder lists and bump
/// read counters. Private `*Locked` methods require the caller to hold it; `std.Io.Mutex` is
/// not reentrant. Lock order: PersistentCheckpointStateCache.mutex before this one.
/// The owner must stop all callers before deinit.
/// Published state contents must not be mutated; clone before changing them and respect the
/// lifetime of any borrowed child views.
pub const BlockStateCache = struct {
    const Self = @This();
    /// `slab`-resident, so its address is stable for the cache's lifetime; both lists splice it in
    /// place. A free entry sits only on `free` (its list links are unused while free).
    const Entry = struct {
        key: Root,
        state: *CachedBeaconStateRc,
        read_count: u64 = 0,
        last_read: ?std.Io.Timestamp = null,
        ev_node: std.DoublyLinkedList.Node = .{},
        in_node: std.DoublyLinkedList.Node = .{},
    };

    pub const Stats = struct { lookups: u64 = 0, hits: u64 = 0, adds: u64 = 0 };

    mutex: std.Io.Mutex = .init,
    allocator: Allocator,
    stats: Stats = .{},
    max_states: usize,
    /// O(1) lookup. Insertion order is NOT tracked here (the insertion list owns that) and map
    /// iteration order is never used, so eviction may `swapRemove`.
    ///
    /// `ArrayHashMap` rather than `HashMap` deliberately: this cache holds its size flat (every
    /// `add` evicts once full), so `HashMap.grow()` — the only point that clears tombstones —
    /// would never fire, and its tombstone-based deletion then degrades every probe permanently
    /// under the add/evict churn (https://github.com/ziglang/zig/issues/17851; the std `rehash()`
    /// doc names exactly this long-lived insert+delete pattern). `ArrayHashMap`'s index deletes
    /// by backward shift and cannot accumulate tombstones.
    map: std.array_hash_map.Auto(Root, *Entry),

    /// Stable-address backing storage for every `Entry`; sized `max_states + 2` because `insertItem`
    /// pushes before `prune` trims, so the peak resident count is `max_states + 2`. Allocated once in
    /// `init` and never grown, so `add` never touches the heap.
    slab: []Entry,
    /// Freelist stack of unused slab slots. `init` fills it; insert pops, evict pushes back.
    free: []*Entry,
    free_len: usize,

    // Eviction order: first = head/most-recent, last = oldest (pruned first).
    ev_list: std.DoublyLinkedList = .{},

    // Insertion order: first = oldest-by-insertion (the seed), last = newest.
    in_list: std.DoublyLinkedList = .{},

    pub const Opts = struct {
        max_states: usize = DEFAULT_MAX_BLOCK_STATES,
    };

    pub fn init(allocator: Allocator, opts: Opts) !Self {
        assert(opts.max_states > 0);

        const capacity = opts.max_states + 2;

        var map: std.array_hash_map.Auto(Root, *Entry) = .empty;
        errdefer map.deinit(allocator);
        try map.ensureTotalCapacity(allocator, capacity);

        const slab = try allocator.alloc(Entry, capacity);
        errdefer allocator.free(slab);

        const free = try allocator.alloc(*Entry, capacity);
        errdefer allocator.free(free);

        for (slab, 0..) |*entry, i| {
            free[i] = entry;
        }

        return .{
            .allocator = allocator,
            .max_states = opts.max_states,
            .map = map,
            .slab = slab,
            .free = free,
            .free_len = capacity,
        };
    }

    pub fn deinit(self: *Self) void {
        self.clearLocked();
        self.map.deinit(self.allocator);
        self.allocator.free(self.slab);
        self.allocator.free(self.free);
    }

    /// Add a state to this cache.
    /// `is_head` if true, move it to the head of the list. Otherwise add to the 2nd position. In
    /// importBlock() steps, normally it'll call add() with `is_head` false first, then call
    /// setHeadState() to set the head.
    ///
    /// Borrows `state` and acquires one reference for a new entry. The caller retains its own
    /// reference on success and failure. A duplicate only reorders the resident entry;
    /// neither the incoming owner nor the resident owner gains or loses a reference.
    pub fn add(
        self: *Self,
        io: std.Io,
        state: *CachedBeaconStateRc,
        is_head: bool,
    ) !void {
        // `hashTreeRoot` is the sole fallible op and precedes every mutation, so on its failure
        // `state` is never inserted (no rollback). It runs before locking because it may hash the
        // caller's whole tree and touches no cache data.
        const key = (try state.get().state.hashTreeRoot()).*;
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        self.addLocked(io, key, state, is_head);
    }

    fn addLocked(self: *Self, io: std.Io, key: Root, state: *CachedBeaconStateRc, is_head: bool) void {
        if (self.map.get(key)) |resident| {
            // The duplicate-resident probe counts as a read; the reorder leaves this pointer valid.
            recordRead(io, resident);
            if (is_head) {
                self.moveToHead(resident);
            } else {
                self.moveToSecond(resident);
            }
            // same size, no prune
            return;
        }

        // new state
        metrics.block().adds.incr();
        self.stats.adds += 1;
        self.insertItem(key, state.ref(), is_head);
        self.prune(key);
    }

    /// Set a state as head, happens when importing a block and head block is changed. Null is a no-op.
    /// Retains a reference only if this inserts a new entry, like `add`.
    pub fn setHeadState(self: *Self, io: std.Io, state: ?*CachedBeaconStateRc) !void {
        if (state) |s| {
            try self.add(io, s, true);
        }
    }

    /// Acquires one state reference before returning. The caller must unref() it.
    /// The state survives eviction, clear, and cache destruction, subject to its runtime
    /// resource lifetime preconditions. This does not retain the cache itself.
    /// Locks even though it looks like a read: `lookup` bumps read counters, and a concurrent
    /// `add` can prune and unref this entry between the map lookup and the ref.
    pub fn ref(self: *Self, io: std.Io, key: Root) ?*CachedBeaconStateRc {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        const entry = self.lookup(io, key) orelse return null;
        return entry.state.ref();
    }

    fn lookup(self: *Self, io: std.Io, key: Root) ?*Entry {
        metrics.block().lookups.incr();
        self.stats.lookups += 1;
        const entry = self.map.get(key) orelse return null;
        metrics.block().hits.incr();
        self.stats.hits += 1;
        metrics.block().state_cloned_count.observe(entry.state.get().cloned_count);
        recordRead(io, entry);
        return entry;
    }

    fn recordRead(io: std.Io, entry: *Entry) void {
        entry.read_count += 1;
        entry.last_read = time.start(io);
    }

    /// Acquires one reference to a seed state for state reload, this could be any states. The goal
    /// is to have the same base merkle tree for all BeaconState objects across application. Returns
    /// the first-inserted resident, stable across `setHeadState`, since head pinning touches only the
    /// eviction list, not the insertion list. The caller must unref() it.
    ///
    /// Null when the cache is empty, legal via the debug-API `clear()`.
    pub fn refSeedState(self: *Self, io: std.Io) ?*CachedBeaconStateRc {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        const first = self.in_list.first orelse return null;
        return @as(*Entry, @alignCast(@fieldParentPtr("in_node", first))).state.ref();
    }

    pub fn onCheckpoint(self: *Self, io: std.Io, head_state_root: Root) void {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        self.prune(head_state_root);
    }

    pub fn size(self: *Self, io: std.Io) usize {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        return self.map.count();
    }

    pub fn statsSnapshot(self: *Self, io: std.Io) Stats {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        return self.stats;
    }

    /// Snapshot reads / seconds-since-last-read over the resident set. Never-read entries are excluded
    /// from `reads`; entries with no `last_read` stamp are excluded from `secs`.
    pub fn scanReadStats(self: *Self, io: std.Io) struct {
        reads: metrics.AvgMinMax,
        secs: metrics.AvgMinMax,
    } {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        var reads: metrics.AvgMinMaxAccumulator = .{};
        var node = self.in_list.first;
        while (node) |n| : (node = n.next) {
            const entry: *Entry = @alignCast(@fieldParentPtr("in_node", n));
            if (entry.read_count == 0) continue;
            reads.add(@floatFromInt(entry.read_count));
        }

        var secs: metrics.AvgMinMaxAccumulator = .{};
        const now = time.start(io);
        node = self.in_list.first;
        while (node) |n| : (node = n.next) {
            const entry: *Entry = @alignCast(@fieldParentPtr("in_node", n));
            const last_read = entry.last_read orelse continue;
            const value = time.durationSeconds(last_read.durationTo(now));
            secs.add(value);
        }

        return .{ .reads = reads.result(), .secs = secs.result() };
    }

    /// Removes all entries and releases their references. Other state owners remain valid.
    pub fn clear(self: *Self, io: std.Io) void {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        self.clearLocked();
    }

    fn clearLocked(self: *Self) void {
        while (self.ev_list.last) |node| {
            const entry: *Entry = @alignCast(@fieldParentPtr("ev_node", node));
            const state = entry.state;
            self.evict(entry);
            state.unref();
        }
    }

    /// ONLY FOR DEBUGGING PURPOSES. For lodestar debug API. Per-resident summary in insertion
    /// order; caller frees the slice.
    pub fn dumpSummary(self: *Self, io: std.Io, allocator: Allocator) ![]StateCacheItem {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        const out = try allocator.alloc(StateCacheItem, self.map.count());
        errdefer allocator.free(out);

        var i: usize = 0;
        var node = self.in_list.first;
        while (node) |n| : (node = n.next) {
            const entry: *Entry = @alignCast(@fieldParentPtr("in_node", n));
            out[i] = .{
                .slot = try entry.state.get().state.slot(),
                .root = entry.key,
                .reads = entry.read_count,
                .last_read = entry.last_read,
                .checkpoint_state = false,
            };
            i += 1;
        }
        return out;
    }

    /// Prune the cache from tail to keep the most recent n states consistently. The eviction tail is
    /// the oldest state; in case regen adds back the same state, it should stay next to head so that
    /// it won't be pruned right away. Never prune the just-added state (only reachable when
    /// `max_states == 1`).
    fn prune(self: *Self, last_added_key: Root) void {
        while (self.map.count() > self.max_states) {
            const node = self.ev_list.last orelse break;
            const tail: *Entry = @alignCast(@fieldParentPtr("ev_node", node));
            // it does not make sense to prune the last added state;
            // this only happens when max state is 1 in a short period of time.
            if (std.mem.eql(u8, &tail.key, &last_added_key)) break;
            const state = tail.state;
            self.evict(tail);
            state.unref();
        }
    }

    /// Insert into both lists and the map, taking ownership of one reference. `at_head` picks the eviction
    /// slot: ev_head or the second position. The fresh entry lands at `in_tail`, so the seed base
    /// (`in_head`) stays stable.
    fn insertItem(self: *Self, key: Root, state: *CachedBeaconStateRc, at_head: bool) void {
        assert(self.free_len > 0);
        self.free_len -= 1;
        const entry = self.free[self.free_len];
        entry.* = .{ .key = key, .state = state };
        self.map.putAssumeCapacity(key, entry);

        // Append to the insertion list at the tail.
        self.in_list.append(&entry.in_node);

        // Splice into the eviction list at head or second position.
        if (at_head or self.ev_list.first == null) {
            self.ev_list.prepend(&entry.ev_node);
        } else {
            self.ev_list.insertAfter(self.ev_list.first.?, &entry.ev_node);
        }
    }

    /// Move `entry` to the eviction head. No-op if already there. O(1) splice.
    fn moveToHead(self: *Self, entry: *Entry) void {
        if (self.ev_list.first == &entry.ev_node) return;
        self.ev_list.remove(&entry.ev_node);
        self.ev_list.prepend(&entry.ev_node);
    }

    /// Move `entry` to the eviction second position (or head when the cache holds <= 1 resident).
    /// No-op when `entry` is already at-or-before that target.
    fn moveToSecond(self: *Self, entry: *Entry) void {
        // target == head when only one resident; otherwise the second slot.
        if (self.ev_list.first == self.ev_list.last) {
            // <= 1 resident: target is head; head is index 0, so any entry is at-or-before it.
            return;
        }
        // target is the second slot. `entry` is at-or-before it iff it is the head or the second node.
        if (self.ev_list.first == &entry.ev_node) return;
        if (self.ev_list.first.?.next == &entry.ev_node) return;

        self.ev_list.remove(&entry.ev_node);
        self.ev_list.insertAfter(self.ev_list.first.?, &entry.ev_node);
    }

    /// Remove `entry` from both lists and the map and return its slab slot to the freelist.
    /// The caller releases the entry's state reference after removal.
    fn evict(self: *Self, entry: *Entry) void {
        self.ev_list.remove(&entry.ev_node);
        self.in_list.remove(&entry.in_node);

        assert(self.map.swapRemove(entry.key));
        assert(self.free_len < self.free.len);
        self.free[self.free_len] = entry;
        self.free_len += 1;
    }

    /// Walk the eviction list head-to-tail, copying keys into `out`. For tests/parity only.
    /// Returns the number of keys written; asserts `out` is large enough.
    pub fn dumpKeyOrder(self: *Self, io: std.Io, out: []Root) usize {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        var i: usize = 0;
        var node = self.ev_list.first;
        while (node) |n| : (node = n.next) {
            const entry: *Entry = @alignCast(@fieldParentPtr("ev_node", n));
            assert(i < out.len);
            out[i] = entry.key;
            i += 1;
        }
        return i;
    }
};

test {
    _ = @import("block_state_cache_test.zig");
}
