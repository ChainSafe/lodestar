//! Tests for `cp_datastore.zig`.

const std = @import("std");
const Allocator = std.mem.Allocator;
const key_mod = @import("key.zig");
const DatastoreKey = key_mod.DatastoreKey;
const Checkpoint = key_mod.Checkpoint;
const datastoreKey = key_mod.datastoreKey;
const state_transition = @import("state_transition");
const computeStartSlotAtEpoch = state_transition.computeStartSlotAtEpoch;
const getStateSlotFromBytes = state_transition.getStateSlotFromBytes;
const testing = std.testing;
const cp_datastore = @import("cp_datastore.zig");
const CPStateDatastore = cp_datastore.CPStateDatastore;
const FileCPStateDatastore = cp_datastore.FileCPStateDatastore;
const InMemoryCPStateDatastore = cp_datastore.InMemoryCPStateDatastore;

const FileStoreFixture = struct {
    tmp: testing.TmpDir,
    base: []u8,
    store: FileCPStateDatastore,

    fn init(allocator: Allocator) !FileStoreFixture {
        var tmp = testing.tmpDir(.{});
        errdefer tmp.cleanup();

        const base = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
        errdefer allocator.free(base);

        const store = try FileCPStateDatastore.init(allocator, base);
        return .{ .tmp = tmp, .base = base, .store = store };
    }

    fn deinit(self: *FileStoreFixture, allocator: Allocator, io: std.Io) void {
        self.store.deinit(io);
        allocator.free(self.base);
        self.tmp.cleanup();
    }

    fn datastore(self: *FileStoreFixture) CPStateDatastore {
        return self.store.datastore();
    }
};

// Craft a minimal serialized-state buffer with just the two fields `readLatestSafe` reads:
// `state.slot` at offset 40 and `latest_block_header.slot` (last processed slot) at offset 64.
fn makeStateBytes(allocator: Allocator, state_slot: u64, last_processed_slot: u64) ![]u8 {
    const buf = try allocator.alloc(u8, 72);
    @memset(buf, 0);
    std.mem.writeInt(u64, buf[40..][0..8], state_slot, .little);
    std.mem.writeInt(u64, buf[64..][0..8], last_processed_slot, .little);
    return buf;
}

test "InMemoryCPStateDatastore write/read/remove and insertion-ordered keys" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();

    const ds = store.datastore();

    const key_a = Checkpoint{ .root = [_]u8{0xa1} ** 32, .epoch = 5 };
    const key_b = Checkpoint{ .root = [_]u8{0xb2} ** 32, .epoch = 7 };

    const dk_a = try ds.write(io, key_a, "alpha");
    const dk_b = try ds.write(io, key_b, "beta");

    // Re-writing the same key must NOT overwrite or reorder.
    _ = try ds.write(io, key_a, "OVERWRITE-ATTEMPT");

    const read_a = (try ds.read(io, allocator, dk_a)).?;
    defer allocator.free(read_a);

    try testing.expectEqualStrings("alpha", read_a);

    const keys = try ds.readKeys(io, allocator);
    defer allocator.free(keys);

    try testing.expectEqual(@as(usize, 2), keys.len);
    try testing.expectEqualSlices(u8, &dk_a, &keys[0]);
    try testing.expectEqualSlices(u8, &dk_b, &keys[1]);

    try ds.remove(io, dk_a);
    try testing.expect((try ds.read(io, allocator, dk_a)) == null);

    const keys_after = try ds.readKeys(io, allocator);
    defer allocator.free(keys_after);

    try testing.expectEqual(@as(usize, 1), keys_after.len);
    try testing.expectEqualSlices(u8, &dk_b, &keys_after[0]);
}

test "InMemoryCPStateDatastore removeMany removes all keys sequentially and is no-op when absent" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();

    const ds = store.datastore();

    var keys: [8]DatastoreKey = undefined;
    for (0..8) |i| keys[i] = try ds.write(io, .{ .root = [_]u8{@intCast(i + 1)} ** 32, .epoch = @intCast(i) }, "x");
    {
        const before = try ds.readKeys(io, allocator);
        defer allocator.free(before);

        try testing.expectEqual(@as(usize, 8), before.len);
    }

    try ds.removeMany(io, allocator, &keys);
    {
        const after = try ds.readKeys(io, allocator);
        defer allocator.free(after);

        try testing.expectEqual(@as(usize, 0), after.len);
    }

    // Re-removing the now-absent keys must be a clean no-op.
    try ds.removeMany(io, allocator, &keys);
    {
        const after = try ds.readKeys(io, allocator);
        defer allocator.free(after);

        try testing.expectEqual(@as(usize, 0), after.len);
    }
}

