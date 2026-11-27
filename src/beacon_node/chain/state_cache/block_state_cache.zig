const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;

const types = @import("consensus_types");
const state_transition = @import("state_transition");
const time = @import("time");
const metrics = @import("metrics.zig");

const CachedBeaconState = state_transition.CachedBeaconState;
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
///    `getSeedState` returns the `first` resident = the oldest-by-insertion, stable across
///    `setHeadState` (head pinning touches only the eviction list).
pub const BlockStateCache = struct {
    const Self = @This();
    /// `slab`-resident, so its address is stable for the cache's lifetime; both lists splice it in
    /// place. A free entry sits only on `free` (its list links are unused while free).
    const Entry = struct {
        key: Root,
        state: *CachedBeaconState,
        read_count: u64 = 0,
        last_read: ?std.Io.Timestamp = null,
        ev_node: std.DoublyLinkedList.Node = .{},
        in_node: std.DoublyLinkedList.Node = .{},
    };

    allocator: Allocator,
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
        for (self.map.values()) |entry| {
            destroyState(entry.state);
        }
        self.map.deinit(self.allocator);
        self.allocator.free(self.slab);
        self.allocator.free(self.free);
    }

    /// Add a state to this cache.
    /// `is_head` if true, move it to the head of the list. Otherwise add to the 2nd position. In
    /// importBlock() steps, normally it'll call add() with `is_head` false first, then call
    /// setHeadState() to set the head.
    ///
    /// Returns the canonical resident state — `state` on a fresh insert, the resident on the
    /// duplicate path (the incoming duplicate is deinit'd). Use the return value afterwards, not
    /// the passed pointer. Ownership of `state` transfers to the cache only on success; on
    /// `hashTreeRoot` failure ownership stays with the caller, which frees it.
    pub fn add(
        self: *Self,
        io: std.Io,
        state: *CachedBeaconState,
        is_head: bool,
    ) !*CachedBeaconState {
        // `hashTreeRoot` is the sole fallible op and precedes every mutation, so on its failure
        // `state` is never inserted (no rollback). A future `try` added below would break this.
        const key = (try state.state.hashTreeRoot()).*;

        if (self.map.get(key)) |resident| {
            if (resident.state != state) {
                destroyState(state);
            }
            // The duplicate-resident probe counts as a read; the reorder leaves this pointer valid.
            recordRead(io, resident);
            if (is_head) {
                self.moveToHead(resident);
            } else {
                self.moveToSecond(resident);
            }
            // same size, no prune
            return resident.state;
        }

        // new state
        metrics.block().adds.incr();
        self.insertItem(key, state, is_head);
        self.prune(key);
        return state;
    }

    /// Set a state as head, happens when importing a block and head block is changed. Null is a no-op.
    /// Ownership follows `add`: pass a canonical pointer if it will be used afterwards.
    pub fn setHeadState(self: *Self, io: std.Io, state: ?*CachedBeaconState) !void {
        if (state) |s| {
            _ = try self.add(io, s, true);
        }
    }

    /// Get a state from this cache given a state root. Borrowed: the caller must NOT deinit it and
    /// must `.clone()` to retain or mutate — an in-place mutation re-keys the root, aliasing two
    /// entries onto one state.
    pub fn get(self: *Self, io: std.Io, key: Root) ?*CachedBeaconState {
        metrics.block().lookups.incr();
        const entry = self.map.get(key) orelse return null;
        metrics.block().hits.incr();
        metrics.block().state_cloned_count.observe(entry.state.cloned_count);
        recordRead(io, entry);
        return entry.state;
    }

    fn recordRead(io: std.Io, entry: *Entry) void {
        entry.read_count += 1;
        entry.last_read = time.start(io);
    }

    /// Get a seed state for state reload, this could be any states. The goal is to have the same base
    /// merkle tree for all BeaconState objects across application. Returns the first-inserted
    /// resident — stable across `setHeadState`, since head pinning touches only the eviction list, not
    /// the insertion list. Borrowed (`.clone()` to retain past the next mutation).
    ///
    /// Null when the cache is empty — legal via the debug-API `clear()`.
    pub fn getSeedState(self: *Self) ?*CachedBeaconState {
        const first = self.in_list.first orelse return null;
        return @as(*Entry, @alignCast(@fieldParentPtr("in_node", first))).state;
    }

    pub fn size(self: *const Self) usize {
        return self.map.count();
    }

    /// Snapshot reads / seconds-since-last-read over the resident set. Never-read entries are excluded
    /// from `reads`; entries with no `last_read` stamp are excluded from `secs`.
    pub fn scanReadStats(self: *const Self, io: std.Io) struct {
        reads: metrics.AvgMinMax,
        secs: metrics.AvgMinMax,
    } {
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

    /// ONLY FOR DEBUGGING PURPOSES. For lodestar debug API. Removes and deinits every state (the cache
    /// owns them).
    pub fn clear(self: *Self) void {
        for (self.map.values()) |entry| {
            destroyState(entry.state);
        }
        self.map.clearRetainingCapacity();
        self.ev_list = .{};
        self.in_list = .{};
        for (self.slab, 0..) |*entry, i| {
            self.free[i] = entry;
        }
        self.free_len = self.slab.len;
    }

    pub const StateIterator = struct {
        node: ?*std.DoublyLinkedList.Node,

        pub fn next(self: *StateIterator) ?*CachedBeaconState {
            const n = self.node orelse return null;
            self.node = n.next;
            const entry: *Entry = @alignCast(@fieldParentPtr("in_node", n));
            return entry.state;
        }
    };

    /// ONLY FOR DEBUGGING PURPOSES. For lodestar debug API. Iterates every resident state (BORROWED —
    /// the cache owns them, do NOT deinit). Valid only until the next cache mutation. Iterates in
    /// insertion order.
    pub fn getStates(self: *const Self) StateIterator {
        return .{ .node = self.in_list.first };
    }

    /// ONLY FOR DEBUGGING PURPOSES. For lodestar debug API. Per-resident summary; caller frees the slice.
    pub fn dumpSummary(self: *const Self, allocator: Allocator) ![]StateCacheItem {
        const out = try allocator.alloc(StateCacheItem, self.map.count());
        errdefer allocator.free(out);

        var i: usize = 0;
        var node = self.in_list.first;
        while (node) |n| : (node = n.next) {
            const entry: *Entry = @alignCast(@fieldParentPtr("in_node", n));
            out[i] = .{
                .slot = try entry.state.state.slot(),
                .root = (try entry.state.state.hashTreeRoot()).*,
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
            destroyState(tail.state);
            self.evict(tail);
        }
    }

    /// Insert into both lists and the map, taking ownership of `state`. `at_head` picks the eviction
    /// slot: ev_head or the second position. The fresh entry lands at `in_tail`, so the seed base
    /// (`in_head`) stays stable.
    fn insertItem(self: *Self, key: Root, state: *CachedBeaconState, at_head: bool) void {
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

    /// Remove `entry` from BOTH lists and the map, returning its slab slot to the freelist. Does NOT
    /// free the state — the caller does that first (mirrors `prune`).
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
    pub fn dumpKeyOrder(self: *const Self, out: []Root) usize {
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

    fn destroyState(state: *CachedBeaconState) void {
        const allocator = state.allocator;
        state.deinit();
        allocator.destroy(state);
    }
};

const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;

const TestStateFactory = struct {
    allocator: Allocator,
    helper: TestCachedBeaconState,

    fn init(allocator: Allocator, pool: *Node.Pool) !TestStateFactory {
        const helper = try TestCachedBeaconState.init(allocator, pool, 8);
        return .{ .allocator = allocator, .helper = helper };
    }

    fn deinit(self: *TestStateFactory) void {
        self.helper.deinit();
    }

    /// Produce an independently owned state with a distinct root by setting its `slot`.
    fn make(self: *TestStateFactory, slot: u64) !*CachedBeaconState {
        const state = try self.helper.cached_state.clone(self.allocator, .{});
        errdefer {
            state.deinit();
            self.allocator.destroy(state);
        }

        try state.state.setSlot(slot);
        try state.state.commit();
        return state;
    }
};

const BlockHarness = struct {
    allocator: Allocator,
    io: std.Io,
    pool: Node.Pool,
    factory: TestStateFactory,
    cache: BlockStateCache,

    fn init(allocator: Allocator, opts: BlockStateCache.Opts) !*BlockHarness {
        const h = try allocator.create(BlockHarness);
        errdefer allocator.destroy(h);

        h.allocator = allocator;
        h.io = std.testing.io;
        h.pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
        errdefer h.pool.deinit();

        h.factory = try TestStateFactory.init(allocator, &h.pool);
        errdefer h.factory.deinit();

        h.cache = try BlockStateCache.init(allocator, opts);

        return h;
    }

    fn deinit(self: *BlockHarness) void {
        const allocator = self.allocator;
        self.cache.deinit();
        self.factory.deinit();
        self.pool.deinit();
        allocator.destroy(self);
    }
};

test "BlockStateCache add/get and ownership deinit" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{});
    defer h.deinit();

    const s0 = try h.factory.make(1);
    const key0 = (try s0.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s0, false);

    try testing.expectEqual(@as(usize, 1), h.cache.size());
    try testing.expect(h.cache.get(h.io, key0) == s0);

    const missing: Root = @splat(0xAB);
    try testing.expect(h.cache.get(h.io, missing) == null);
}

test "BlockStateCache FIFO head pinning and 2nd-position insert" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s_head = try h.factory.make(10);
    const k_head = (try s_head.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s_head, true);

    const s_a = try h.factory.make(11);
    const k_a = (try s_a.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s_a, false);

    const s_b = try h.factory.make(12);
    const k_b = (try s_b.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s_b, false);

    // Order should be: head, b (latest non-head 2nd), a.
    var order_buf: [4]Root = undefined;
    const order_len = h.cache.dumpKeyOrder(&order_buf);
    try testing.expectEqual(@as(usize, 3), order_len);
    try testing.expect(std.mem.eql(u8, &order_buf[0], &k_head));
    try testing.expect(std.mem.eql(u8, &order_buf[1], &k_b));
    try testing.expect(std.mem.eql(u8, &order_buf[2], &k_a));
}

