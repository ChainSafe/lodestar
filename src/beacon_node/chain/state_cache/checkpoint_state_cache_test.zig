const std = @import("std");
const testing = std.testing;
const Allocator = std.mem.Allocator;
const st = @import("state_transition");
const Node = @import("persistent_merkle_tree").Node;
const Cache = @import("checkpoint_state_cache.zig").PersistentCheckpointStateCache;
const BlockStateCache = @import("block_state_cache.zig").BlockStateCache;
const key = @import("key.zig");
const Checkpoint = key.Checkpoint;
const Root = @import("consensus_types").primitive.Root.Type;
const io = testing.io;
const allocator = testing.allocator;
const spe = st.preset.SLOTS_PER_EPOCH;

const Harness = struct {
    tmp: testing.TmpDir,
    path: []u8,
    pool: Node.Pool,
    helper: st.test_utils.TestCachedBeaconState,
    block: BlockStateCache,
    cache: Cache,
    base_epoch: u64,

    fn init(opts: struct { memory: usize = 3, disk: @import("checkpoint_state_cache.zig").DiskRetention = .tiered }) !*Harness {
        const h = try allocator.create(Harness);
        errdefer allocator.destroy(h);
        h.tmp = testing.tmpDir(.{});
        errdefer h.tmp.cleanup();
        h.path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &h.tmp.sub_path });
        errdefer allocator.free(h.path);
        h.pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 600_000 });
        errdefer h.pool.deinit();
        h.helper = try st.test_utils.TestCachedBeaconState.init(allocator, &h.pool, 8);
        errdefer h.helper.deinit();
        h.base_epoch = (try h.helper.cached_state.state.slot()) / spe;
        h.block = try BlockStateCache.init(allocator, .{});
        errdefer h.block.deinit();
        h.cache = try Cache.init(allocator, &h.block, .{ .data_dir = h.path, .max_epochs_in_memory = opts.memory, .disk_retention = opts.disk });
        errdefer h.cache.deinit(io);
        try h.cache.initStore(io);
        return h;
    }

    fn deinit(h: *Harness) void {
        h.cache.deinit(io);
        h.block.deinit();
        h.helper.deinit();
        h.pool.deinit();
        allocator.free(h.path);
        h.tmp.cleanup();
        allocator.destroy(h);
    }

    fn cp(h: *Harness, offset: u64, root: u8) Checkpoint {
        return .{ .epoch = h.base_epoch + offset, .root = @splat(root) };
    }

    fn make(h: *Harness, offset: u64) !*st.CachedBeaconStateRc {
        const state = try h.helper.cached_state.clone(allocator, .{});
        errdefer {
            state.deinit();
            allocator.destroy(state);
        }
        const slot = (h.base_epoch + offset) * spe;
        try state.state.setSlot(slot);
        try state.state.setFinalizedCheckpoint(&.{ .epoch = h.base_epoch - 1, .root = @splat(0) });
        const header = try state.state.latestBlockHeader();
        try header.set("slot", slot);
        try state.state.commit();
        return st.CachedBeaconStateRc.create(allocator, state);
    }

    fn add(h: *Harness, offset: u64, root: u8) !void {
        const state = try h.make(offset);
        defer state.unref();
        try h.cache.add(io, h.cp(offset, root), state);
    }

    fn persist(h: *Harness, checkpoint: Checkpoint) !void {
        const head = try h.make(checkpoint.epoch - h.base_epoch);
        defer head.unref();
        const memory = h.cache.max_epochs_in_memory;
        h.cache.max_epochs_in_memory = 0;
        defer h.cache.max_epochs_in_memory = memory;
        try testing.expectEqual(@as(usize, 1), try h.cache.processState(io, checkpoint.root, head));
    }

    fn setRoot(state: *st.CachedBeaconStateRc, slot: u64, root: u8) !void {
        const roots = try state.get().state.blockRoots();
        const value: Root = @splat(root);
        try roots.setValue(slot % st.preset.SLOTS_PER_HISTORICAL_ROOT, &value);
        try state.get().state.commit();
    }
};

test "PersistentCheckpointStateCache replacement, sharing and retained lifetime" {
    const h = try Harness.init(.{});
    defer h.deinit();
    const cp = h.cp(0, 1);
    const first = try h.make(0);
    defer first.unref();
    try h.block.add(io, first, false);
    try h.cache.add(io, cp, first);
    try testing.expectEqual(@as(u32, 3), first.ref_count.load(.monotonic));
    try h.cache.add(io, cp, first);
    try testing.expectEqual(@as(u32, 3), first.ref_count.load(.monotonic));
    const retained = h.cache.ref(io, cp).?;
    defer retained.unref();
    const replacement = try h.make(0);
    defer replacement.unref();
    try h.cache.add(io, cp, replacement);
    try testing.expectEqual(replacement.get(), h.cache.get(io, cp).?);
    try testing.expectEqual(@as(u32, 3), first.ref_count.load(.monotonic));
    h.block.clear();
    try h.cache.clear(io);
    try testing.expectEqual(@as(u32, 2), first.ref_count.load(.monotonic));
    try testing.expectEqual(@as(u32, 1), replacement.ref_count.load(.monotonic));
    try testing.expectEqual(cp.epoch * spe, try retained.get().state.slot());
}

