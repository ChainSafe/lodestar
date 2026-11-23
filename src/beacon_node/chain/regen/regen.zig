const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const BeaconConfig = @import("config").BeaconConfig;
const fc = @import("fork_choice");
const st = @import("state_transition");
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const caches = @import("../state_cache/root.zig");
const cp_cache = caches.checkpoint_state_cache;
const SeenBlock = @import("../seen_cache/root.zig").SeenBlock;
const Root = types.primitive.Root.Type;
const Slot = types.primitive.Slot.Type;
const StateRc = st.CachedBeaconStateRc;
const slots_per_epoch = st.preset.SLOTS_PER_EPOCH;
const log = std.log.scoped(.regen);

pub const MAX_REPLAY_BLOCKS = 5 * slots_per_epoch;

const TransitionError = @typeInfo(@typeInfo(@TypeOf(st.stateTransition)).@"fn".return_type.?).error_union.error_set ||
    @typeInfo(@typeInfo(@TypeOf(st.processSlots)).@"fn".return_type.?).error_union.error_set;

const StateAccessError = Allocator.Error || error{
    PoolExhausted,
    InvalidNode,
    InvalidLength,
    InvalidPoolCapacity,
    RefCountOverflow,
    MissingChildValue,
    MissingChildView,
    ChildNotFound,
};

pub const Error = cp_cache.ReloadLatestError || cp_cache.CacheError || error{
    BlockNotInForkChoice,
    StateNotInForkChoice,
    SlotBeforeBlockSlot,
    NoSeedState,
    TooManyBlocksProcessed,
    BlockNotInCache,
    InvalidBlockBytes,
    InvalidStateRoot,
    InvalidForkChoice,
    StateTransitionError,
};

/// Caller-owned output, reset when supplied to a public call. Other calls leave it intact.
pub const Diagnostics = struct {
    transition_error: ?[]const u8 = null,
    transition: st.Diagnostics = .{},
    invalid_state_root: ?struct { slot: Slot, expected: Root, actual: Root } = null,
};

pub const StateRegenerationOpts = struct {
    dont_transfer_cache: bool = false,
    diagnostics: ?*Diagnostics = null,
};