test "BlockStateCache re-adding the current head as non-head keeps it at head" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s_head = try h.factory.make(50);
    const k_head = (try s_head.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s_head, true);

    const s_other = try h.factory.make(51);
    _ = try h.cache.add(h.io, s_other, false);

    // Re-adding the resident head as non-head must NOT demote it to 2nd; the head stays at index 0.
    _ = try h.cache.add(h.io, s_head, false);
    var order_buf: [4]Root = undefined;
    _ = h.cache.dumpKeyOrder(&order_buf);
    try testing.expect(std.mem.eql(u8, &order_buf[0], &k_head));
}

test "BlockStateCache add duplicate-resident path bumps the resident entry's read count" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s0 = try h.factory.make(60);
    const key0 = (try s0.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s0, false);

    // Fresh insert does not count as a read.
    try testing.expectEqual(@as(u64, 0), h.cache.map.get(key0).?.read_count);

    // Re-add a DIFFERENT state value hashing to the SAME root: the duplicate-resident probe finds
    // the entry by key (just like the public `get`) and must bump its read tracking.
    const dup = try cloneDistinct(h.factory.helper.cached_state, allocator, 60);
    _ = try h.cache.add(h.io, dup, false);

    // Read directly off the map rather than via `get`, which would itself bump and mask a missing
    // probe bump. With the bump, the single duplicate probe yields read_count == 1.
    try testing.expectEqual(@as(u64, 1), h.cache.map.get(key0).?.read_count);
}