test "PersistentCheckpointStateCache latest lookup, debug output and precomputed hits" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.add(1, 1);
    try h.add(2, 2);
    try testing.expectEqual((h.base_epoch + 1) * spe, try h.cache.getLatest(io, @splat(1), null).?.state.slot());
    try testing.expectEqual(h.base_epoch * spe, try h.cache.getLatest(io, @splat(1), h.base_epoch).?.state.slot());
    try testing.expect(h.cache.getLatest(io, @splat(1), h.base_epoch - 1) == null);
    const retained = h.cache.refLatest(io, @splat(1), null).?;
    defer retained.unref();
    try testing.expect(h.cache.updatePreComputedCheckpoint(h.cp(1, 1)) == null);
    _ = h.cache.get(io, h.cp(1, 1));
    try testing.expectEqual(@as(?u64, 1), h.cache.updatePreComputedCheckpoint(h.cp(2, 2)));
    const summary = try h.cache.dumpSummary(allocator);
    defer allocator.free(summary);
    const keys = try h.cache.dumpCheckpointKeys(allocator);
    defer allocator.free(keys);
    try testing.expectEqual(@as(usize, 3), keys.len);
    try testing.expectEqualSlices(u8, &keys[0].root, &summary[0].root);
    try testing.expect(summary[0].checkpoint_state);
    var states = h.cache.getStates();
    var count: usize = 0;
    while (states.next() != null) count += 1;
    try testing.expectEqual(@as(usize, 3), count);
}

test "PersistentCheckpointStateCache persist, bytes, reload and re-add preserve the disk key" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.add(1, 2);
    const original = try h.cache.get(io, h.cp(0, 1)).?.state.serialize(allocator);
    defer allocator.free(original);
    try h.persist(h.cp(0, 1));
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    const data = (try h.cache.getStateOrLoadDb(io, allocator, h.cp(0, 1))).?;
    defer data.deinit(allocator);
    try testing.expectEqualSlices(u8, original, data.loaded.bytes);
    try testing.expectEqual(key.datastoreKey(h.cp(0, 1)), data.loaded.persisted_key);
    const restored = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer restored.unref();
    const serialized = try restored.get().state.serialize(allocator);
    defer allocator.free(serialized);
    try testing.expectEqualSlices(u8, original, serialized);
    try h.cache.add(io, h.cp(0, 1), restored);
    const resident = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))).?;
    defer resident.deinit(allocator);
    try testing.expectEqual(restored, resident.state);
    try h.cache.pruneFinalized(io, h.base_epoch + 1);
    try testing.expect((try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)) == null);
    try testing.expectEqual(h.base_epoch * spe, try restored.get().state.slot());
}

test "PersistentCheckpointStateCache reload falls back past missing and invalid files" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    for (0..3) |i| {
        try h.add(@intCast(i), 1);
        try h.persist(h.cp(@intCast(i), 1));
    }
    const seed = try h.make(3);
    defer seed.unref();
    try h.block.add(io, seed, false);
    try h.cache.store.remove(io, key.datastoreKey(h.cp(2, 1)));
    try h.cache.store.remove(io, key.datastoreKey(h.cp(1, 1)));
    _ = try h.cache.store.write(io, h.cp(1, 1), "invalid");
    try testing.expectError(error.InvalidStateBytes, h.cache.getOrReload(io, h.cp(1, 1)));
    const restored = (try h.cache.getOrReloadLatest(io, @splat(1), null)).?;
    defer restored.unref();
    try testing.expectEqual(h.base_epoch * spe, try restored.get().state.slot());
    h.block.clear();
    try testing.expectError(error.NoSeedState, h.cache.getOrReload(io, h.cp(1, 1)));
}

test "PersistentCheckpointStateCache failed writes retain residents and can retry" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    const state = try h.make(0);
    defer state.unref();
    const cp = h.cp(0, 1);
    try h.cache.add(io, cp, state);
    const dk = key.datastoreKey(cp);
    const tmp_name = try std.fmt.allocPrint(allocator, "0x{x}.tmp", .{&dk});
    defer allocator.free(tmp_name);
    try h.cache.store.dir.?.createDir(io, tmp_name, .default_dir);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, cp.root, state));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.failed_epochs);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.persists);
    try testing.expectEqual(state.get(), h.cache.get(io, cp).?);
    try testing.expectEqual(@as(u32, 2), state.ref_count.load(.monotonic));
    try testing.expect((try h.cache.store.read(io, allocator, dk, .unlimited)) == null);
    try h.cache.store.dir.?.deleteDir(io, tmp_name);
    try testing.expectEqual(@as(usize, 1), try h.cache.processState(io, cp.root, state));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.persists);
    try testing.expect(h.cache.get(io, cp) == null);
    try testing.expectEqual(@as(u32, 1), state.ref_count.load(.monotonic));
}

