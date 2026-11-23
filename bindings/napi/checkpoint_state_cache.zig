const std = @import("std");
const js = @import("zapi:zapi").js;
const st = @import("state_transition");
const caches = @import("beacon_node").chain.state_cache;
const handle = @import("state_handle.zig");
const BeaconStateView = @import("BeaconStateView.zig");
const allocator = std.heap.c_allocator;

const BlockStateCache = @import("block_state_cache.zig");

pub const js_meta = js.class(.{});

/// Keeps the checkpoint cache, block-cache seed source, and I/O runtime alive
/// while regen still references them. Owned I/O also supports finalizers that run
/// after the Node environment has been cleaned up.
const NativeCache = struct {
    cache: caches.PersistentCheckpointStateCache,
    block_cache: *BlockStateCache.NativeCacheRc,
    io: std.Io.Threaded,

    pub fn deinit(self: *NativeCache) void {
        self.cache.deinit(self.io.io());
        self.io.deinit();
        self.block_cache.unref();
    }
};
pub const NativeCacheRc = st.RefCount(NativeCache);
native_cache_rc: ?*NativeCacheRc,
const CheckpointStateCache = @This();

/// Retains the block cache for reload seeds and the shared state resources.
pub fn init(block_cache: *BlockStateCache, data_dir: js.String, max_epochs: js.Number, disk_epochs: ?js.Number) !CheckpointStateCache {
    const block_cache_rc = (block_cache.native_cache_rc orelse return error.BlockStateCacheReleased).ref();
    errdefer block_cache_rc.unref();
    const epochs = try max_epochs.toU32Exact();
    const retention: caches.checkpoint_state_cache.DiskRetention = if (disk_epochs) |count| .{ .flat = try count.toU32Exact() } else .tiered;
    const path = try data_dir.toOwnedSlice(allocator);
    defer allocator.free(path);
    if (path.len == 0 or path.len > 4096 or std.mem.indexOfScalar(u8, path, 0) != null) return error.InvalidDataDir;
    const native_cache_rc = try NativeCacheRc.create(allocator, .{
        .cache = undefined,
        .block_cache = block_cache_rc,
        .io = .init(allocator, .{}),
    });
    errdefer allocator.destroy(native_cache_rc);
    errdefer native_cache_rc.instance.io.deinit();
    native_cache_rc.instance.cache = try caches.PersistentCheckpointStateCache.init(allocator, &block_cache_rc.instance.cache, .{
        .data_dir = path,
        .max_epochs_in_memory = epochs,
        .disk_retention = retention,
    });
    return .{ .native_cache_rc = native_cache_rc };
}

pub fn deinit(self: *CheckpointStateCache) void {
    if (self.native_cache_rc) |native_cache_rc| {
        self.native_cache_rc = null;
        native_cache_rc.unref();
    }
}

pub fn release(self: *CheckpointStateCache) void {
    self.deinit();
}

pub fn initStore(self: *CheckpointStateCache) !void {
    const native_cache_rc = try self.borrowNativeCache();
    try native_cache_rc.instance.cache.initStore(native_cache_rc.instance.io.io());
}

/// Borrows self and view for this synchronous call without invoking JavaScript.
/// Native add retains a state reference on insertion/replacement; caller ownership is unchanged.
pub fn add(self: *CheckpointStateCache, epoch: js.Number, root: js.Uint8Array, view: *BeaconStateView) !void {
    const native_cache_rc = try self.borrowNativeCache();
    const state_rc = try handle.borrowState(view);
    try checkPoolAndConfig(native_cache_rc, view);
    try native_cache_rc.instance.cache.add(native_cache_rc.instance.io.io(), try checkpoint(epoch, root), state_rc);
}

pub fn get(self: *CheckpointStateCache, epoch: js.Number, root: js.Uint8Array) !?BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    return exportState(native_cache_rc, native_cache_rc.instance.cache.ref(native_cache_rc.instance.io.io(), try checkpoint(epoch, root)));
}

