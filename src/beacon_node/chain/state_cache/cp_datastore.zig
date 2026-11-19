const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;

const hex = @import("hex");

const DatastoreKey = @import("key.zig").DatastoreKey;
const DATASTORE_KEY_LEN = @import("key.zig").DATASTORE_KEY_LEN;
const Checkpoint = @import("key.zig").Checkpoint;
const datastoreKey = @import("key.zig").datastoreKey;
const datastoreKeyEpoch = @import("key.zig").datastoreKeyEpoch;

const types = @import("consensus_types");
const Epoch = types.primitive.Epoch.Type;

const state_transition = @import("state_transition");
const computeStartSlotAtEpoch = state_transition.computeStartSlotAtEpoch;
const computeEpochAtSlot = state_transition.computeEpochAtSlot;
const getStateSlotFromBytes = state_transition.getStateSlotFromBytes;
const getLastProcessedSlotFromStateBytes = state_transition.getLastProcessedSlotFromStateBytes;
const STATE_SLOTS_PREFIX_LEN = state_transition.STATE_SLOTS_PREFIX_LEN;

/// On-disk store for serialized checkpoint states. The backend is chosen at construction at RUNTIME
/// — so it is a vtable, not a comptime generic.
pub const CPStateDatastore = struct {
    ptr: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        /// Persist `state_bytes` for `key`, returning its `DatastoreKey`. Writing an existing key is
        /// a no-op (bytes are identical), preserving idempotence.
        write: *const fn (ctx: *anyopaque, io: std.Io, key: Checkpoint, state_bytes: []const u8) anyerror!DatastoreKey,
        /// Delete the state at `key`. Absent keys are ignored.
        remove: *const fn (ctx: *anyopaque, io: std.Io, dk: DatastoreKey) anyerror!void,
        /// Delete the states at `keys`, possibly fanned out concurrently. The first failure surfaces
        /// (after all run); absent keys are ignored.
        removeMany: *const fn (ctx: *anyopaque, io: std.Io, allocator: Allocator, keys: []const DatastoreKey) anyerror!void,
        /// Read the state bytes at `key` (allocated with `allocator`, caller frees), or null if absent.
        read: *const fn (ctx: *anyopaque, io: std.Io, allocator: Allocator, dk: DatastoreKey) anyerror!?[]u8,
        /// Read up to `buf.len` leading bytes of the state at `dk` into `buf`, returning the count
        /// read, or null if absent.
        readPrefix: *const fn (ctx: *anyopaque, io: std.Io, dk: DatastoreKey, buf: []u8) anyerror!?usize,
        /// All persisted keys. Caller frees the returned slice with `allocator`.
        readKeys: *const fn (ctx: *anyopaque, io: std.Io, allocator: Allocator) anyerror![]DatastoreKey,
        /// Optional one-time backend setup (e.g. ensure the directory exists).
        init: ?*const fn (ctx: *anyopaque, io: std.Io) anyerror!void,
    };

    pub fn write(self: CPStateDatastore, io: std.Io, key: Checkpoint, state_bytes: []const u8) !DatastoreKey {
        return self.vtable.write(self.ptr, io, key, state_bytes);
    }

    pub fn remove(self: CPStateDatastore, io: std.Io, dk: DatastoreKey) !void {
        return self.vtable.remove(self.ptr, io, dk);
    }

    pub fn removeMany(self: CPStateDatastore, io: std.Io, allocator: Allocator, keys: []const DatastoreKey) !void {
        return self.vtable.removeMany(self.ptr, io, allocator, keys);
    }

    pub fn read(self: CPStateDatastore, io: std.Io, allocator: Allocator, dk: DatastoreKey) !?[]u8 {
        return self.vtable.read(self.ptr, io, allocator, dk);
    }

    pub fn readPrefix(self: CPStateDatastore, io: std.Io, dk: DatastoreKey, buf: []u8) !?usize {
        return self.vtable.readPrefix(self.ptr, io, dk, buf);
    }

    pub fn readKeys(self: CPStateDatastore, io: std.Io, allocator: Allocator) ![]DatastoreKey {
        return self.vtable.readKeys(self.ptr, io, allocator);
    }

    pub fn initStore(self: CPStateDatastore, io: std.Io) !void {
        if (self.vtable.init) |init_fn| try init_fn(self.ptr, io);
    }

    /// Get the latest safe checkpoint state the node can use to boot from, or null:
    ///   - it should be the checkpoint state that's unique in its epoch,
    ///   - its last processed block slot should be at epoch boundary or last slot of previous epoch,
    ///   - state slot should be at epoch boundary,
    ///   - state slot should be equal to epoch * SLOTS_PER_EPOCH.
    ///
    /// Return the serialized data of Current Root Checkpoint State (CRCS) or Previous Root Checkpoint
    /// State (PRCS). Caller owns the returned bytes.
    pub fn readLatestSafe(self: CPStateDatastore, io: std.Io, allocator: Allocator) !?[]u8 {
        const keys = try self.readKeys(io, allocator);
        defer allocator.free(keys);

        if (keys.len == 0) return null;

        // Epoch-descending, so the first qualifying state encountered is the newest.
        std.mem.sort(DatastoreKey, keys, {}, struct {
            fn desc(_: void, a: DatastoreKey, b: DatastoreKey) bool {
                return datastoreKeyEpoch(a) > datastoreKeyEpoch(b);
            }
        }.desc);

        var prefix: [STATE_SLOTS_PREFIX_LEN]u8 = undefined;
        var i: usize = 0;
        while (i < keys.len) : (i += 1) {
            const epoch = datastoreKeyEpoch(keys[i]);
            // only consider epochs with a single checkpoint to avoid ambiguity from forks; sorted, so
            // an epoch's duplicates are adjacent.
            const prev_dup = i > 0 and datastoreKeyEpoch(keys[i - 1]) == epoch;
            const next_dup = i + 1 < keys.len and datastoreKeyEpoch(keys[i + 1]) == epoch;
            if (prev_dup or next_dup) continue;

            const n = (try self.readPrefix(io, keys[i], &prefix)) orelse continue;
            if (!isSafeCheckpointState(prefix[0..n], epoch)) continue;
            return (try self.read(io, allocator, keys[i])) orelse continue;
        }
        return null;
    }
};