test "PersistentCheckpointStateCache persistence allocation failures preserve residents and track successful writes" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    const state = try h.make(0);
    defer state.unref();
    const cp = h.cp(0, 1);
    const dk = key.datastoreKey(cp);
    const path = try std.fs.path.join(allocator, &.{ h.path, "allocation-failures" });
    defer allocator.free(path);
    var failed_before_write = false;
    var failed_after_write = false;
    var reached_success = false;
    for (0..64) |failure_index| {
        var failing = testing.FailingAllocator.init(allocator, .{});
        {
            var cache = try Cache.init(failing.allocator(), &h.block, .{ .data_dir = path, .max_epochs_in_memory = 0 });
            defer cache.deinit(io);
            try cache.initStore(io);
            try cache.add(io, cp, state);
            failing.fail_index = failing.alloc_index + failure_index;
            const count: ?usize = cache.processState(io, cp.root, state) catch |err| blk: {
                try testing.expectEqual(error.OutOfMemory, err);
                failing.fail_index = std.math.maxInt(usize);
                try testing.expectEqual(state.get(), cache.get(io, cp).?);
                try testing.expectEqual(@as(u32, 2), state.ref_count.load(.monotonic));
                const bytes = try cache.store.read(io, allocator, dk, .unlimited);
                defer if (bytes) |data| allocator.free(data);
                if (bytes != null) failed_after_write = true else failed_before_write = true;
                try testing.expectEqual(@as(u64, if (bytes != null) 1 else 0), cache.stats.persists);
                try testing.expectEqual(@as(usize, if (bytes != null) 0 else 1), try cache.processState(io, cp.root, state));
                break :blk null;
            };
            if (count) |written| {
                try testing.expectEqual(@as(usize, 1), written);
                reached_success = true;
            }
            try testing.expect(cache.get(io, cp) == null);
            try testing.expectEqual(@as(u32, 1), state.ref_count.load(.monotonic));
            try cache.clear(io);
            try testing.expect((try cache.store.read(io, allocator, dk, .unlimited)) == null);
        }
        try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (reached_success) break;
    }
    try testing.expect(reached_success);
    try testing.expect(failed_before_write);
    try testing.expect(failed_after_write);
}

test "PersistentCheckpointStateCache re-add reuses the persisted file and clear removes it" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const replacement = try h.make(0);
    defer replacement.unref();
    try h.cache.add(io, h.cp(0, 1), replacement);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), replacement));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.persists);
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    try testing.expectEqual(@as(u32, 1), replacement.ref_count.load(.monotonic));
    try h.cache.clear(io);
    try testing.expect((try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)) == null);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), replacement));
}

test "PersistentCheckpointStateCache failed reloads release seed references" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const seed = try h.make(1);
    defer seed.unref();
    try h.block.add(io, seed, false);
    const dk = key.datastoreKey(h.cp(0, 1));
    const bytes = (try h.cache.store.read(io, allocator, dk, .unlimited)).?;
    defer allocator.free(bytes);
    try h.cache.store.remove(io, dk);
    try testing.expect((try h.cache.getOrReload(io, h.cp(0, 1))) == null);
    try testing.expectEqual(@as(u32, 2), seed.ref_count.load(.monotonic));
    _ = try h.cache.store.write(io, h.cp(0, 1), "invalid");
    try testing.expectError(error.InvalidStateBytes, h.cache.getOrReload(io, h.cp(0, 1)));
    try testing.expectEqual(@as(u32, 2), seed.ref_count.load(.monotonic));
    try h.cache.store.remove(io, dk);
    _ = try h.cache.store.write(io, h.cp(0, 1), bytes);
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    h.cache.allocator = failing.allocator();
    defer h.cache.allocator = allocator;
    try testing.expectError(error.OutOfMemory, h.cache.getOrReload(io, h.cp(0, 1)));
    h.cache.allocator = allocator;
    try testing.expectEqual(@as(u32, 2), seed.ref_count.load(.monotonic));
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    const restored = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer restored.unref();
    try testing.expectEqual(@as(u32, 2), seed.ref_count.load(.monotonic));
    try testing.expectEqual(@as(u32, 2), restored.ref_count.load(.monotonic));
}

test "PersistentCheckpointStateCache processState chooses boundary and unknown branches" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    try h.add(0, 1); // Previous-root checkpoint.
    try h.add(0, 2); // Current-root checkpoint.
    try h.add(0, 3); // Another branch.
    try h.add(1, 4);
    const head = try h.make(1);
    defer head.unref();
    try Harness.setRoot(head, h.base_epoch * spe - 1, 1);
    try Harness.setRoot(head, h.base_epoch * spe, 2);
    try testing.expectEqual(@as(usize, 2), try h.cache.processState(io, @splat(4), head));
    try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))) == null);
    const persisted = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 2))).?;
    defer persisted.deinit(allocator);
    const unknown = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 3))).?;
    defer unknown.deinit(allocator);
    try testing.expect(h.cache.get(io, h.cp(1, 4)) != null);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(4), head));
}

test "PersistentCheckpointStateCache memory zero uses supplied root at the current boundary" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.add(0, 2);
    const head = try h.make(0);
    defer head.unref();
    try Harness.setRoot(head, h.base_epoch * spe - 1, 1);
    try testing.expectEqual(@as(usize, 1), try h.cache.processState(io, @splat(2), head));
    try testing.expect(h.cache.get(io, h.cp(0, 2)) == null);
    try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))) == null);
}

test "PersistentCheckpointStateCache finalization prunes before writing" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    const head = try h.make(1);
    defer head.unref();
    try head.get().state.setFinalizedCheckpoint(&h.cp(1, 1));
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), head));
    const files = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(files);
    try testing.expectEqual(@as(usize, 0), files.len);
}

test "PersistentCheckpointStateCache flat retention queues disk deletes and re-add cancels them" {
    const h = try Harness.init(.{ .memory = 1, .disk = .{ .flat = 1 } });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.add(1, 1);
    try h.add(2, 1);
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    try h.cache.drainPendingDeletes(io);
    try testing.expect((try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)) == null);
    const keys = try h.cache.dumpCheckpointKeys(allocator);
    defer allocator.free(keys);
    try testing.expectEqual(@as(usize, 2), keys.len);
}