test "BlockStateCache add returns the canonical pointer on both paths" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s0 = try h.factory.make(60);
    try testing.expectEqual(s0, try h.cache.add(h.io, s0, false));

    const dup = try cloneDistinct(h.factory.helper.cached_state, allocator, 60);
    const canonical = try h.cache.add(h.io, dup, false);
    try testing.expectEqual(s0, canonical);

    try h.cache.setHeadState(h.io, canonical);
    try testing.expectEqual(@as(usize, 1), h.cache.size());
}

test "BlockStateCache prune evicts tail, never the just-added key" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 2 });
    defer h.deinit();

    const s0 = try h.factory.make(20);
    const k0 = (try s0.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s0, true);

    const s1 = try h.factory.make(21);
    const k1 = (try s1.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s1, false);

    const s2 = try h.factory.make(22);
    const k2 = (try s2.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s2, false);

    // Order is [k0(head), k2, k1]; max_states == 2 evicts the tail k1. Head k0 stays pinned and
    // the just-added k2 survives.
    try testing.expectEqual(@as(usize, 2), h.cache.size());
    try testing.expect(h.cache.get(h.io, k1) == null);
    try testing.expect(h.cache.get(h.io, k0) != null);
    try testing.expect(h.cache.get(h.io, k2) != null);
}