pub fn getLatest(self: *CheckpointStateCache, root: js.Uint8Array, epoch: ?js.Number) !?BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    return exportState(native_cache_rc, native_cache_rc.instance.cache.refLatest(native_cache_rc.instance.io.io(), try root.toArray(32), try optionalEpoch(epoch)));
}

pub fn getOrReload(self: *CheckpointStateCache, epoch: js.Number, root: js.Uint8Array) !?BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    return exportState(native_cache_rc, try native_cache_rc.instance.cache.getOrReload(native_cache_rc.instance.io.io(), try checkpoint(epoch, root)));
}

pub fn getOrReloadLatest(self: *CheckpointStateCache, root: js.Uint8Array, epoch: ?js.Number) !?BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    return exportState(native_cache_rc, try native_cache_rc.instance.cache.getOrReloadLatest(native_cache_rc.instance.io.io(), try root.toArray(32), try optionalEpoch(epoch)));
}

pub fn getBytes(self: *CheckpointStateCache, epoch: js.Number, root: js.Uint8Array) !?js.Uint8Array {
    const native_cache_rc = try self.borrowNativeCache();
    const result = (try native_cache_rc.instance.cache.getStateOrBytes(native_cache_rc.instance.io.io(), allocator, try checkpoint(epoch, root))) orelse return null;
    defer result.deinit(allocator);
    return js.Uint8Array.from(switch (result) {
        .state => return error.CheckpointStillResident,
        .bytes => |bytes| bytes,
    });
}

pub fn onCheckpoint(self: *CheckpointStateCache, finalized_epoch: js.Number, justified_epoch: js.Number) !void {
    const native_cache_rc = try self.borrowNativeCache();
    native_cache_rc.instance.cache.onCheckpoint(try finalized_epoch.toSafeInteger(), try justified_epoch.toSafeInteger());
}

pub fn updatePreComputedCheckpoint(self: *CheckpointStateCache, epoch: js.Number, root: js.Uint8Array) !?js.Number {
    const native_cache_rc = try self.borrowNativeCache();
    const count = native_cache_rc.instance.cache.updatePreComputedCheckpoint(try checkpoint(epoch, root)) orelse return null;
    return js.Number.from(count);
}

/// Borrows view for this synchronous call; native processState retains it across pruning.
pub fn processState(self: *CheckpointStateCache, root: js.Uint8Array, view: *BeaconStateView) !js.Number {
    const native_cache_rc = try self.borrowNativeCache();
    const state_rc = try handle.borrowState(view);
    try checkPoolAndConfig(native_cache_rc, view);
    return js.Number.from(try native_cache_rc.instance.cache.processState(native_cache_rc.instance.io.io(), try root.toArray(32), state_rc));
}

pub fn clear(self: *CheckpointStateCache) !void {
    const native_cache_rc = try self.borrowNativeCache();
    try native_cache_rc.instance.cache.clear(native_cache_rc.instance.io.io());
}

pub fn drainPendingDeletes(self: *CheckpointStateCache) !void {
    const native_cache_rc = try self.borrowNativeCache();
    try native_cache_rc.instance.cache.drainPendingDeletes(native_cache_rc.instance.io.io());
}

/// Snapshot residency before constructing JS objects, whose setters may reenter the binding.
pub fn getCheckpoints(self: *CheckpointStateCache) !js.Array {
    const native_cache_rc = try self.borrowNativeCache();
    const cache = &native_cache_rc.instance.cache;
    const Item = struct { cp: caches.Checkpoint, in_memory: bool };
    const snapshot = try allocator.alloc(Item, cache.cache.count());
    defer allocator.free(snapshot);
    for (cache.cache.keys(), cache.cache.values(), snapshot) |key, entry, *item| {
        item.* = .{ .cp = caches.key.checkpointFromDatastoreKey(key), .in_memory = entry.state != null };
    }
    const env = js.env();
    const result = try env.createArrayWithLength(snapshot.len);
    for (snapshot, 0..) |item, i| {
        const value = try env.createObject();
        try value.setNamedProperty("epoch", try env.createDouble(@floatFromInt(item.cp.epoch)));
        try value.setNamedProperty("root", js.Uint8Array.from(&item.cp.root).toValue());
        try value.setNamedProperty("inMemory", try env.getBoolean(item.in_memory));
        try result.setElement(@intCast(i), value);
    }
    return .{ .val = result };
}

