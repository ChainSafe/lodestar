const std = @import("std");
const js = @import("zapi:zapi").js;
const native = @import("beacon_node").chain.regen;
const BlockStateCache = @import("block_state_cache.zig");
const CheckpointStateCache = @import("checkpoint_state_cache.zig");
const SeenBlock = @import("seen_block.zig");
const ForkChoice = @import("ForkChoice.zig");
const BeaconStateView = @import("BeaconStateView.zig");

pub const js_meta = js.class(.{});

block_cache: ?*BlockStateCache.NativeCacheRc,
checkpoint_cache: ?*CheckpointStateCache.NativeCacheRc,
seen: ?@typeInfo(@TypeOf(@as(SeenBlock, undefined).owner)).optional.child,
fork_choice_rc: ?*ForkChoice.NativeStoreRc,
const StateRegenerator = @This();

pub fn init(block_cache: *BlockStateCache, checkpoint_cache: *CheckpointStateCache, seen: *SeenBlock, fork_choice: *ForkChoice) !StateRegenerator {
    const block_cache_rc = (block_cache.native_cache_rc orelse return error.BlockStateCacheReleased).ref();
    errdefer block_cache_rc.unref();
    const checkpoint_cache_rc = (checkpoint_cache.native_cache_rc orelse return error.CheckpointStateCacheReleased).ref();
    errdefer checkpoint_cache_rc.unref();
    if (checkpoint_cache_rc.instance.block_cache != block_cache_rc) return error.StateCacheMismatch;
    const seen_owner = (seen.owner orelse return error.SeenBlockReleased).ref();
    errdefer seen_owner.unref();
    const cache_config = &block_cache_rc.instance.config_rc.instance.config;
    const fc_config = &fork_choice.native_store_rc.instance.config_rc.instance.config;
    if (!std.mem.eql(u8, &cache_config.genesis_validator_root, &fc_config.genesis_validator_root)) return error.StateConfigMismatch;
    inline for (std.meta.fields(@import("config").ChainConfig)) |field| {
        const a = @field(cache_config.chain, field.name);
        const b = @field(fc_config.chain, field.name);
        switch (@typeInfo(field.type)) {
            .pointer => {
                if (a.len != b.len) return error.StateConfigMismatch;
                for (a, b) |left, right| {
                    if (!std.meta.eql(left, right)) return error.StateConfigMismatch;
                }
            },
            else => if (!std.meta.eql(a, b)) return error.StateConfigMismatch,
        }
    }
    return .{
        .block_cache = block_cache_rc,
        .checkpoint_cache = checkpoint_cache_rc,
        .seen = seen_owner,
        .fork_choice_rc = fork_choice.native_store_rc.ref(),
    };
}

pub fn deinit(self: *StateRegenerator) void {
    if (self.checkpoint_cache) |cache| cache.unref();
    if (self.block_cache) |cache| cache.unref();
    if (self.seen) |seen| seen.unref();
    if (self.fork_choice_rc) |rc| rc.unref();
    self.checkpoint_cache = null;
    self.block_cache = null;
    self.seen = null;
    self.fork_choice_rc = null;
}

pub fn release(self: *StateRegenerator) void {
    self.deinit();
}

/// Returns a view owning a state reference; native caches keep their separate references.
pub fn getState(self: *StateRegenerator, root: js.Uint8Array, allow_disk_reload: js.Boolean) !BeaconStateView {
    const regen = try self.regenerator();
    var diagnostics: native.Diagnostics = .{};
    const state = regen.getState(self.checkpoint_cache.?.instance.io.io(), try root.toArray(32), try allow_disk_reload.toBool(), &diagnostics) catch |err| return regenError(err, diagnostics);
    const cache = self.block_cache.?;
    return .{
        .state_rc = state,
        .config_rc = cache.instance.config_rc.ref(),
        .pool_rc = cache.instance.pool_rc.ref(),
    };
}

pub fn getPreState(self: *StateRegenerator, parent_root: js.Uint8Array, slot: js.Number, dont_transfer_cache: js.Boolean) !BeaconStateView {
    const regen = try self.regenerator();
    var diagnostics: native.Diagnostics = .{};
    const state = regen.getPreState(self.checkpoint_cache.?.instance.io.io(), try parent_root.toArray(32), try slot.toSafeInteger(), .{
        .dont_transfer_cache = try dont_transfer_cache.toBool(),
        .diagnostics = &diagnostics,
    }) catch |err| return regenError(err, diagnostics);
    const cache = self.block_cache.?;
    return .{
        .state_rc = state,
        .config_rc = cache.instance.config_rc.ref(),
        .pool_rc = cache.instance.pool_rc.ref(),
    };
}

pub fn getBlockSlotState(self: *StateRegenerator, root: js.Uint8Array, slot: js.Number, dont_transfer_cache: js.Boolean, allow_disk_reload: js.Boolean) !BeaconStateView {
    const regen = try self.regenerator();
    var diagnostics: native.Diagnostics = .{};
    const state = regen.getBlockSlotState(self.checkpoint_cache.?.instance.io.io(), try root.toArray(32), try slot.toSafeInteger(), .{
        .dont_transfer_cache = try dont_transfer_cache.toBool(),
        .diagnostics = &diagnostics,
    }, try allow_disk_reload.toBool()) catch |err| return regenError(err, diagnostics);
    const cache = self.block_cache.?;
    return .{
        .state_rc = state,
        .config_rc = cache.instance.config_rc.ref(),
        .pool_rc = cache.instance.pool_rc.ref(),
    };
}

fn regenerator(self: *StateRegenerator) !native.StateRegenerator {
    const block_cache = self.block_cache orelse return error.RegeneratorReleased;
    const checkpoint_cache = self.checkpoint_cache orelse return error.RegeneratorReleased;
    const seen = self.seen orelse return error.RegeneratorReleased;
    const fc = self.fork_choice_rc orelse return error.RegeneratorReleased;
    return native.StateRegenerator.init(block_cache.instance.pool_rc.instance.memory.allocator(), .{
        .config = &fc.instance.config_rc.instance.config,
        .fork_choice = &fc.instance.store,
        .block_state_cache = &block_cache.instance.cache,
        .checkpoint_state_cache = &checkpoint_cache.instance.cache,
        .seen_block = &seen.instance,
        .validator_monitor = @import("validator_monitor.zig").get(),
    });
}

fn regenError(err: native.RegenError, diagnostics: native.Diagnostics) anyerror {
    if (diagnostics.invalid_state_root) |mismatch| {
        const env = js.env();
        const code = env.createStringUtf8(@errorName(err)) catch |failure| return failure;
        const value = env.createError(code, code) catch |failure| return failure;
        value.setNamedProperty("slot", js.Number.from(mismatch.slot).toValue()) catch |failure| return failure;
        value.setNamedProperty("expected", js.Uint8Array.from(&mismatch.expected).toValue()) catch |failure| return failure;
        value.setNamedProperty("actual", js.Uint8Array.from(&mismatch.actual).toValue()) catch |failure| return failure;
        env.throw(value) catch |failure| return failure;
        return error.PendingException;
    }
    if (diagnostics.transition_error) |cause| {
        var buffer: [512]u8 = undefined;
        const message = if (diagnostics.transition.detail) |detail|
            std.fmt.bufPrintSentinel(&buffer, "{s}: {f}", .{ cause, detail }, 0) catch return err
        else
            std.fmt.bufPrintSentinel(&buffer, "{s}", .{cause}, 0) catch return err;
        js.env().throwError(@errorName(err), message) catch |failure| return failure;
        return error.PendingException;
    }
    return err;
}