test "PersistentCheckpointStateCache tier retention keeps finalized and justified anchors" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    h.cache.onCheckpoint(h.base_epoch, h.base_epoch + 1);
    for (0..60) |offset| {
        try h.add(@intCast(offset), 1);
        try h.persist(h.cp(@intCast(offset), 1));
    }
    const keys = try h.cache.dumpCheckpointKeys(allocator);
    defer allocator.free(keys);
    try testing.expect(keys.len < 40);
    const finalized = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))).?;
    defer finalized.deinit(allocator);
    const justified = (try h.cache.getStateOrBytes(io, allocator, h.cp(1, 1))).?;
    defer justified.deinit(allocator);
    h.cache.onCheckpoint(h.base_epoch, h.base_epoch + 60);
    try h.add(60, 1);
    try h.persist(h.cp(60, 1));
    try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(1, 1))) == null);
    try h.cache.clear(io);
    const files = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(files);
    try testing.expectEqual(@as(usize, 0), files.len);
}

test "PersistentCheckpointStateCache startup removes previous run only after recovery" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    var next = try Cache.init(allocator, &h.block, .{ .data_dir = h.path });
    defer next.deinit(io);
    // A startup reader can still recover the file before cache initialization.
    const bytes = (try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)).?;
    defer allocator.free(bytes);
    try testing.expectEqual(h.base_epoch * spe, try st.getStateSlotFromBytes(bytes));
    try next.initStore(io);
    try testing.expect((try next.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)) == null);
    try testing.expectError(error.AlreadyInitialized, next.initStore(io));
}

test "PersistentCheckpointStateCache allocation failures leave ownership and indexes intact" {
    const h = try Harness.init(.{});
    defer h.deinit();
    const state = try h.make(0);
    defer state.unref();
    try testing.checkAllAllocationFailures(allocator, struct {
        fn run(gpa: Allocator, harness: *Harness, owner: *st.CachedBeaconStateRc) !void {
            var cache = try Cache.init(gpa, &harness.block, .{ .data_dir = harness.path });
            defer cache.deinit(io);
            try cache.add(io, harness.cp(0, 1), owner);
            try cache.add(io, harness.cp(0, 2), owner);
        }
    }.run, .{ h, state });
    try testing.expectEqual(@as(u32, 1), state.ref_count.load(.monotonic));
}

test "PersistentCheckpointStateCache deletion failures remain retryable" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const dk = key.datastoreKey(h.cp(0, 1));
    const name = try std.fmt.allocPrint(allocator, "0x{x}", .{&dk});
    defer allocator.free(name);
    try h.cache.store.remove(io, dk);
    try h.cache.store.dir.?.createDir(io, name, .default_dir);
    try testing.expectError(error.IsDir, h.cache.clear(io));
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    try h.cache.store.dir.?.deleteDir(io, name);
    try h.cache.drainPendingDeletes(io);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.removed_files);
}

test "PersistentCheckpointStateCache seed preference and block fallback" {
    const h = try Harness.init(.{ .memory = 2 });
    defer h.deinit();
    const cp = h.cp(0, 3);
    const first = try h.make(1);
    defer first.unref();
    const matching = try h.make(1);
    defer matching.unref();
    try Harness.setRoot(matching, cp.epoch * spe, 3);
    try h.cache.add(io, h.cp(1, 1), first);
    try h.cache.add(io, h.cp(1, 3), matching);
    try h.add(2, 4);
    try testing.expectEqual(matching.get(), (try h.cache.findSeedStateToReload(cp)).?);
    try testing.expectEqual(first.get(), (try h.cache.findSeedStateToReload(h.cp(0, 99))).?);
    const owned = (try h.cache.refSeedStateToReload(cp)).?;
    defer owned.unref();
    try h.cache.clear(io);
    try h.block.add(io, first, false);
    try testing.expectEqual(first.get(), (try h.cache.findSeedStateToReload(cp)).?);
}

test "PersistentCheckpointStateCache skipped boundary and reorg retain both branches" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    try h.add(0, 1);
    try h.add(0, 2);
    try h.add(1, 1);
    const head = try h.make(1);
    defer head.unref();
    try Harness.setRoot(head, h.base_epoch * spe - 1, 1);
    try Harness.setRoot(head, h.base_epoch * spe, 1);
    try testing.expectEqual(@as(usize, 2), try h.cache.processState(io, @splat(1), head));
    const reloaded = (try h.cache.getOrReload(io, h.cp(0, 2))).?;
    defer reloaded.unref();
    try h.cache.add(io, h.cp(0, 2), reloaded);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), head));
    try testing.expect(h.cache.get(io, h.cp(0, 2)) == null);
    const disk = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 2))).?;
    defer disk.deinit(allocator);
}

test "PersistentCheckpointStateCache tier promotion and deletion keep all epoch roots together" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    h.cache.onCheckpoint(h.base_epoch, h.base_epoch);
    for (0..34) |offset| {
        try h.add(@intCast(offset), 1);
        try h.persist(h.cp(@intCast(offset), 1));
        if (offset == 0 or offset == 1 or offset == 16) {
            try h.add(@intCast(offset), 2);
            try h.persist(h.cp(@intCast(offset), 2));
        }
    }
    for ([_]u64{ 0, 16 }) |offset| {
        for ([_]u8{ 1, 2 }) |root| {
            const data = (try h.cache.getStateOrBytes(io, allocator, h.cp(offset, root))).?;
            data.deinit(allocator);
        }
    }
    for ([_]u8{ 1, 2 }) |root| try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(1, root))) == null);
}