/// Whether `state_bytes` is a safe boot state for `epoch`: at epoch boundary and a CRCS or PRCS.
/// Short or foreign bytes fail the slot reads (treated as unsafe) rather than asserting.
fn isSafeCheckpointState(state_bytes: []const u8, epoch: Epoch) bool {
    const state_slot = getStateSlotFromBytes(state_bytes) catch return false;
    const last_processed = getLastProcessedSlotFromStateBytes(state_bytes) catch return false;
    // not CRCS or PRCS, skip. Guard the subtract so a malformed slot-0 state cannot underflow.
    const is_crcs = last_processed == state_slot;
    const is_prcs = state_slot > 0 and last_processed == state_slot - 1;
    if (!is_crcs and !is_prcs) return false;
    // Division first: a huge on-disk epoch must read unsafe, not overflow the multiply below.
    if (computeEpochAtSlot(state_slot) != epoch) return false;
    // at epoch boundary (subsumes the slot % SLOTS_PER_EPOCH == 0 check).
    return state_slot == computeStartSlotAtEpoch(epoch);
}

/// In-memory datastore for tests. Backed by an insertion-ordered map so `readKeys` yields a stable
/// order and a write of an existing key is a no-op (no reorder).
pub const InMemoryCPStateDatastore = struct {
    allocator: Allocator,
    states: std.array_hash_map.Auto(DatastoreKey, []u8),

    pub fn init(allocator: Allocator) InMemoryCPStateDatastore {
        return .{ .allocator = allocator, .states = .empty };
    }

    pub fn deinit(self: *InMemoryCPStateDatastore) void {
        for (self.states.values()) |bytes| {
            self.allocator.free(bytes);
        }
        self.states.deinit(self.allocator);
    }

    pub fn datastore(self: *InMemoryCPStateDatastore) CPStateDatastore {
        return .{ .ptr = self, .vtable = &vtable };
    }

    const vtable = CPStateDatastore.VTable{
        .write = writeImpl,
        .remove = removeImpl,
        .removeMany = removeManyImpl,
        .read = readImpl,
        .readPrefix = readPrefixImpl,
        .readKeys = readKeysImpl,
        .init = null,
    };

    fn writeImpl(ctx: *anyopaque, io: std.Io, key: Checkpoint, state_bytes: []const u8) anyerror!DatastoreKey {
        _ = io;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        const dk = datastoreKey(key);
        if (self.states.contains(dk)) return dk;

        const owned = try self.allocator.dupe(u8, state_bytes);
        errdefer self.allocator.free(owned);

        try self.states.put(self.allocator, dk, owned);
        return dk;
    }

    fn removeImpl(ctx: *anyopaque, io: std.Io, dk: DatastoreKey) anyerror!void {
        _ = io;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        // `orderedRemove` keeps the surviving keys in insertion order.
        if (self.states.fetchOrderedRemove(dk)) |kv| {
            self.allocator.free(kv.value);
        }
    }

    fn removeManyImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator, keys: []const DatastoreKey) anyerror!void {
        _ = io;
        _ = allocator;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        for (keys) |dk| if (self.states.fetchOrderedRemove(dk)) |kv| self.allocator.free(kv.value);
    }

    fn readImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator, dk: DatastoreKey) anyerror!?[]u8 {
        _ = io;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        const bytes = self.states.get(dk) orelse return null;
        return try allocator.dupe(u8, bytes);
    }

    fn readPrefixImpl(ctx: *anyopaque, io: std.Io, dk: DatastoreKey, buf: []u8) anyerror!?usize {
        _ = io;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        const bytes = self.states.get(dk) orelse return null;
        const n = @min(bytes.len, buf.len);
        @memcpy(buf[0..n], bytes[0..n]);
        return n;
    }

    fn readKeysImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator) anyerror![]DatastoreKey {
        _ = io;
        const self: *InMemoryCPStateDatastore = @ptrCast(@alignCast(ctx));
        return try allocator.dupe(DatastoreKey, self.states.keys());
    }
};