/// Regenerates already imported states. Serialize the entire call, including I/O,
/// against mutation/destruction of all modules and their state backing resources.
/// Modules are borrowed; every successful state result owns a reference to unref().
/// Input snapshots must be committed. Tree-view changed bits also track composite
/// reads, so they cannot check this precondition. Replay transfers tree-view caches; slot
/// advancement transfers unless dont_transfer_cache is set. Transfer preserves state
/// roots and owners but invalidates child-view borrows, which callers must reacquire.
pub const StateRegenerator = struct {
    const Self = @This();

    pub const Modules = struct {
        config: *const BeaconConfig,
        fork_choice: *const fc.Store,
        block_state_cache: *caches.BlockStateCache,
        checkpoint_state_cache: *caches.PersistentCheckpointStateCache,
        seen_block: *const SeenBlock,
        validator_monitor: ?*st.ValidatorMonitor = null,
    };

    const ReplayBlock = struct {
        root: Root,
        state_root: Root,
        slot: Slot,
        parent_index: fc.BlockIndex,
        bytes: []const u8 = &.{},
    };

    allocator: Allocator,
    modules: Modules,

    pub fn init(allocator: Allocator, modules: Modules) Self {
        std.debug.assert(modules.config == modules.fork_choice.config);
        std.debug.assert(modules.block_state_cache == modules.checkpoint_state_cache.block_state_cache);
        return .{ .allocator = allocator, .modules = modules };
    }

    /// Same-epoch parents return their exact post-block state; cross-epoch parents
    /// advance to the requested block slot. Checkpoint disk reload is enabled.
    pub fn getPreState(self: *const Self, io: std.Io, parent_root: Root, slot: Slot, opts: StateRegenerationOpts) Error!*StateRc {
        if (opts.diagnostics) |diagnostics| diagnostics.* = .{};
        const parent = try self.getBlock(parent_root);
        if (slot < parent.slot) return error.SlotBeforeBlockSlot;
        if (parent.slot / slots_per_epoch < slot / slots_per_epoch) {
            return self.blockSlotState(io, parent, slot, opts, true);
        }
        return self.getState(io, parent.state_root, true, opts.diagnostics);
    }

    pub fn getBlockSlotState(self: *const Self, io: std.Io, block_root: Root, slot: Slot, opts: StateRegenerationOpts, allow_disk_reload: bool) Error!*StateRc {
        if (opts.diagnostics) |diagnostics| diagnostics.* = .{};
        const block = try self.getBlock(block_root);
        return self.blockSlotState(io, block, slot, opts, allow_disk_reload);
    }

    fn blockSlotState(self: *const Self, io: std.Io, block: ReplayBlock, slot: Slot, opts: StateRegenerationOpts, allow_disk_reload: bool) Error!*StateRc {
        if (slot < block.slot) return error.SlotBeforeBlockSlot;
        const checkpoint = try self.latestCheckpoint(io, block.root, slot / slots_per_epoch, allow_disk_reload);
        const seed = checkpoint orelse try self.getState(io, block.state_root, allow_disk_reload, opts.diagnostics);
        defer seed.unref();
        return self.processSlotsByCheckpoint(io, seed, slot, opts);
    }

    pub fn getState(self: *const Self, io: std.Io, state_root: Root, allow_disk_reload: bool, diagnostics: ?*Diagnostics) Error!*StateRc {
        if (diagnostics) |diag| diag.* = .{};
        if (self.modules.block_state_cache.ref(io, state_root)) |state| return state;

        var current = try self.findFirstStateBlock(state_root);
        var replay: [MAX_REPLAY_BLOCKS]ReplayBlock = undefined;
        replay[0] = current;
        var count: usize = 1;
        var remaining = self.modules.fork_choice.blockCount();
        // Indices remain valid because the entire call, including I/O, is serialized.
        // Continue a bounded walk after the replay buffer fills to preserve TS's
        // NoSeedState precedence without allocating more replay descriptors.
        // Keep disk reload enabled for persisted-only seeds beyond the bound too.
        const seed = while (current.parent_index != fc.store.NO_BLOCK) {
            if (remaining == 0) return error.InvalidForkChoice;
            remaining -= 1;
            const parent = self.toReplayBlock(current.parent_index);
            if (parent.slot >= current.slot) return error.InvalidForkChoice;
            if (self.modules.block_state_cache.ref(io, parent.state_root)) |state| break state;
            if (try self.latestCheckpoint(io, parent.root, (current.slot - 1) / slots_per_epoch, allow_disk_reload)) |state| break state;
            if (count < replay.len) replay[count] = parent;
            count += 1;
            current = parent;
        } else return error.NoSeedState;
        var state = seed;
        errdefer state.unref();
        if (count > replay.len) return error.TooManyBlocksProcessed;

        // Check all inputs before transitions or admitting any replayed states.
        for (replay[0..count]) |*block| {
            block.bytes = self.modules.seen_block.get(block.root) orelse {
                // TODO: Fall back to db.block.get when native block storage is integrated.
                return error.BlockNotInCache;
            };
        }

        while (count > 0) {
            count -= 1;
            const descriptor = replay[count];
            const block = AnySignedBeaconBlock.deserialize(self.allocator, .full, self.modules.config.forkSeq(descriptor.slot), descriptor.bytes) catch |err| return switch (err) {
                error.OutOfMemory => error.OutOfMemory,
                else => error.InvalidBlockBytes,
            };
            defer block.deinit(self.allocator);
            if (block.beaconBlock().slot() != descriptor.slot) return error.InvalidBlockBytes;

            const post = st.stateTransition(self.allocator, io, state.get(), block, .{
                .diagnostics = if (diagnostics) |diag| &diag.transition else null,
                .verify_state_root = false,
                .verify_proposer = false,
                .verify_signatures = false,
                .transfer_cache = true,
                .block_external_data = .{ .execution_payload_status = .valid, .data_availability_status = .available },
                .source = .regen,
            }, self.modules.validator_monitor) catch |err| return toTransitionError(err, diagnostics);
            const owned = try self.toStateRc(post);
            state.unref();
            state = owned;
            const actual = state.get().state.hashTreeRoot() catch |err| return stateAccessError(err);
            if (!std.mem.eql(u8, actual, &descriptor.state_root)) {
                if (diagnostics) |diag| diag.invalid_state_root = .{
                    .slot = descriptor.slot,
                    .expected = descriptor.state_root,
                    .actual = actual.*,
                };
                log.debug("code=InvalidStateRoot slot={d} expected={x} actual={x}", .{ descriptor.slot, descriptor.state_root, actual.* });
                return error.InvalidStateRoot;
            }
            if (allow_disk_reload) {
                // add borrows state; this call keeps the reference returned to the caller.
                self.modules.block_state_cache.add(io, state, false) catch |err| return stateAccessError(err);
            }
        }
        return state;
    }

    /// Borrows the input owner and returns an owned reference. Use dont_transfer_cache
    /// to preserve child-view borrows through advancement; state roots always survive.
    pub fn processSlotsToNearestCheckpoint(self: *const Self, io: std.Io, pre_state: *StateRc, slot: Slot, opts: StateRegenerationOpts) Error!*StateRc {
        if (opts.diagnostics) |diagnostics| diagnostics.* = .{};
        var state = pre_state.ref();
        errdefer state.unref();
        var current_slot = state.get().state.slot() catch |err| return stateAccessError(err);
        if (slot < current_slot) return error.SlotBeforeBlockSlot;
        var count: usize = 0;
        while (current_slot / slots_per_epoch < slot / slots_per_epoch) {
            const next_slot = (current_slot / slots_per_epoch + 1) * slots_per_epoch;
            const next = try self.processSlots(io, state, next_slot, opts);
            state.unref();
            state = next;
            const header_view = state.get().state.latestBlockHeader() catch |err| return stateAccessError(err);
            var header: types.phase0.BeaconBlockHeader.Type = undefined;
            header_view.toValue(self.allocator, &header) catch |err| return stateAccessError(err);
            if (std.mem.eql(u8, &header.state_root, &@as(Root, @splat(0)))) {
                header.state_root = (state.get().state.hashTreeRoot() catch |err| return stateAccessError(err)).*;
            }
            var cp: caches.Checkpoint = .{ .epoch = next_slot / slots_per_epoch, .root = undefined };
            types.phase0.BeaconBlockHeader.hashTreeRoot(&header, &cp.root) catch |err| switch (err) {
                error.InvalidInput => unreachable, // Fixed-size header merkleization has no variable input lengths.
            };
            // add borrows state and retains a separate cache reference.
            try self.modules.checkpoint_state_cache.add(io, cp, state);
            // TODO: Publish ChainEvent.checkpoint when host event delivery is available.
            if (count >= 1) {
                _ = self.modules.checkpoint_state_cache.processState(io, cp.root, state) catch |err| switch (err) {
                    error.OutOfMemory => return error.OutOfMemory,
                    error.PoolExhausted => return error.PoolExhausted,
                    error.Canceled => return error.Canceled,
                    else => blk: {
                        log.debug("code=CheckpointMaintenanceFailed epoch={d} cause={s}", .{ cp.epoch, @errorName(err) });
                        break :blk 0;
                    },
                };
            } else {
                self.modules.checkpoint_state_cache.drainPendingDeletes(io) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    else => log.debug("code=CheckpointDeleteFailed epoch={d} cause={s}", .{ cp.epoch, @errorName(err) }),
                };
            }
            current_slot = next_slot;
            count += 1;
            // TODO: Yield to Node at this boundary when scheduling is integrated.
        }
        return state;
    }

    fn processSlotsByCheckpoint(self: *const Self, io: std.Io, seed: *StateRc, slot: Slot, opts: StateRegenerationOpts) Error!*StateRc {
        const state = try self.processSlotsToNearestCheckpoint(io, seed, slot, opts);
        errdefer state.unref();
        const current_slot = state.get().state.slot() catch |err| return stateAccessError(err);
        if (current_slot < slot) {
            const next = try self.processSlots(io, state, slot, opts);
            state.unref();
            return next;
        }
        return state;
    }

    fn processSlots(self: *const Self, io: std.Io, state: *StateRc, slot: Slot, opts: StateRegenerationOpts) Error!*StateRc {
        const cloned = state.get().clone(self.allocator, .{ .transfer_cache = !opts.dont_transfer_cache }) catch |err| return stateAccessError(err);
        const owner = try self.toStateRc(cloned);
        errdefer owner.unref();
        st.processSlots(self.allocator, io, cloned, slot, self.modules.validator_monitor) catch |err| return toTransitionError(err, opts.diagnostics);
        return owner;
    }

    fn toStateRc(self: *const Self, state: *st.CachedBeaconState) Allocator.Error!*StateRc {
        errdefer {
            state.deinit();
            state.allocator.destroy(state);
        }
        return StateRc.create(self.allocator, state);
    }

    fn latestCheckpoint(self: *const Self, io: std.Io, root: Root, epoch: u64, allow_disk_reload: bool) Error!?*StateRc {
        return if (allow_disk_reload)
            self.modules.checkpoint_state_cache.getOrReloadLatest(io, root, epoch)
        else
            self.modules.checkpoint_state_cache.refLatest(io, root, epoch);
    }

    fn getBlock(self: *const Self, root: Root) Error!ReplayBlock {
        const store = self.modules.fork_choice;
        const index = store.blockIndex(root) orelse return error.BlockNotInForkChoice;
        const finalized = store.blockIndex(store.finalized_checkpoint.root) orelse return error.InvalidForkChoice;
        if (store.getAncestor(fc.Store.pendingNode(index), store.blockSlot(finalized)).block != finalized) return error.BlockNotInForkChoice;
        return self.toReplayBlock(index);
    }

    fn findFirstStateBlock(self: *const Self, state_root: Root) Error!ReplayBlock {
        const store = self.modules.fork_choice;
        // TS scans imported nodes in order, PENDING before EMPTY/FULL. Each block's
        // variants share its beacon state root, so one descriptor per block suffices.
        for (store.blocks.items(.state_root), 0..) |root, index| {
            if (std.mem.eql(u8, &root, &state_root)) return self.toReplayBlock(@intCast(index));
        }
        return error.StateNotInForkChoice;
    }

    fn toReplayBlock(self: *const Self, index: fc.BlockIndex) ReplayBlock {
        const store = self.modules.fork_choice;
        return .{
            .root = store.blockRoot(index),
            .state_root = store.blocks.items(.state_root)[index],
            .slot = store.blockSlot(index),
            .parent_index = store.blocks.items(.parent)[index],
        };
    }

    fn toTransitionError(err: TransitionError, diagnostics: ?*Diagnostics) Error {
        return switch (err) {
            error.OutOfMemory => error.OutOfMemory,
            error.PoolExhausted => error.PoolExhausted,
            error.Canceled => error.Canceled,
            else => blk: {
                if (diagnostics) |diag| diag.transition_error = @errorName(err);
                log.debug("code=StateTransitionError cause={s}", .{@errorName(err)});
                break :blk error.StateTransitionError;
            },
        };
    }
};

fn stateAccessError(err: StateAccessError) Error {
    return switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.PoolExhausted => error.PoolExhausted,
        error.InvalidNode,
        error.InvalidLength,
        error.InvalidPoolCapacity,
        error.RefCountOverflow,
        error.MissingChildValue,
        error.MissingChildView,
        error.ChildNotFound,
        => error.InvalidState,
    };
}

test {
    try std.testing.expect(TransitionError != anyerror);
    for ([_]StateAccessError{ error.InvalidNode, error.InvalidLength, error.InvalidPoolCapacity, error.RefCountOverflow, error.MissingChildValue, error.MissingChildView, error.ChildNotFound }) |err| {
        errdefer std.debug.print("state access error {s}\n", .{@errorName(err)});
        try std.testing.expectEqual(error.InvalidState, stateAccessError(err));
    }
    try std.testing.expectEqual(error.OutOfMemory, stateAccessError(error.OutOfMemory));
    try std.testing.expectEqual(error.PoolExhausted, stateAccessError(error.PoolExhausted));
    _ = @import("regen_test.zig");
}