pub fn dumpSummary(self: *CheckpointStateCache) !js.Array {
    const native_cache_rc = try self.borrowNativeCache();
    const summary = try native_cache_rc.instance.cache.dumpSummary(allocator);
    defer allocator.free(summary);
    const env = js.env();
    const wall_offset = std.Io.Clock.real.now(native_cache_rc.instance.io.io()).toMilliseconds() - std.Io.Clock.awake.now(native_cache_rc.instance.io.io()).toMilliseconds();
    const result = try env.createArrayWithLength(summary.len);
    for (summary, 0..) |item, i| {
        const value = try env.createObject();
        try value.setNamedProperty("slot", try env.createDouble(@floatFromInt(item.slot)));
        try value.setNamedProperty("root", js.Uint8Array.from(&item.root).toValue());
        try value.setNamedProperty("reads", try env.createDouble(@floatFromInt(item.reads)));
        try value.setNamedProperty("lastRead", try env.createDouble(if (item.last_read) |timestamp| @floatFromInt(timestamp.toMilliseconds() + wall_offset) else 0));
        try value.setNamedProperty("checkpointState", try env.getBoolean(item.checkpoint_state));
        try result.setElement(@intCast(i), value);
    }
    return .{ .val = result };
}

pub fn stats(self: *CheckpointStateCache) !js.Value {
    const native_cache_rc = try self.borrowNativeCache();
    const cp = native_cache_rc.instance.cache.stats;
    var in_memory: usize = 0;
    var persisted: usize = 0;
    for (native_cache_rc.instance.cache.cache.values()) |entry| {
        if (entry.state != null) in_memory += 1 else persisted += 1;
    }
    const env = js.env();
    const result = try env.createObject();
    const counts = .{
        .lookups = cp.lookups,
        .hits = cp.hits,
        .adds = cp.adds,
        .persists = cp.persists,
        .reloads = cp.reloads,
        .pruned = cp.pruned_from_memory,
        .inMemory = in_memory,
        .persisted = persisted,
    };
    inline for (std.meta.fields(@TypeOf(counts))) |field| {
        try result.setNamedProperty(field.name, try env.createDouble(@floatFromInt(@field(counts, field.name))));
    }
    return .{ .val = result };
}

/// Borrows until this binding is released. Finish cache access before invoking JS callbacks.
fn borrowNativeCache(self: *CheckpointStateCache) !*NativeCacheRc {
    return self.native_cache_rc orelse return error.CheckpointStateCacheReleased;
}

fn checkPoolAndConfig(native_cache_rc: *NativeCacheRc, view: *BeaconStateView) !void {
    if (native_cache_rc.instance.block_cache.instance.config_rc != view.config_rc or
        native_cache_rc.instance.block_cache.instance.pool_rc != view.pool_rc) return error.StateBackingMismatch;
}

fn checkpoint(epoch: js.Number, root: js.Uint8Array) !caches.Checkpoint {
    return .{ .epoch = try epoch.toSafeInteger(), .root = try root.toArray(32) };
}

fn optionalEpoch(epoch: ?js.Number) !?u64 {
    return if (epoch) |value| try value.toSafeInteger() else null;
}

/// Transfers an owned state reference to the returned view and retains its resources.
fn exportState(native_cache_rc: *NativeCacheRc, state_rc: ?*st.CachedBeaconStateRc) ?BeaconStateView {
    const owned = state_rc orelse return null;
    return .{
        .state_rc = owned,
        .config_rc = native_cache_rc.instance.block_cache.instance.config_rc.ref(),
        .pool_rc = native_cache_rc.instance.block_cache.instance.pool_rc.ref(),
    };
}