test "FileCPStateDatastore write/read/remove/readKeys round-trip" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);
    const ds = fx.datastore();
    try ds.initStore(io);

    const key_a = Checkpoint{ .root = [_]u8{0xc3} ** 32, .epoch = 9 };
    const dk_a = try ds.write(io, key_a, "gamma-bytes");

    // A second write of the same key is a no-op (the existing final file is kept).
    _ = try ds.write(io, key_a, "ignored");

    const read_a = (try ds.read(io, allocator, dk_a)).?;
    defer allocator.free(read_a);
    try testing.expectEqualStrings("gamma-bytes", read_a);

    const keys = try ds.readKeys(io, allocator);
    defer allocator.free(keys);
    try testing.expectEqual(@as(usize, 1), keys.len);
    try testing.expectEqualSlices(u8, &dk_a, &keys[0]);

    try ds.remove(io, dk_a);
    try testing.expect((try ds.read(io, allocator, dk_a)) == null);
    // Removing an absent key is a no-op.
    try ds.remove(io, dk_a);
}

test "FileCPStateDatastore readLatestSafe returns the winner's full bytes" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);
    const ds = fx.datastore();
    try ds.initStore(io);

    const slot = computeStartSlotAtEpoch(10);
    const head = try makeStateBytes(allocator, slot, slot);
    defer allocator.free(head);
    // A tail beyond the prefix length, so a prefix-only return fails the comparison.
    const bytes = try std.mem.concat(allocator, u8, &.{ head, "tail-beyond-the-prefix" });
    defer allocator.free(bytes);
    _ = try ds.write(io, .{ .root = [_]u8{0x22} ** 32, .epoch = 10 }, bytes);

    const got = (try ds.readLatestSafe(io, allocator)).?;
    defer allocator.free(got);
    try testing.expectEqualSlices(u8, bytes, got);
}

test "FileCPStateDatastore readLatestSafe skips a huge-epoch foreign key" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);
    const ds = fx.datastore();
    try ds.initStore(io);

    const bytes = try makeStateBytes(allocator, 320, 320);
    defer allocator.free(bytes);
    _ = try ds.write(io, .{ .root = [_]u8{0xab} ** 32, .epoch = std.math.maxInt(u64) }, bytes);

    try testing.expect((try ds.readLatestSafe(io, allocator)) == null);
}

test "FileCPStateDatastore initStore sweeps temp debris and write leaves none" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);
    const ds = fx.datastore();
    try ds.initStore(io);

    // Plant torn debris; it is not a key (wrong name shape), so readKeys ignores it.
    const dir = fx.store.dir.?;
    try dir.writeFile(io, .{ .sub_path = "0xdead.tmp", .data = &[_]u8{ 1, 2, 3 } });
    const empty = try ds.readKeys(io, allocator);
    defer allocator.free(empty);
    try testing.expectEqual(@as(usize, 0), empty.len);

    // A restart (fresh store on the same dir) sweeps the debris at initStore.
    var store2 = try FileCPStateDatastore.init(allocator, fx.base);
    defer store2.deinit(io);
    const ds2 = store2.datastore();
    try ds2.initStore(io);
    try testing.expectError(error.FileNotFound, dir.access(io, "0xdead.tmp", .{}));

    // A completed write renames its temp into place: the final file is the only entry left.
    const dk = try ds2.write(io, .{ .root = [_]u8{0xcd} ** 32, .epoch = 3 }, "full-state-bytes");
    const read_back = (try ds2.read(io, allocator, dk)).?;
    defer allocator.free(read_back);
    try testing.expectEqualStrings("full-state-bytes", read_back);
    var it = dir.iterate();
    var count: usize = 0;
    while (try it.next(io)) |_| count += 1;
    try testing.expectEqual(@as(usize, 1), count);
}

test "FileCPStateDatastore initStore is repeatable" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);
    const ds = fx.datastore();
    try ds.initStore(io);
    try ds.initStore(io);

    const dk = try ds.write(io, .{ .root = [_]u8{0x11} ** 32, .epoch = 1 }, "bytes");
    const back = (try ds.read(io, allocator, dk)).?;
    defer allocator.free(back);
    try testing.expectEqualStrings("bytes", back);
}

test "FileCPStateDatastore initStore opens an existing dir without clobbering" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);

    const key = Checkpoint{ .root = [_]u8{0xe5} ** 32, .epoch = 11 };
    var dk: DatastoreKey = undefined;

    // First store persists a state; the fixture's own store owns the dir.
    {
        const ds = fx.datastore();
        try ds.initStore(io);
        dk = try ds.write(io, key, "persisted-bytes");
    }

    // Re-open the SAME dir with a fresh store (the restart case).
    {
        var store = try FileCPStateDatastore.init(allocator, fx.base);
        defer store.deinit(io);
        const ds = store.datastore();
        // Dir already exists from the first store: must succeed, opening it.
        try ds.initStore(io);

        const keys = try ds.readKeys(io, allocator);
        defer allocator.free(keys);

        try testing.expectEqual(@as(usize, 1), keys.len);
        try testing.expectEqualSlices(u8, &dk, &keys[0]);

        const bytes = (try ds.read(io, allocator, dk)).?;
        defer allocator.free(bytes);

        try testing.expectEqualStrings("persisted-bytes", bytes);
    }
}