test "PersistentCheckpointStateCache retained state survives cache destruction" {
    const h = try Harness.init(.{});
    defer h.deinit();
    const state = try h.make(0);
    defer state.unref();
    var cache = try Cache.init(allocator, &h.block, .{ .data_dir = h.path });
    try cache.add(io, h.cp(0, 1), state);
    const owned = cache.ref(io, h.cp(0, 1)).?;
    defer owned.unref();
    cache.deinit(io);
    try testing.expectEqual(h.base_epoch * spe, try owned.get().state.slot());
    try testing.expectEqual(@as(u32, 2), owned.ref_count.load(.monotonic));
}

test "PersistentCheckpointStateCache restores valid files with bounded reads" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.add(1, 1);
    h.cache.max_state_bytes = 16;
    try testing.expectError(error.StreamTooLong, h.cache.getOrReload(io, h.cp(0, 1)));
    try testing.expectError(error.StreamTooLong, h.cache.getStateOrBytes(io, allocator, h.cp(0, 1)));
}

test "PersistentCheckpointStateCache rejects oversized writes and reloads without losing owners" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    try h.add(0, 1);
    try h.add(1, 2);
    const head = try h.make(0);
    defer head.unref();
    const normal_limit = h.cache.max_state_bytes;
    h.cache.max_state_bytes = 16;
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), head));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.failed_epochs);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.persists);
    try testing.expect(h.cache.get(io, h.cp(0, 1)) != null);
    h.cache.max_state_bytes = normal_limit;
    try h.persist(h.cp(0, 1));
    h.cache.max_state_bytes = 16;
    try testing.expectError(error.StreamTooLong, h.cache.getOrReload(io, h.cp(0, 1)));
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    h.cache.max_state_bytes = normal_limit;
    const restored = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    restored.unref();
}

test "PersistentCheckpointStateCache filesystem filename matches the JS SSZ checkpoint key" {
    const h = try Harness.init(.{});
    defer h.deinit();
    var cp: Checkpoint = .{ .epoch = 0x0102030405060708, .root = undefined };
    for (&cp.root, 0..) |*byte, i| byte.* = @intCast(i);
    const dk = try h.cache.store.write(io, cp, "state bytes");
    const name = "0x0807060504030201000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const bytes = try h.cache.store.dir.?.readFileAlloc(io, name, allocator, .limited(100));
    defer allocator.free(bytes);
    try testing.expectEqualStrings("state bytes", bytes);
    try h.cache.store.remove(io, dk);
    try testing.expectError(error.FileNotFound, h.cache.store.dir.?.access(io, name, .{}));
}

test "PersistentCheckpointStateCache promotes aligned epochs through multiple tiers" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    h.cache.onCheckpoint(h.base_epoch, h.base_epoch + 512);
    for (0..50) |i| {
        const offset: u64 = @intCast(i * 16);
        try h.add(offset, 1);
        try h.persist(h.cp(offset, 1));
    }
    for ([_]u64{ 0, 256, 512 }) |offset| {
        const data = (try h.cache.getStateOrBytes(io, allocator, h.cp(offset, 1))).?;
        data.deinit(allocator);
    }
    for ([_]u64{ 16, 32, 240, 272 }) |offset|
        try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(offset, 1))) == null);
}