test "BlockStateCache prune-skip-last-added when max_states == 1" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 1 });
    defer h.deinit();

    const s0 = try h.factory.make(30);
    _ = try h.cache.add(h.io, s0, true);

    const s1 = try h.factory.make(31);
    const k1 = (try s1.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s1, false);

    // prune breaks rather than evict the just-added tail, so the cache transiently holds 2 with
    // max_states == 1. The just-added key must survive.
    try testing.expectEqual(@as(usize, 2), h.cache.size());
    try testing.expect(h.cache.get(h.io, k1) != null);

    // A subsequent non-head add lets prune evict the older non-head tail (k1) back toward capacity.
    const s2 = try h.factory.make(32);
    const k2 = (try s2.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s2, false);
    try testing.expect(h.cache.get(h.io, k1) == null);
    try testing.expect(h.cache.get(h.io, k2) != null);
}

test "BlockStateCache getSeedState returns stable first-inserted state, clear frees states" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const cache = &h.cache;
    const factory = &h.factory;
    const io = h.io;

    const s0 = try factory.make(40);
    _ = try cache.add(io, s0, false);
    const s1 = try factory.make(41);
    _ = try cache.add(io, s1, true);

    // Seed is the first-inserted resident (s0), NOT the head (s1) — a stable reload base.
    try testing.expect(cache.getSeedState() == s0);

    // Changing the head must NOT churn the seed: it stays the first-inserted resident.
    try cache.setHeadState(io, s1);
    try testing.expect(cache.getSeedState() == s0);

    cache.clear();
    try testing.expectEqual(@as(usize, 0), cache.size());
}

test "BlockStateCache getStates + dumpSummary (debug API)" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const cache = &h.cache;
    const io = h.io;

    const s0 = try h.factory.make(40);
    _ = try cache.add(io, s0, false);
    const s1 = try h.factory.make(41);
    _ = try cache.add(io, s1, true);

    // Probe s0 once so its read_count surfaces in the summary.
    _ = cache.get(io, (try s0.state.hashTreeRoot()).*);

    var it = cache.getStates();
    var saw_s0 = false;
    var saw_s1 = false;
    while (it.next()) |s| {
        if (s == s0) saw_s0 = true;
        if (s == s1) saw_s1 = true;
    }
    try testing.expect(saw_s0 and saw_s1);

    const summary = try cache.dumpSummary(allocator);
    defer allocator.free(summary);
    try testing.expectEqual(@as(usize, 2), summary.len);
    var saw40 = false;
    var saw41 = false;
    for (summary) |item| {
        try testing.expect(!item.checkpoint_state);
        if (item.slot == 40) {
            saw40 = true;
            try testing.expectEqual(@as(u64, 1), item.reads);
        }
        if (item.slot == 41) saw41 = true;
    }
    try testing.expect(saw40 and saw41);
}

