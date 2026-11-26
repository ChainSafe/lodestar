const std = @import("std");
const Allocator = std.mem.Allocator;
const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;
const CachedBeaconStateRc = state_transition.CachedBeaconStateRc;
const Root = @import("consensus_types").primitive.Root.Type;
const BlockStateCache = @import("block_state_cache.zig").BlockStateCache;
const metrics = @import("metrics.zig");
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
    fn make(self: *TestStateFactory, slot: u64) !*CachedBeaconStateRc {
        const state = try self.helper.cached_state.clone(self.allocator, .{});
        errdefer {
            state.deinit();
            self.allocator.destroy(state);
        }

        try state.state.setSlot(slot);
        try state.state.commit();
        return CachedBeaconStateRc.create(self.allocator, state);
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
    defer s0.unref();
    const key0 = (try s0.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s0, false);

    try testing.expectEqual(@as(usize, 1), h.cache.size());
    try testing.expect(h.cache.get(h.io, key0) == s0.get());

    const missing: Root = @splat(0xAB);
    try testing.expect(h.cache.get(h.io, missing) == null);
}

test "BlockStateCache FIFO head pinning and 2nd-position insert" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s_head = try h.factory.make(10);
    defer s_head.unref();
    const k_head = (try s_head.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s_head, true);

    const s_a = try h.factory.make(11);
    defer s_a.unref();
    const k_a = (try s_a.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s_a, false);

    const s_b = try h.factory.make(12);
    defer s_b.unref();
    const k_b = (try s_b.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s_b, false);

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
    defer s_head.unref();
    const k_head = (try s_head.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s_head, true);

    const s_other = try h.factory.make(51);
    defer s_other.unref();
    try h.cache.add(h.io, s_other, false);

    // Re-adding the resident head as non-head must NOT demote it to 2nd; the head stays at index 0.
    try h.cache.add(h.io, s_head, false);
    var order_buf: [4]Root = undefined;
    _ = h.cache.dumpKeyOrder(&order_buf);
    try testing.expect(std.mem.eql(u8, &order_buf[0], &k_head));
}

test "BlockStateCache add duplicate-resident path bumps the resident entry's read count" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s0 = try h.factory.make(60);
    defer s0.unref();
    try h.cache.add(h.io, s0, false);
    const before = try h.cache.dumpSummary(allocator);
    defer allocator.free(before);
    try testing.expectEqual(@as(u64, 0), before[0].reads);

    const dup = try h.factory.make(60);
    defer dup.unref();
    try h.cache.add(h.io, dup, false);
    const after = try h.cache.dumpSummary(allocator);
    defer allocator.free(after);
    try testing.expectEqual(@as(u64, 1), after[0].reads);
}

test "BlockStateCache duplicate insertion preserves both owners and the canonical resident" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const s0 = try h.factory.make(60);
    defer s0.unref();
    const key = (try s0.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s0, false);
    try h.cache.add(h.io, s0, false);
    try testing.expectEqual(@as(usize, 1), h.cache.size());

    const dup = try h.factory.make(60);
    defer dup.unref();
    try h.cache.add(h.io, dup, false);
    try testing.expectEqual(s0.get(), h.cache.get(h.io, key).?);
    try testing.expectEqual(@as(u64, 60), try dup.get().state.slot());

    try h.cache.setHeadState(h.io, dup);
    try testing.expectEqual(@as(usize, 1), h.cache.size());
    const retained = h.cache.ref(h.io, key).?;
    defer retained.unref();
    try testing.expectEqual(s0, retained);
    h.cache.clear();
    try testing.expectEqual(@as(u64, 60), try s0.get().state.slot());
    try testing.expectEqual(@as(u64, 60), try dup.get().state.slot());
}

test "BlockStateCache prune evicts tail, never the just-added key" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 2 });
    defer h.deinit();

    const s0 = try h.factory.make(20);
    defer s0.unref();
    const k0 = (try s0.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s0, true);

    const s1 = try h.factory.make(21);
    defer s1.unref();
    const k1 = (try s1.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s1, false);

    const s2 = try h.factory.make(22);
    defer s2.unref();
    const k2 = (try s2.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s2, false);

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
    defer s0.unref();
    try h.cache.add(h.io, s0, true);

    const s1 = try h.factory.make(31);
    defer s1.unref();
    const k1 = (try s1.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s1, false);

    // prune breaks rather than evict the just-added tail, so the cache transiently holds 2 with
    // max_states == 1. The just-added key must survive.
    try testing.expectEqual(@as(usize, 2), h.cache.size());
    try testing.expect(h.cache.get(h.io, k1) != null);

    // A subsequent non-head add lets prune evict the older non-head tail (k1) back toward capacity.
    const s2 = try h.factory.make(32);
    defer s2.unref();
    const k2 = (try s2.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s2, false);
    try testing.expect(h.cache.get(h.io, k1) == null);
    try testing.expect(h.cache.get(h.io, k2) != null);
}