test "PersistentCheckpointStateCache JS filesystem interoperability" {
    if (!try testing.environ.containsUnempty(allocator, "LODESTAR_CP_INTEROP")) return error.SkipZigTest;
    const h = try Harness.init(.{});
    defer h.deinit();
    const source = try h.make(0);
    defer source.unref();
    const expected_root = (try source.get().state.hashTreeRoot()).*;
    try h.cache.add(io, h.cp(0, 0xab), source);
    try h.persist(h.cp(0, 0xab));
    const epoch_str = try std.fmt.allocPrint(allocator, "{d}", .{h.base_epoch});
    defer allocator.free(epoch_str);
    const state_root_hex = try std.fmt.allocPrint(allocator, "0x{x}", .{&expected_root});
    defer allocator.free(state_root_hex);
    var env = try testing.environ.createMap(allocator);
    defer env.deinit();
    try env.put("LODESTAR_PRESET", if (spe == 8) "minimal" else if (spe == 16) "gnosis" else "mainnet");
    const script =
        \\import assert from "node:assert/strict";
        \\import {readdir} from "node:fs/promises";
        \\import {ssz} from "./packages/types/lib/index.js";
        \\import {FileCPStateDatastore} from "./packages/beacon-node/lib/chain/stateCache/datastore/file.js";
        \\const [dir, epoch, expectedRoot] = process.argv.slice(1);
        \\const store = new FileCPStateDatastore(dir);
        \\const nativeCp = {epoch: Number(epoch), root: new Uint8Array(32).fill(0xab)};
        \\const nativeKey = ssz.phase0.Checkpoint.serialize(nativeCp);
        \\const filename = "0x" + Buffer.from(nativeKey).toString("hex");
        \\assert.equal(filename.length, 82);
        \\assert.deepEqual(await readdir(dir + "/checkpoint_states"), [filename]);
        \\assert.deepEqual((await store.readKeys()).map(b => Buffer.from(b).toString("hex")), [Buffer.from(nativeKey).toString("hex")]);
        \\const bytes = await store.read(nativeKey);
        \\const state = ssz.electra.BeaconState.deserialize(bytes);
        \\assert.equal("0x" + Buffer.from(ssz.electra.BeaconState.hashTreeRoot(state)).toString("hex"), expectedRoot);
        \\const jsBytes = ssz.electra.BeaconState.serialize(state);
        \\assert.deepEqual(Buffer.from(jsBytes), Buffer.from(bytes));
        \\assert.deepEqual(Buffer.from(await store.readLatestSafe()), Buffer.from(bytes));
        \\await store.remove(nativeKey);
        \\assert.equal(await store.read(nativeKey), null);
        \\await store.write({epoch: Number(epoch), root: new Uint8Array(32).fill(0xcd)}, jsBytes);
    ;
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ "node", "--input-type=module", "-e", script, h.path, epoch_str, state_root_hex },
        .environ_map = &env,
        .stdout_limit = .limited(4096),
        .stderr_limit = .limited(8192),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    if (result.term != .exited or result.term.exited != 0) {
        std.debug.print("JS checkpoint interoperability failed: {s}\n", .{result.stderr});
        return error.JavascriptInteropFailed;
    }
    const keys = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(keys);
    try testing.expectEqual(@as(usize, 1), keys.len);
    try testing.expectEqual(key.datastoreKey(h.cp(0, 0xcd)), keys[0]);
    const bytes = (try h.cache.store.read(io, allocator, keys[0], .limited(h.cache.max_state_bytes))).?;
    defer allocator.free(bytes);
    const restored = try source.get().loadCachedBeaconState(allocator, io, bytes, null);
    defer {
        restored.deinit();
        allocator.destroy(restored);
    }
    try testing.expectEqualSlices(u8, &expected_root, try restored.state.hashTreeRoot());
    try h.cache.store.remove(io, keys[0]);
    const remaining = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(remaining);
    try testing.expectEqual(@as(usize, 0), remaining.len);
}

test "PersistentCheckpointStateCache re-add before draining preserves the persisted file" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    h.cache.queueFinalizedPrune(h.base_epoch + 1);
    try h.add(0, 1);
    try h.cache.drainPendingDeletes(io);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.removed_files);
    try testing.expect(h.cache.get(io, h.cp(0, 1)) != null);
    const head = try h.make(0);
    defer head.unref();
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(1), head));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.persists);
    const disk = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))).?;
    defer disk.deinit(allocator);
    try testing.expectEqual(h.base_epoch * spe, try st.getStateSlotFromBytes(disk.bytes));
}

test "PersistentCheckpointStateCache re-add after deletion needs a fresh write" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.cache.pruneFinalized(io, h.base_epoch + 1);
    try testing.expectEqual(@as(u64, 1), h.cache.stats.removed_files);
    try testing.expect((try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 1)), .unlimited)) == null);
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try testing.expectEqual(@as(u64, 2), h.cache.stats.persists);
    const disk = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))).?;
    defer disk.deinit(allocator);
    try testing.expectEqual(h.base_epoch * spe, try st.getStateSlotFromBytes(disk.bytes));
}

test "PersistentCheckpointStateCache host maintenance uses the same branch selection" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    try h.add(0, 1);
    try h.add(0, 2);
    try h.add(1, 3);
    const head = try h.make(1);
    defer head.unref();
    try Harness.setRoot(head, h.base_epoch * spe - 1, 1);
    try Harness.setRoot(head, h.base_epoch * spe, 2);
    h.cache.queueFinalizedPrune(h.base_epoch);
    const epochs = try h.cache.getEpochsToPersist(allocator, h.base_epoch + 1);
    defer allocator.free(epochs);
    try testing.expectEqualSlices(u64, &.{h.base_epoch}, epochs);
    const writes = try h.cache.preparePastEpoch(allocator, @splat(3), head.get(), epochs[0]);
    defer allocator.free(writes);
    try testing.expectEqual(@as(usize, 1), writes.len);
    try testing.expectEqual(h.cp(0, 2), writes[0]);
    try h.persist(writes[0]);
    try testing.expect((try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))) == null);
}

test "PersistentCheckpointStateCache cached-state restoration cleans every allocation failure" {
    const h = try Harness.init(.{});
    defer h.deinit();
    const source = try h.make(0);
    defer source.unref();
    const bytes = try source.get().state.serialize(allocator);
    defer allocator.free(bytes);
    try testing.checkAllAllocationFailures(allocator, struct {
        fn run(gpa: Allocator, seed: *st.CachedBeaconState, data: []const u8) !void {
            const restored = try seed.loadCachedBeaconState(gpa, io, data, null);
            const owner = st.CachedBeaconStateRc.create(gpa, restored) catch |err| {
                restored.deinit();
                gpa.destroy(restored);
                return err;
            };
            defer owner.unref();
            _ = try owner.get().state.hashTreeRoot();
        }
    }.run, .{ source.get(), bytes });
}