/// Implementation of CPStateDatastore using file system, this is beneficial for debugging. Each state
/// is one file under `<data_dir>/checkpoint_states/` named `hex(DatastoreKey)` (82 chars: "0x" + 80
/// hex).
pub const FileCPStateDatastore = struct {
    /// "0x" + 2 hex chars per `DatastoreKey` byte (82 for a 40-byte key).
    const FILE_NAME_LEN: usize = 2 + 2 * DATASTORE_KEY_LEN;
    const SUBDIR = "checkpoint_states";
    const TMP_SUFFIX = ".tmp";

    allocator: Allocator,
    /// `<data_dir>/checkpoint_states` (service deployment: `/beacon/...`, docker: `/data/...`).
    dir_path: []u8,
    /// Open handle to the checkpoint-states directory, created in `initStore`.
    dir: ?std.Io.Dir,

    pub fn init(allocator: Allocator, data_dir: []const u8) !FileCPStateDatastore {
        const dir_path = try std.fs.path.join(allocator, &.{ data_dir, SUBDIR });
        return .{ .allocator = allocator, .dir_path = dir_path, .dir = null };
    }

    pub fn deinit(self: *FileCPStateDatastore, io: std.Io) void {
        if (self.dir) |dir| dir.close(io);
        self.allocator.free(self.dir_path);
    }

    pub fn datastore(self: *FileCPStateDatastore) CPStateDatastore {
        return .{ .ptr = self, .vtable = &vtable };
    }

    const vtable = CPStateDatastore.VTable{
        .write = writeImpl,
        .remove = removeImpl,
        .removeMany = removeManyImpl,
        .read = readImpl,
        .readPrefix = readPrefixImpl,
        .readKeys = readKeysImpl,
        .init = initImpl,
    };

    fn fileName(dk: DatastoreKey) [FILE_NAME_LEN]u8 {
        var name: [FILE_NAME_LEN]u8 = undefined;
        // `name` is sized exactly "0x" + 2 hex chars per `dk` byte, so the encode cannot run short.
        _ = hex.bytesToHex(&name, &dk) catch unreachable;
        return name;
    }

    fn initImpl(ctx: *anyopaque, io: std.Io) anyerror!void {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        if (self.dir) |dir| {
            dir.close(io);
            self.dir = null;
        }
        self.dir = try std.Io.Dir.cwd().createDirPathOpen(io, self.dir_path, .{ .open_options = .{ .iterate = true } });

        var it = self.dir.?.iterate();
        while (try it.next(io)) |entry| {
            if (!std.mem.endsWith(u8, entry.name, TMP_SUFFIX)) continue;
            self.dir.?.deleteFile(io, entry.name) catch |err| switch (err) {
                error.IsDir, error.FileNotFound => {},
                else => return err,
            };
        }
    }

    fn writeImpl(ctx: *anyopaque, io: std.Io, key: Checkpoint, state_bytes: []const u8) anyerror!DatastoreKey {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        const dir = self.dir orelse return error.DatastoreNotInitialized;
        const dk = datastoreKey(key);

        const name = fileName(dk);
        const exists = blk: {
            dir.access(io, &name, .{}) catch |err| switch (err) {
                error.FileNotFound => break :blk false,
                else => return err,
            };
            break :blk true;
        };
        if (exists) return dk;

        var tmp_name: [FILE_NAME_LEN + TMP_SUFFIX.len]u8 = undefined;
        @memcpy(tmp_name[0..FILE_NAME_LEN], &name);
        @memcpy(tmp_name[FILE_NAME_LEN..], TMP_SUFFIX);
        try dir.writeFile(io, .{ .sub_path = &tmp_name, .data = state_bytes });
        try dir.rename(&tmp_name, dir, &name, io);
        return dk;
    }

    /// Delete one state file. Per-key unit shared by `removeImpl` and the `removeMany` fan-out.
    fn removeOne(self: *FileCPStateDatastore, io: std.Io, dk: DatastoreKey) anyerror!void {
        const dir = self.dir orelse return error.DatastoreNotInitialized;

        const name = fileName(dk);
        dir.deleteFile(io, &name) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };
    }

    fn removeImpl(ctx: *anyopaque, io: std.Io, dk: DatastoreKey) anyerror!void {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        return self.removeOne(io, dk);
    }

    fn removeManyImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator, keys: []const DatastoreKey) anyerror!void {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        if (keys.len == 0) return;
        const futures = try allocator.alloc(std.Io.Future(anyerror!void), keys.len);
        defer allocator.free(futures);

        for (keys, 0..) |dk, i| futures[i] = io.async(removeOne, .{ self, io, dk });

        var first_err: ?anyerror = null;
        for (futures) |*f| f.await(io) catch |err| {
            if (first_err == null) first_err = err;
        };
        if (first_err) |err| return err;
    }

    fn readImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator, dk: DatastoreKey) anyerror!?[]u8 {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        const dir = self.dir orelse return error.DatastoreNotInitialized;

        const name = fileName(dk);
        return dir.readFileAlloc(io, &name, allocator, .unlimited) catch |err| switch (err) {
            error.FileNotFound => null,
            error.IsDir => null,
            else => err,
        };
    }

    fn readPrefixImpl(ctx: *anyopaque, io: std.Io, dk: DatastoreKey, buf: []u8) anyerror!?usize {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        const dir = self.dir orelse return error.DatastoreNotInitialized;

        const name = fileName(dk);
        const file = dir.openFile(io, &name, .{}) catch |err| switch (err) {
            error.FileNotFound, error.IsDir => return null,
            else => return err,
        };
        defer file.close(io);
        return file.readPositionalAll(io, buf, 0) catch |err| switch (err) {
            error.IsDir => return null,
            else => return err,
        };
    }

    fn readKeysImpl(ctx: *anyopaque, io: std.Io, allocator: Allocator) anyerror![]DatastoreKey {
        const self: *FileCPStateDatastore = @ptrCast(@alignCast(ctx));
        const dir = self.dir orelse return error.DatastoreNotInitialized;

        var keys: std.ArrayList(DatastoreKey) = .empty;
        errdefer keys.deinit(allocator);

        var it = dir.iterate();
        while (try it.next(io)) |entry| {
            if (entry.kind != .file and entry.kind != .unknown) continue;
            if (entry.name.len != FILE_NAME_LEN) continue;
            if (!hex.hasOxPrefix(entry.name)) continue;

            var dk: DatastoreKey = undefined;
            // A foreign file matching only the length + "0x" prefix decodes to a non-hex char; skip it.
            // Length/space errors are pre-checked away, so any other error is unexpected and propagates.
            _ = hex.hexToBytes(&dk, entry.name) catch |e| switch (e) {
                error.InvalidCharacter => continue,
                else => return e,
            };
            try keys.append(allocator, dk);
        }

        return keys.toOwnedSlice(allocator);
    }
};

test {
    _ = @import("cp_datastore_test.zig");
}