test "BlockStateCache getSeedState returns stable first-inserted state, clear removes entries" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 4 });
    defer h.deinit();

    const cache = &h.cache;
    const factory = &h.factory;
    const io = h.io;

    const s0 = try factory.make(40);
    defer s0.unref();
    try cache.add(io, s0, false);
    const s1 = try factory.make(41);
    defer s1.unref();
    try cache.add(io, s1, true);

    // Seed is the first-inserted resident (s0), NOT the head (s1) — a stable reload base.
    try testing.expect(cache.getSeedState() == s0.get());

    // Changing the head must NOT churn the seed: it stays the first-inserted resident.
    try cache.setHeadState(io, s1);
    try testing.expect(cache.getSeedState() == s0.get());

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
    defer s0.unref();
    try cache.add(io, s0, false);
    const s1 = try h.factory.make(41);
    defer s1.unref();
    try cache.add(io, s1, true);

    // Probe s0 once so its read_count surfaces in the summary.
    _ = cache.get(io, (try s0.get().state.hashTreeRoot()).*);

    var it = cache.getStates();
    var saw_s0 = false;
    var saw_s1 = false;
    while (it.next()) |s| {
        if (s == s0.get()) saw_s0 = true;
        if (s == s1.get()) saw_s1 = true;
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
        defer s1.unref();
        const s2 = try factory.make(200);
        defer s2.unref();
        const s3 = try factory.make(300);
        defer s3.unref();
        break :blk .{
            (try s1.get().state.hashTreeRoot()).*,
            (try s2.get().state.hashTreeRoot()).*,
            (try s3.get().state.hashTreeRoot()).*,
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
        defer state1.unref();
        try cache.add(io, state1, false);
        const state2 = try factory.make(200);
        defer state2.unref();
        try cache.add(io, state2, false);
        const state3 = try factory.make(300);
        defer state3.unref();

        // Seed is the first-inserted resident (state1) and must stay stable across setHeadState.
        try testing.expect(cache.getSeedState() == state1.get());

        try cache.setHeadState(io, if (sc.head_is_state2) state2 else state1);
        try testing.expect(cache.getSeedState() == state1.get());
        try testing.expectEqual(@as(usize, 2), cache.size());

        switch (sc.add_as_head) {
            .head => try cache.add(io, state3, true),
            .non_head => try cache.add(io, state3, false),
            .non_then_head => {
                try cache.add(io, state3, false);
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
fn cloneDistinct(seed: *CachedBeaconState, alloc: Allocator, slot: u64) !*CachedBeaconStateRc {
    const state = try seed.clone(alloc, .{});
    errdefer {
        state.deinit();
        alloc.destroy(state);
    }
    try state.state.setSlot(slot);
    try state.state.commit();
    return CachedBeaconStateRc.create(alloc, state);
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

        {
            var cache = try BlockStateCache.init(seed_alloc, .{ .max_states = max_states });
            defer cache.deinit();

            const s0 = try cloneDistinct(factory.helper.cached_state, state_alloc, 1000);
            defer s0.unref();
            try cache.add(io, s0, true);

            const s1 = try cloneDistinct(factory.helper.cached_state, state_alloc, 1001);
            defer s1.unref();
            try cache.add(io, s1, false);

            const dup = try cloneDistinct(factory.helper.cached_state, state_alloc, 1000);
            defer dup.unref();
            try cache.add(io, dup, false);
        }
        try testing.expect(!track.double_free);
        try testing.expectEqual(track.failing.allocated_bytes, track.failing.freed_bytes);
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

test "BlockStateCache ref survives eviction and clear after the inserting caller releases" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 2 });
    defer h.deinit();

    const head = try h.factory.make(1);
    defer head.unref();
    try h.cache.add(h.io, head, true);
    const retained = blk: {
        const state = try h.factory.make(2);
        defer state.unref();
        const key = (try state.get().state.hashTreeRoot()).*;
        try h.cache.add(h.io, state, false);
        break :blk h.cache.ref(h.io, key).?;
    };
    defer retained.unref();
    const key = (try retained.get().state.hashTreeRoot()).*;

    const replacement = try h.factory.make(3);
    defer replacement.unref();
    try h.cache.add(h.io, replacement, false);
    try testing.expectEqual(@as(usize, 2), h.cache.size());
    try testing.expect(h.cache.get(h.io, key) == null);
    try testing.expect(h.cache.ref(h.io, key) == null);
    try testing.expectEqual(@as(u64, 2), try retained.get().state.slot());
    h.cache.clear();
    try testing.expectEqual(@as(u64, 2), try retained.get().state.slot());

    try h.cache.add(h.io, retained, false);
    try testing.expectEqual(retained.get(), h.cache.get(h.io, key).?);
}

test "BlockStateCache entries in two caches and a consumer release independently" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{});
    defer h.deinit();

    const retained = blk: {
        var other = try BlockStateCache.init(allocator, .{});
        defer other.deinit();
        const state = try h.factory.make(80);
        defer state.unref();
        const key = (try state.get().state.hashTreeRoot()).*;
        try h.cache.add(h.io, state, false);
        try other.add(h.io, state, false);
        h.cache.clear();
        try testing.expectEqual(state.get(), other.get(h.io, key).?);
        break :blk other.ref(h.io, key).?;
    };
    defer retained.unref();
    try testing.expectEqual(@as(u64, 80), try retained.get().state.slot());
    _ = try retained.get().state.hashTreeRoot();
}