test "PersistentCheckpointStateCache pool exhaustion is not corrupt data or a cache miss" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.add(1, 2);
    const spare = h.pool.nodes.len - h.pool.nodes_in_use;
    const held = try allocator.alloc(Node.Id, spare);
    defer allocator.free(held);
    var count: usize = 0;
    defer for (held[0..count]) |node| h.pool.unref(node);
    while (count < held.len) : (count += 1) held[count] = try h.pool.createLeafFromUint(123);
    try testing.expectError(error.PoolExhausted, h.cache.getOrReload(io, h.cp(0, 1)));
    try testing.expectError(error.PoolExhausted, h.cache.getOrReloadLatest(io, @splat(1), null));
}

test "PersistentCheckpointStateCache review: failed finalized delete does not stall writes or other deletes" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    for ([_]u8{ 1, 2, 3 }) |root| {
        try h.add(0, root);
        try h.persist(h.cp(0, root));
    }
    for ([_]u8{ 1, 2 }) |root| {
        const dk = key.datastoreKey(h.cp(0, root));
        const name = try std.fmt.allocPrint(allocator, "0x{x}", .{&dk});
        defer allocator.free(name);
        try h.cache.store.remove(io, dk);
        try h.cache.store.dir.?.createDir(io, name, .default_dir);
    }
    try h.add(1, 4);
    try h.add(2, 5);
    const head = try h.make(2);
    defer head.unref();
    try head.get().state.setFinalizedCheckpoint(&.{ .epoch = h.base_epoch + 1, .root = @splat(4) });
    try Harness.setRoot(head, (h.base_epoch + 1) * spe - 1, 4);
    try Harness.setRoot(head, (h.base_epoch + 1) * spe, 4);
    try testing.expectEqual(@as(usize, 1), try h.cache.processState(io, @splat(5), head));
    try testing.expectEqual(@as(u64, 4), h.cache.stats.failed_deletes);
    try testing.expectEqual(@as(u64, 1), h.cache.stats.removed_files);
    try testing.expect(h.cache.get(io, h.cp(1, 4)) == null);
    try testing.expect((try h.cache.store.read(io, allocator, key.datastoreKey(h.cp(0, 3)), .unlimited)) == null);
    const data = (try h.cache.getStateOrBytes(io, allocator, h.cp(1, 4))).?;
    defer data.deinit(allocator);
    try testing.expectError(error.IsDir, h.cache.drainPendingDeletes(io));
}

test "PersistentCheckpointStateCache review: trailing delete failure preserves the persisted count" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    h.cache.onCheckpoint(h.base_epoch, h.base_epoch);
    for (1..17) |offset| {
        try h.add(@intCast(offset), 1);
        try h.persist(h.cp(@intCast(offset), 1));
    }
    const dk = key.datastoreKey(h.cp(1, 1));
    const name = try std.fmt.allocPrint(allocator, "0x{x}", .{&dk});
    defer allocator.free(name);
    try h.cache.store.remove(io, dk);
    try h.cache.store.dir.?.createDir(io, name, .default_dir);
    try h.add(17, 1);
    const head = try h.make(17);
    defer head.unref();
    try testing.expectEqual(@as(usize, 1), try h.cache.processState(io, @splat(1), head));
    try testing.expect(h.cache.get(io, h.cp(17, 1)) == null);
    try testing.expectEqual(@as(u64, 1), h.cache.stats.failed_deletes);
    try testing.expectError(error.IsDir, h.cache.drainPendingDeletes(io));
}

test "PersistentCheckpointStateCache review: mid-epoch anchor retains its slot through persistence" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    const anchor = try h.make(0);
    defer anchor.unref();
    const slot = h.base_epoch * spe + 3;
    try anchor.get().state.setSlot(slot);
    try anchor.get().state.commit();
    const computed = try st.AnchorCheckpoint.fromState(anchor.get().state);
    const cp: Checkpoint = .{ .epoch = computed.checkpoint.epoch, .root = computed.checkpoint.root };
    try testing.expectEqual(h.base_epoch + 1, cp.epoch);
    const path = try std.fs.path.join(allocator, &.{ h.path, "anchor" });
    defer allocator.free(path);
    var cache = try Cache.init(allocator, &h.block, .{ .data_dir = path, .max_epochs_in_memory = 0 });
    defer cache.deinit(io);
    try testing.expectError(error.InvalidCheckpoint, cache.add(io, h.cp(0, 1), anchor));
    try cache.add(io, cp, anchor);
    try cache.initStore(io);
    try h.block.add(io, anchor, false);
    const head = try h.make(1);
    defer head.unref();
    try testing.expectEqual(@as(usize, 1), try cache.processState(io, cp.root, head));
    const restored = (try cache.getOrReload(io, cp)).?;
    defer restored.unref();
    try testing.expectEqual(slot, try restored.get().state.slot());
    try testing.expectEqualSlices(u8, try anchor.get().state.hashTreeRoot(), try restored.get().state.hashTreeRoot());
}

test "PersistentCheckpointStateCache repeated reloads share the resident owner" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const seed = try h.make(1);
    defer seed.unref();
    try h.block.add(io, seed, false);
    const winner = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer winner.unref();
    try h.cache.store.remove(io, key.datastoreKey(h.cp(0, 1)));
    const other = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer other.unref();
    try testing.expectEqual(winner, other);
    try testing.expectEqual(@as(u32, 3), winner.ref_count.load(.monotonic));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.reloads);
}