// Each row sets a head, introduces state3 via one of three add modes, and asserts the resulting
// head-first key order plus the single pruned key.
test "BlockStateCache head-pin + 2nd-position insert + single-prune order across add modes" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 2 });
    defer h.deinit();

    const factory = &h.factory;
    const io = h.io;

    // Roots are deterministic across scenarios, so compute them once — lets the expectation table
    // hold the expected keys directly.
    const key1, const key2, const key3 = blk: {
        const s1 = try factory.make(100);
        defer BlockStateCache.destroyState(s1);
        const s2 = try factory.make(200);
        defer BlockStateCache.destroyState(s2);
        const s3 = try factory.make(300);
        defer BlockStateCache.destroyState(s3);
        break :blk .{
            (try s1.state.hashTreeRoot()).*,
            (try s2.state.hashTreeRoot()).*,
            (try s3.state.hashTreeRoot()).*,
        };
    };

    const AddAsHead = enum { head, non_head, non_then_head };
    const Scenario = struct {
        name: []const u8,
        head_is_state2: bool,
        add_as_head: AddAsHead,
        kept: [2]Root,
        pruned: Root,
    };

    const scenarios = [_]Scenario{
        .{ .name = "add as head, prune key1", .head_is_state2 = true, .add_as_head = .head, .kept = .{ key3, key2 }, .pruned = key1 },
        .{ .name = "add, prune key1", .head_is_state2 = true, .add_as_head = .non_head, .kept = .{ key2, key3 }, .pruned = key1 },
        .{ .name = "add as head, prune key2", .head_is_state2 = false, .add_as_head = .head, .kept = .{ key3, key1 }, .pruned = key2 },
        .{ .name = "add, prune key2", .head_is_state2 = false, .add_as_head = .non_head, .kept = .{ key1, key3 }, .pruned = key2 },
        .{ .name = "add then set as head, prune key1", .head_is_state2 = true, .add_as_head = .non_then_head, .kept = .{ key3, key2 }, .pruned = key1 },
        .{ .name = "add then set as head, prune key2", .head_is_state2 = false, .add_as_head = .non_then_head, .kept = .{ key3, key1 }, .pruned = key2 },
    };

    for (scenarios) |sc| {
        // Fresh cache per scenario: clear the shared harness cache rather than re-init.
        const cache = &h.cache;
        cache.clear();

        // Setup: add state1 then state2, both non-head (key order [k1, k2]).
        const state1 = try factory.make(100);
        _ = try cache.add(io, state1, false);
        const state2 = try factory.make(200);
        _ = try cache.add(io, state2, false);
        const state3 = try factory.make(300);

        // Seed is the first-inserted resident (state1) and must stay stable across setHeadState.
        try testing.expect(cache.getSeedState() == state1);

        try cache.setHeadState(io, if (sc.head_is_state2) state2 else state1);
        try testing.expect(cache.getSeedState() == state1);
        try testing.expectEqual(@as(usize, 2), cache.size());

        switch (sc.add_as_head) {
            .head => _ = try cache.add(io, state3, true),
            .non_head => _ = try cache.add(io, state3, false),
            .non_then_head => {
                _ = try cache.add(io, state3, false);
                try cache.setHeadState(io, state3);
            },
        }

        try testing.expectEqual(@as(usize, 2), cache.size());

        var order_buf: [2]Root = undefined;
        const order_len = cache.dumpKeyOrder(&order_buf);
        try testing.expectEqual(sc.kept.len, order_len);
        for (sc.kept, order_buf[0..order_len]) |want, got| {
            try testing.expect(std.mem.eql(u8, &want, &got));
        }

        try testing.expect(cache.get(io, sc.pruned) == null);
        for (sc.kept) |kept_key| {
            try testing.expect(cache.get(io, kept_key) != null);
        }
    }
}

const DoubleFreeDetectAllocator = @import("testing_allocators").DoubleFreeDetectAllocator;

// Clone the seed onto `alloc`, stamp a distinct slot, and commit so the state hashes to a distinct,
// already-cached root.
fn cloneDistinct(seed: *CachedBeaconState, alloc: Allocator, slot: u64) !*CachedBeaconState {
    const state = try seed.clone(alloc, .{});
    errdefer {
        state.deinit();
        alloc.destroy(state);
    }
    try state.state.setSlot(slot);
    try state.state.commit();
    return state;
}

test "BlockStateCache add - insert/prune/duplicate paths free the owned state exactly once" {
    const seed_alloc = testing.allocator;
    const io = std.testing.io;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = seed_alloc, .allocator = seed_alloc, .pool_size = pool_size });
    defer pool.deinit();

    var factory = try TestStateFactory.init(seed_alloc, &pool);
    defer factory.deinit();

    inline for (.{ @as(usize, 1), @as(usize, 2) }) |max_states| {
        var track = DoubleFreeDetectAllocator.init(seed_alloc, std.math.maxInt(usize));
        defer track.deinit();
        const state_alloc = track.allocator();

        var cache = try BlockStateCache.init(seed_alloc, .{ .max_states = max_states });
        defer cache.deinit();

        // Distinct-root adds exercise insert + prune-evict; the final re-add of s0's root exercises
        // the duplicate path (incoming duplicate must be freed exactly once).
        const s0 = try cloneDistinct(factory.helper.cached_state, state_alloc, 1000);
        _ = try cache.add(io, s0, true);
        try testing.expect(!track.double_free);

        const s1 = try cloneDistinct(factory.helper.cached_state, state_alloc, 1001);
        _ = try cache.add(io, s1, false);
        try testing.expect(!track.double_free);

        const dup = try cloneDistinct(factory.helper.cached_state, state_alloc, 1000);
        _ = try cache.add(io, dup, false);
        try testing.expect(!track.double_free);
    }
}

test "BlockStateCache init releases its reservations on OOM at every allocation point" {
    try testing.checkAllAllocationFailures(testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var cache = try BlockStateCache.init(allocator, .{ .max_states = 4 });
            defer cache.deinit();
        }
    }.run, .{});
}