test "BlockStateCache refSeedState survives clear and keeps insertion order" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{});
    defer h.deinit();
    try testing.expect(h.cache.getSeedState() == null);
    try testing.expect(h.cache.refSeedState() == null);

    const retained = blk: {
        const first = try h.factory.make(1);
        defer first.unref();
        try h.cache.add(h.io, first, false);
        const head = try h.factory.make(2);
        defer head.unref();
        try h.cache.setHeadState(h.io, head);
        try testing.expectEqual(first.get(), h.cache.getSeedState().?);
        break :blk h.cache.refSeedState().?;
    };
    defer retained.unref();
    h.cache.clear();
    try testing.expect(h.cache.refSeedState() == null);
    try testing.expectEqual(@as(u64, 1), try retained.get().state.slot());
}

test "BlockStateCache ref records one read and returns the existing owner" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{});
    defer h.deinit();
    const state = try h.factory.make(1);
    defer state.unref();
    const key = (try state.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, state, false);
    const retained = h.cache.ref(h.io, key).?;
    defer retained.unref();
    try testing.expectEqual(state, retained);
    const summary = try h.cache.dumpSummary(allocator);
    defer allocator.free(summary);
    try testing.expectEqual(@as(u64, 1), summary[0].reads);
}

test "BlockStateCache onCheckpoint trims the temporary extra state while keeping the head" {
    const allocator = testing.allocator;
    const h = try BlockHarness.init(allocator, .{ .max_states = 1 });
    defer h.deinit();
    const head = try h.factory.make(1);
    defer head.unref();
    try h.cache.setHeadState(h.io, head);
    const next = try h.factory.make(2);
    defer next.unref();
    try h.cache.add(h.io, next, false);
    try testing.expectEqual(@as(usize, 2), h.cache.size());
    try h.cache.setHeadState(h.io, null);
    try testing.expectEqual(@as(usize, 2), h.cache.size());

    const key = (try head.get().state.hashTreeRoot()).*;
    h.cache.onCheckpoint(key);
    try testing.expectEqual(@as(usize, 1), h.cache.size());
    try testing.expectEqual(head.get(), h.cache.get(h.io, key).?);
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
            defer s.unref();
            const key = (try s.get().state.hashTreeRoot()).*;
            try h.cache.add(h.io, s, false);
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
    defer s0.unref();
    const k0 = (try s0.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s0, false);
    const s1 = try h.factory.make(2);
    defer s1.unref();
    try h.cache.add(h.io, s1, false);

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
    defer s0.unref();
    const k0 = (try s0.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s0, true);
    const s1 = try h.factory.make(11);
    defer s1.unref();
    const k1 = (try s1.get().state.hashTreeRoot()).*;
    try h.cache.add(h.io, s1, false);

    // Read both, twice each, then add a third non-head state to evict the tail (k1).
    for (0..2) |_| _ = h.cache.get(h.io, k0);
    for (0..2) |_| _ = h.cache.get(h.io, k1);
    const s2 = try h.factory.make(12);
    defer s2.unref();
    try h.cache.add(h.io, s2, false);

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
