const std = @import("std");
const js = @import("zapi:zapi").js;
const st = @import("state_transition");
const caches = @import("beacon_node").chain.state_cache;
const handle = @import("state_handle.zig");
const BeaconStateView = @import("BeaconStateView.zig");
const allocator = std.heap.c_allocator;

const BeaconConfig = @import("BeaconConfig.zig");
const pool = @import("pool.zig");

pub const js_meta = js.class(.{ .properties = .{
    .size = js.prop(.{ .get = true, .set = false }),
} });

/// Keeps the block cache, config, and node pool alive while checkpoint caches or
/// regen still reference them, even after this JS binding is released.
const NativeCache = struct {
    cache: caches.BlockStateCache,
    config_rc: *BeaconConfig.OwnedConfigRc,
    pool_rc: @typeInfo(@TypeOf(pool.state.pool_rc)).optional.child,

    pub fn deinit(self: *NativeCache) void {
        self.cache.deinit();
        self.config_rc.unref();
        self.pool_rc.instance.reportMemory();
        self.pool_rc.unref();
    }
};
pub const NativeCacheRc = st.RefCount(NativeCache);
native_cache_rc: ?*NativeCacheRc,
const BlockStateCache = @This();

/// Borrows anchor for this call and retains its config and pool for the cache lifetime.
pub fn init(anchor: *BeaconStateView, max_states: js.Number) !BlockStateCache {
    _ = try handle.borrowState(anchor);
    const pool_rc = anchor.pool_rc.?.ref();
    errdefer pool_rc.unref();
    const config_rc = anchor.config_rc.?.ref();
    errdefer config_rc.unref();
    const states = try max_states.toU32Exact();
    if (states == 0 or states > 1_000_000) return error.InvalidCacheOptions;
    var cache = try caches.BlockStateCache.init(allocator, .{ .max_states = states });
    errdefer cache.deinit();
    return .{ .native_cache_rc = try NativeCacheRc.create(allocator, .{
        .cache = cache,
        .config_rc = config_rc,
        .pool_rc = pool_rc,
    }) };
}

pub fn deinit(self: *BlockStateCache) void {
    if (self.native_cache_rc) |native_cache_rc| {
        self.native_cache_rc = null;
        native_cache_rc.unref();
    }
}

pub fn release(self: *BlockStateCache) void {
    self.deinit();
}

/// Borrows self and view for this synchronous call without invoking JavaScript.
/// Native add retains a state reference only on insertion; the caller keeps its ownership.
pub fn add(self: *BlockStateCache, view: *BeaconStateView) !void {
    const native_cache_rc = try self.borrowNativeCache();
    const state_rc = try handle.borrowState(view);
    try checkPoolAndConfig(native_cache_rc, view);
    try native_cache_rc.instance.cache.add(js.io(), state_rc, false);
}

/// Borrows view for this synchronous call; native setHeadState retains only on insertion.
pub fn setHeadState(self: *BlockStateCache, view: ?*BeaconStateView) !void {
    const native_cache_rc = try self.borrowNativeCache();
    const state_rc = if (view) |v| try handle.borrowState(v) else null;
    if (view) |v| try checkPoolAndConfig(native_cache_rc, v);
    try native_cache_rc.instance.cache.setHeadState(js.io(), state_rc);
}

pub fn get(self: *BlockStateCache, root: js.Uint8Array) !?BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    return exportState(native_cache_rc, native_cache_rc.instance.cache.ref(js.io(), try root.toArray(32)));
}

pub fn getSeedState(self: *BlockStateCache) !BeaconStateView {
    const native_cache_rc = try self.borrowNativeCache();
    const state_rc = native_cache_rc.instance.cache.refSeedState(js.io()) orelse return error.NoSeedState;
    return .{
        .state_rc = state_rc,
        .config_rc = native_cache_rc.instance.config_rc.ref(),
        .pool_rc = native_cache_rc.instance.pool_rc.ref(),
    };
}

pub fn clear(self: *BlockStateCache) !void {
    const native_cache_rc = try self.borrowNativeCache();
    native_cache_rc.instance.cache.clear(js.io());
}

pub fn size(self: *BlockStateCache) !js.Number {
    const native_cache_rc = try self.borrowNativeCache();
    return js.Number.from(native_cache_rc.instance.cache.size(js.io()));
}

pub fn onCheckpoint(self: *BlockStateCache, head_root: js.Uint8Array) !void {
    const native_cache_rc = try self.borrowNativeCache();
    native_cache_rc.instance.cache.onCheckpoint(js.io(), try head_root.toArray(32));
}

/// In insertion order, so the first root identifies the reload seed.
pub fn getStateRoots(self: *BlockStateCache) !js.Array {
    const native_cache_rc = try self.borrowNativeCache();
    const summary = try native_cache_rc.instance.cache.dumpSummary(js.io(), allocator);
    defer allocator.free(summary);
    const result = try js.env().createArrayWithLength(summary.len);
    for (summary, 0..) |item, i| {
        try result.setElement(@intCast(i), js.Uint8Array.from(&item.root).toValue());
    }
    return .{ .val = result };
}

pub fn dumpSummary(self: *BlockStateCache) !js.Array {
    const native_cache_rc = try self.borrowNativeCache();
    const summary = try native_cache_rc.instance.cache.dumpSummary(js.io(), allocator);
    defer allocator.free(summary);
    const env = js.env();
    const wall_offset = std.Io.Clock.real.now(js.io()).toMilliseconds() - std.Io.Clock.awake.now(js.io()).toMilliseconds();
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

pub fn stats(self: *BlockStateCache) !js.Value {
    const native_cache_rc = try self.borrowNativeCache();
    const counts = native_cache_rc.instance.cache.statsSnapshot(js.io());
    const env = js.env();
    const result = try env.createObject();
    inline for (std.meta.fields(@TypeOf(counts))) |field| {
        try result.setNamedProperty(field.name, try env.createDouble(@floatFromInt(@field(counts, field.name))));
    }
    return .{ .val = result };
}

/// Borrows until this binding is released. Finish cache access before invoking JS callbacks.
fn borrowNativeCache(self: *BlockStateCache) !*NativeCacheRc {
    return self.native_cache_rc orelse return error.BlockStateCacheReleased;
}

fn checkPoolAndConfig(native_cache_rc: *NativeCacheRc, view: *BeaconStateView) !void {
    if (native_cache_rc.instance.config_rc != view.config_rc or
        native_cache_rc.instance.pool_rc != view.pool_rc) return error.StateBackingMismatch;
}

/// Transfers an owned state reference to the returned view and retains its resources.
fn exportState(native_cache_rc: *NativeCacheRc, state_rc: ?*st.CachedBeaconStateRc) ?BeaconStateView {
    const owned = state_rc orelse return null;
    return .{
        .state_rc = owned,
        .config_rc = native_cache_rc.instance.config_rc.ref(),
        .pool_rc = native_cache_rc.instance.pool_rc.ref(),
    };
}