test "PersistentCheckpointStateCache re-added residents bypass disk reload" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const replacement = try h.make(0);
    defer replacement.unref();
    try h.cache.add(io, h.cp(0, 1), replacement);
    try h.cache.store.remove(io, key.datastoreKey(h.cp(0, 1)));
    _ = try h.cache.store.write(io, h.cp(0, 1), "invalid");
    const resident = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer resident.unref();
    try testing.expectEqual(replacement, resident);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.reloads);
}

test "PersistentCheckpointStateCache review: unselected persisted residents count as memory prunes" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.add(1, 3);
    const resident = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    defer resident.unref();
    const head = try h.make(1);
    defer head.unref();
    try Harness.setRoot(head, h.base_epoch * spe - 1, 1);
    try Harness.setRoot(head, h.base_epoch * spe, 2);
    try testing.expectEqual(@as(usize, 0), try h.cache.processState(io, @splat(3), head));
    try testing.expectEqual(@as(u64, 1), h.cache.stats.pruned_from_memory);
    try testing.expect(h.cache.get(io, h.cp(0, 1)) == null);
    const data = (try h.cache.getStateOrBytes(io, allocator, h.cp(0, 1))).?;
    data.deinit(allocator);
}

test "PersistentCheckpointStateCache review: already absent files do not count as removed" {
    const h = try Harness.init(.{});
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    try h.cache.store.remove(io, key.datastoreKey(h.cp(0, 1)));
    try h.cache.clear(io);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.removed_files);
    try h.cache.drainPendingDeletes(io);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.removed_files);
}

test "PersistentCheckpointStateCache review: epoch plan allocates only the result" {
    const h = try Harness.init(.{ .memory = 1 });
    defer h.deinit();
    for ([_]u64{ 3, 0, 2, 1 }) |offset| try h.add(offset, 1);
    for ([_]u64{ h.base_epoch + 1, std.math.maxInt(u64) }) |max_epoch| {
        var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 1 });
        const epochs = try h.cache.getEpochsToPersist(failing.allocator(), max_epoch);
        defer failing.allocator().free(epochs);
        const expected = [_]u64{ h.base_epoch, h.base_epoch + 1, h.base_epoch + 2 };
        try testing.expectEqualSlices(u64, expected[0..if (max_epoch == h.base_epoch + 1) @as(usize, 2) else 3], epochs);
    }
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    const empty = try h.cache.getEpochsToPersist(failing.allocator(), h.base_epoch - 1);
    defer failing.allocator().free(empty);
    try testing.expectEqual(@as(usize, 0), empty.len);
}

test "PersistentCheckpointStateCache reload rejects bytes from a different checkpoint epoch" {
    const h = try Harness.init(.{ .memory = 0 });
    defer h.deinit();
    try h.add(0, 1);
    try h.persist(h.cp(0, 1));
    const seed = try h.make(1);
    defer seed.unref();
    try h.block.add(io, seed, false);
    const bytes = try seed.get().state.serialize(allocator);
    defer allocator.free(bytes);
    const dk = key.datastoreKey(h.cp(0, 1));
    const original = (try h.cache.store.read(io, allocator, dk, .unlimited)).?;
    defer allocator.free(original);
    try h.cache.store.remove(io, dk);
    _ = try h.cache.store.write(io, h.cp(0, 1), bytes);
    try testing.expectError(error.InvalidCheckpoint, h.cache.getOrReload(io, h.cp(0, 1)));
    try testing.expectEqual(@as(u32, 2), seed.ref_count.load(.monotonic));
    try h.cache.store.remove(io, dk);
    _ = try h.cache.store.write(io, h.cp(0, 1), original);
    const state = (try h.cache.getOrReload(io, h.cp(0, 1))).?;
    state.unref();
}

test "PersistentCheckpointStateCache canceled deletion stops the drain and leaves files retryable" {
    const h = try Harness.init(.{});
    defer h.deinit();
    for ([_]u8{ 1, 2 }) |root| {
        try h.add(0, root);
        try h.persist(h.cp(0, root));
    }
    h.cache.queueFinalizedPrune(h.base_epoch + 1);
    var attempts: usize = 0;
    var vtable = std.Io.failing.vtable.*;
    vtable.dirDeleteFile = struct {
        fn remove(context: ?*anyopaque, _: std.Io.Dir, _: []const u8) std.Io.Dir.DeleteFileError!void {
            const calls: *usize = @ptrCast(@alignCast(context.?));
            calls.* += 1;
            return error.Canceled;
        }
    }.remove;
    const canceled_io: std.Io = .{ .userdata = &attempts, .vtable = &vtable };
    const head = try h.make(1);
    defer head.unref();
    try testing.expectError(error.Canceled, h.cache.processState(canceled_io, @splat(3), head));
    try testing.expectEqual(@as(usize, 1), attempts);
    try testing.expectEqual(@as(u32, 1), head.ref_count.load(.monotonic));
    try testing.expectEqual(@as(u64, 0), h.cache.stats.failed_deletes);
    try testing.expectEqual(@as(u64, 0), h.cache.stats.removed_files);
    const files = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(files);
    try testing.expectEqual(@as(usize, 2), files.len);
    try h.cache.drainPendingDeletes(io);
    try testing.expectEqual(@as(u64, 2), h.cache.stats.removed_files);
    const remaining = try h.cache.store.readKeys(io, allocator);
    defer allocator.free(remaining);
    try testing.expectEqual(@as(usize, 0), remaining.len);
    try h.cache.drainPendingDeletes(io);
    try testing.expectEqual(@as(u64, 2), h.cache.stats.removed_files);
}