test "FileCPStateDatastore operations before initStore return DatastoreNotInitialized" {
    const allocator = testing.allocator;
    const io = std.testing.io;

    var fx = try FileStoreFixture.init(allocator);
    defer fx.deinit(allocator, io);

    const ds = fx.datastore();

    const cp = Checkpoint{ .root = [_]u8{0x01} ** 32, .epoch = 1 };
    const dk = datastoreKey(cp);

    try testing.expectError(error.DatastoreNotInitialized, ds.write(io, cp, "x"));
    try testing.expectError(error.DatastoreNotInitialized, ds.read(io, allocator, dk));
    try testing.expectError(error.DatastoreNotInitialized, ds.remove(io, dk));
    try testing.expectError(error.DatastoreNotInitialized, ds.readKeys(io, allocator));
}

test "FileCPStateDatastore removeMany fans out concurrently" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const base = try std.fs.path.join(testing.allocator, &.{ ".zig-cache", "tmp", &tmp.sub_path });
    defer testing.allocator.free(base);

    // `.limited(4)` forces real concurrency for the fan-out regardless of host core count.
    var threaded: std.Io.Threaded = .init(testing.allocator, .{ .async_limit = .limited(4) });
    defer threaded.deinit();
    const io = threaded.io();

    var store = try FileCPStateDatastore.init(testing.allocator, base);
    defer store.deinit(io);
    const ds = store.datastore();
    try ds.initStore(io);

    var keys: [16]DatastoreKey = undefined;
    for (0..16) |i| keys[i] = try ds.write(io, .{ .root = [_]u8{@intCast(i + 1)} ** 32, .epoch = @intCast(i) }, "x");
    try ds.removeMany(io, testing.allocator, &keys);

    const after = try ds.readKeys(io, testing.allocator);
    defer testing.allocator.free(after);
    try testing.expectEqual(@as(usize, 0), after.len);
}

test "readLatestSafe returns null on an empty store" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();
    try testing.expect((try store.datastore().readLatestSafe(io, allocator)) == null);
}

test "readLatestSafe skips a fork epoch (two roots at one epoch is ambiguous)" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();
    const ds = store.datastore();

    // Two checkpoints at epoch 3 → can't tell which is canonical → readLatestSafe skips the epoch.
    const slot3 = computeStartSlotAtEpoch(3);
    for ([_]u8{ 0x31, 0x32 }) |tag| {
        const bytes = try makeStateBytes(allocator, slot3, slot3);
        defer allocator.free(bytes);

        _ = try ds.write(io, .{ .epoch = 3, .root = [_]u8{tag} ** 32 }, bytes);
    }

    try testing.expect((try ds.readLatestSafe(io, allocator)) == null);
}

test "readLatestSafe accepts a PRCS (last processed slot is boundary - 1)" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();
    const ds = store.datastore();

    // PRCS: the state's last-processed slot is one below its epoch boundary.
    const slot4 = computeStartSlotAtEpoch(4);
    const bytes = try makeStateBytes(allocator, slot4, slot4 - 1);
    defer allocator.free(bytes);

    _ = try ds.write(io, .{ .epoch = 4, .root = [_]u8{0x40} ** 32 }, bytes);

    const got = (try ds.readLatestSafe(io, allocator)).?;
    defer allocator.free(got);

    try testing.expectEqual(slot4, try getStateSlotFromBytes(got));
}

test "readLatestSafe returns the highest safe boundary, skipping a fork and an off-boundary state" {
    const allocator = testing.allocator;
    const io = std.testing.io;
    var store = InMemoryCPStateDatastore.init(allocator);
    defer store.deinit();
    const ds = store.datastore();

    const slot7 = computeStartSlotAtEpoch(7);
    const slot6 = computeStartSlotAtEpoch(6);
    const slot5 = computeStartSlotAtEpoch(5);

    // epoch 7: a fork (two roots) → skipped despite being newest.
    for ([_]u8{ 0x71, 0x72 }) |tag| {
        const bytes = try makeStateBytes(allocator, slot7, slot7);
        defer allocator.free(bytes);
        _ = try ds.write(io, .{ .epoch = 7, .root = [_]u8{tag} ** 32 }, bytes);
    }
    // epoch 6: single, but its state slot is 3 past the boundary (off-boundary) → skipped.
    const bytes6 = try makeStateBytes(allocator, slot6 + 3, slot6 + 3);
    defer allocator.free(bytes6);
    _ = try ds.write(io, .{ .epoch = 6, .root = [_]u8{0x60} ** 32 }, bytes6);
    // epoch 5: a clean boundary CRCS → the answer.
    const bytes5 = try makeStateBytes(allocator, slot5, slot5);
    defer allocator.free(bytes5);
    _ = try ds.write(io, .{ .epoch = 5, .root = [_]u8{0x50} ** 32 }, bytes5);

    const got = (try ds.readLatestSafe(io, allocator)).?;
    defer allocator.free(got);
    try testing.expectEqual(slot5, try getStateSlotFromBytes(got));
}