// scanReadStats reads arithmetic: each resident state is read `read_counts[i]` times; never-read
// entries (count 0) are EXCLUDED from the {sum, avg, min, max}. Seconds bounds are covered by the
// dedicated "seconds computed" test below.
test "BlockStateCache scanReadStats reads arithmetic over read-count vectors" {
    const allocator = testing.allocator;

    const Row = struct {
        name: []const u8,
        read_counts: []const u64,
        sum: f64,
        avg: f64,
        min: f64,
        max: f64,
    };
    inline for (.{
        Row{ .name = "excludes never-read", .read_counts = &.{ 3, 1, 0 }, .sum = 4, .avg = 2, .min = 1, .max = 3 },
        Row{ .name = "single read entry", .read_counts = &.{ 0, 0, 5 }, .sum = 5, .avg = 5, .min = 5, .max = 5 },
        Row{ .name = "uniform reads", .read_counts = &.{ 2, 2, 2 }, .sum = 6, .avg = 2, .min = 2, .max = 2 },
        Row{ .name = "spread reads", .read_counts = &.{ 1, 4, 7 }, .sum = 12, .avg = 4, .min = 1, .max = 7 },
    }) |row| {
        const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
        defer h.deinit();

        for (row.read_counts, 0..) |reads, i| {
            const s = try h.factory.make(i + 1);
            const key = (try s.state.hashTreeRoot()).*;
            _ = try h.cache.add(h.io, s, false);
            for (0..reads) |_| _ = h.cache.get(h.io, key);
        }

        const stats = h.cache.scanReadStats(h.io);
        errdefer std.debug.print("scanReadStats row [{s}] failed\n", .{row.name});
        try testing.expectEqual(row.sum, stats.reads.sum);
        try testing.expectEqual(row.avg, stats.reads.avg);
        try testing.expectEqual(row.min, stats.reads.min);
        try testing.expectEqual(row.max, stats.reads.max);
    }
}

test "BlockStateCache scanReadStats seconds computed" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s0 = try h.factory.make(1);
    const k0 = (try s0.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s0, false);
    const s1 = try h.factory.make(2);
    _ = try h.cache.add(h.io, s1, false);

    // Stamp only s0; s1 stays unread so it must not contribute to the seconds stats.
    _ = h.cache.get(h.io, k0);

    // Exact seconds are timing-dependent; only the bounds and that the single stamped entry counts
    // (min == max for one sample) are asserted.
    const stats = h.cache.scanReadStats(h.io);
    try testing.expect(stats.secs.max >= 0);
    try testing.expect(stats.secs.min >= 0);
    try testing.expectEqual(stats.secs.min, stats.secs.max);
    try testing.expectEqual(stats.secs.sum, stats.secs.max);
    // Reads still track the single stamped entry.
    try testing.expectEqual(@as(f64, 1), stats.reads.sum);
}

test "BlockStateCache scanReadStats empty cache is all-zero" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const stats = h.cache.scanReadStats(h.io);
    try testing.expectEqual(metrics.AvgMinMax{}, stats.reads);
    try testing.expectEqual(metrics.AvgMinMax{}, stats.secs);
}

test "BlockStateCache scanReadStats reflects only survivors after evict and clear" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 2 });
    defer h.deinit();

    const s0 = try h.factory.make(10);
    const k0 = (try s0.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s0, true);
    const s1 = try h.factory.make(11);
    const k1 = (try s1.state.hashTreeRoot()).*;
    _ = try h.cache.add(h.io, s1, false);

    // Read both, twice each, then add a third non-head state to evict the tail (k1).
    for (0..2) |_| _ = h.cache.get(h.io, k0);
    for (0..2) |_| _ = h.cache.get(h.io, k1);
    const s2 = try h.factory.make(12);
    _ = try h.cache.add(h.io, s2, false);

    // k1 was evicted; only k0's reads (2) remain, so {sum=2, min=2, max=2}.
    try testing.expect(h.cache.get(h.io, k1) == null);
    const after_evict = h.cache.scanReadStats(h.io);
    try testing.expectEqual(@as(f64, 2), after_evict.reads.sum);
    try testing.expectEqual(@as(f64, 2), after_evict.reads.min);
    try testing.expectEqual(@as(f64, 2), after_evict.reads.max);

    // After clear there are no survivors: all-zero.
    h.cache.clear();
    const after_clear = h.cache.scanReadStats(h.io);
    try testing.expectEqual(metrics.AvgMinMax{}, after_clear.reads);
}
