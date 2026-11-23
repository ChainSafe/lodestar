const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const st = @import("state_transition");
const time = @import("time");
const key = @import("key.zig");
const BlockStateCache = @import("block_state_cache.zig").BlockStateCache;
const StateCacheItem = @import("block_state_cache.zig").StateCacheItem;
const FileStore = @import("cp_datastore.zig").FileCPStateDatastore;
const StateRc = st.CachedBeaconStateRc;
const CachedBeaconState = st.CachedBeaconState;
const Checkpoint = key.Checkpoint;
const DatastoreKey = key.DatastoreKey;
const Epoch = types.primitive.Epoch.Type;
const Root = types.primitive.Root.Type;
const slots_per_epoch = st.preset.SLOTS_PER_EPOCH;

pub const DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY = 3;
pub const CP_STATE_TIER_BASE = 16;
const tier_count = 17; // 16^16 exceeds u64; only offset zero can reach the last tier.

pub const DiskRetention = union(enum) { tiered, flat: usize };
pub const CacheError = Allocator.Error || error{ InvalidCheckpoint, InvalidState, PoolExhausted, StateTooLarge };
pub const ReloadError = FileStore.ReadError || CachedBeaconState.LoadError || error{ NoSeedState, InvalidCheckpoint };
pub const ReloadLatestError = error{ OutOfMemory, PoolExhausted, Canceled };
pub const PersistError = FileStore.WriteError || CacheError;
pub const PruneError = FileStore.RemoveError;
pub const ProcessError = PersistError || PruneError || error{BlockRootUnavailable};

pub const StateOrBytes = union(enum) {
    state: *StateRc,
    bytes: []u8,

    pub fn deinit(self: StateOrBytes, allocator: Allocator) void {
        switch (self) {
            .state => |state| state.unref(),
            .bytes => |bytes| allocator.free(bytes),
        }
    }
};

pub const StateOrLoadedBytes = union(enum) {
    state: *StateRc,
    loaded: struct { persisted_key: DatastoreKey, bytes: []u8 },

    pub fn deinit(self: StateOrLoadedBytes, allocator: Allocator) void {
        switch (self) {
            .state => |state| state.unref(),
            .loaded => |loaded| allocator.free(loaded.bytes),
        }
    }
};

/// Serialize entire calls, including I/O, against cache mutation and destruction.
/// Resident snapshots are immutable; clone before mutation.
/// Config, pool and allocator backing must outlive every StateRc.
/// State operations require the shared pubkey cache; destruction does not use it.
/// One cache owns its filesystem directory.
pub const PersistentCheckpointStateCache = struct {
    const Self = @This();
    const Roots = std.array_hash_map.Auto(Root, void);
    const Epochs = std.array_hash_map.Auto(Epoch, void);
    /// At least one of state/persisted_key is present. A non-resident entry always
    /// names its persisted file, even if that file later becomes unavailable.
    const Entry = struct {
        state: ?*StateRc,
        persisted_key: ?DatastoreKey,
        reads: u64 = 0,
        last_read: ?std.Io.Timestamp = null,
    };

    pub const Opts = struct {
        data_dir: []const u8,
        max_epochs_in_memory: usize = DEFAULT_MAX_CP_STATE_EPOCHS_IN_MEMORY,
        disk_retention: DiskRetention = .tiered,
        max_state_bytes: usize = 1024 * 1024 * 1024,
    };

    pub const Stats = struct {
        lookups: u64 = 0,
        hits: u64 = 0,
        adds: u64 = 0,
        persists: u64 = 0,
        reloads: u64 = 0,
        pruned_from_memory: u64 = 0,
        removed_files: u64 = 0,
        failed_deletes: u64 = 0,
        failed_epochs: u64 = 0,
    };

    allocator: Allocator,
    store: FileStore,
    block_state_cache: *BlockStateCache,
    max_epochs_in_memory: usize,
    disk_retention: DiskRetention,
    max_state_bytes: usize,
    cache: std.array_hash_map.Auto(DatastoreKey, Entry) = .empty,
    epoch_index: std.array_hash_map.Auto(Epoch, Roots) = .empty,
    persistent_tiers: [tier_count]Epochs = @splat(.empty),
    pending_deletes: std.array_hash_map.Auto(DatastoreKey, void) = .empty,
    initialized: bool = false,
    finalized_epoch: Epoch = 0,
    justified_epoch: Epoch = 0,
    precomputed_checkpoint: ?DatastoreKey = null,
    precomputed_hits: ?u64 = null,
    stats: Stats = .{},

    pub fn init(allocator: Allocator, block_state_cache: *BlockStateCache, opts: Opts) Allocator.Error!Self {
        return .{
            .allocator = allocator,
            .store = try FileStore.init(allocator, opts.data_dir),
            .block_state_cache = block_state_cache,
            .max_epochs_in_memory = opts.max_epochs_in_memory,
            .disk_retention = opts.disk_retention,
            .max_state_bytes = opts.max_state_bytes,
        };
    }

    /// Call once, after optional startup recovery has read the previous run's files.
    /// Anchor insertion may precede this call; previous-run files are never admitted.
    pub fn initStore(self: *Self, io: std.Io) (FileStore.InitError || FileStore.ReadKeysError || FileStore.RemoveError || error{AlreadyInitialized})!void {
        if (self.initialized) return error.AlreadyInitialized;
        try self.store.initStore(io);
        const keys = try self.store.readKeys(io, self.allocator);
        defer self.allocator.free(keys);
        for (keys) |dk| try self.store.remove(io, dk);
        self.initialized = true;
    }

    /// Releases memory and the directory handle, leaving checkpoint files on disk.
    pub fn deinit(self: *Self, io: std.Io) void {
        while (self.cache.count() > 0) {
            const dk = self.cache.keys()[self.cache.count() - 1];
            const entry = self.cache.fetchSwapRemove(dk).?.value;
            if (entry.state) |state| state.unref();
        }
        self.cache.deinit(self.allocator);
        for (self.epoch_index.values()) |*roots| roots.deinit(self.allocator);
        self.epoch_index.deinit(self.allocator);
        for (&self.persistent_tiers) |*tier| tier.deinit(self.allocator);
        self.pending_deletes.deinit(self.allocator);
        self.store.deinit(io);
    }

    /// Retains on insertion/replacement. Caller keeps its reference on every outcome.
    /// Trusted regen supplies the root. The epoch is ceil(state.slot / SLOTS_PER_EPOCH),
    /// permitting a mid-epoch startup anchor without advancing or mutating it.
    /// Flat-retention removals are queued; the coordinator must drainPendingDeletes().
    pub fn add(self: *Self, io: std.Io, cp: Checkpoint, state: *StateRc) CacheError!void {
        const slot = state.get().state.slot() catch return error.InvalidState;
        if (cp.epoch > std.math.maxInt(u64) / slots_per_epoch or cp.epoch != st.computeCheckpointEpochAtStateSlot(slot))
            return error.InvalidCheckpoint;
        const dk = key.datastoreKey(cp);
        try self.cache.ensureUnusedCapacity(self.allocator, 1);
        try self.epoch_index.ensureUnusedCapacity(self.allocator, 1);
        try self.reserveDeletes(1);
        const epoch = try self.epoch_index.getOrPut(self.allocator, cp.epoch);
        if (!epoch.found_existing) epoch.value_ptr.* = .empty;
        errdefer if (!epoch.found_existing) {
            epoch.value_ptr.deinit(self.allocator);
            _ = self.epoch_index.orderedRemove(cp.epoch);
        };
        try epoch.value_ptr.ensureUnusedCapacity(self.allocator, 1);

        const previous = self.cache.get(dk);
        const persisted_key = if (previous) |entry| entry.persisted_key else if (self.pending_deletes.contains(dk)) dk else null;
        _ = self.pending_deletes.swapRemove(dk);
        self.cache.putAssumeCapacity(dk, .{
            .state = state.ref(),
            .persisted_key = persisted_key,
            .reads = if (previous) |entry| entry.reads + 1 else 0,
            .last_read = if (previous != null) time.start(io) else null,
        });
        epoch.value_ptr.putAssumeCapacity(cp.root, {});
        if (previous) |entry| if (entry.state) |old| old.unref();
        self.stats.adds += 1;
        self.pruneFlat();
    }

    fn lookup(self: *Self, io: std.Io, cp: Checkpoint) ?*Entry {
        self.stats.lookups += 1;
        const dk = key.datastoreKey(cp);
        const entry = self.cache.getPtr(dk) orelse return null;
        entry.reads += 1;
        entry.last_read = time.start(io);
        self.stats.hits += 1;
        if (self.precomputed_checkpoint) |precomputed| {
            if (std.mem.eql(u8, &precomputed, &dk)) self.precomputed_hits = (self.precomputed_hits orelse 0) + 1;
        }
        return entry;
    }

    /// Borrows until eviction, replacement, clear or destruction. Use ref() across those boundaries.
    pub fn get(self: *Self, io: std.Io, cp: Checkpoint) ?*CachedBeaconState {
        const state = (self.lookup(io, cp) orelse return null).state orelse return null;
        return state.get();
    }

    pub fn ref(self: *Self, io: std.Io, cp: Checkpoint) ?*StateRc {
        const state = (self.lookup(io, cp) orelse return null).state orelse return null;
        return state.ref();
    }

    fn latestCheckpoint(self: *const Self, root: Root, max_epoch: ?Epoch) ?Checkpoint {
        var latest: ?Epoch = null;
        for (self.epoch_index.keys(), self.epoch_index.values()) |epoch, roots| {
            if (epoch > (max_epoch orelse std.math.maxInt(Epoch))) continue;
            if (latest) |found| if (epoch <= found) continue;
            if (!roots.contains(root)) continue;
            const cp = Checkpoint{ .epoch = epoch, .root = root };
            if (!self.cache.contains(key.datastoreKey(cp))) continue;
            latest = epoch;
        }
        return if (latest) |epoch| .{ .epoch = epoch, .root = root } else null;
    }

    pub fn getLatest(self: *Self, io: std.Io, root: Root, max_epoch: ?Epoch) ?*CachedBeaconState {
        var bound = max_epoch;
        var remaining = self.epoch_index.count();
        while (remaining > 0) : (remaining -= 1) {
            const cp = self.latestCheckpoint(root, bound) orelse return null;
            if (self.get(io, cp)) |state| return state;
            if (cp.epoch == 0) break;
            bound = cp.epoch - 1;
        }
        return null;
    }

    pub fn refLatest(self: *Self, io: std.Io, root: Root, max_epoch: ?Epoch) ?*StateRc {
        var bound = max_epoch;
        var remaining = self.epoch_index.count();
        while (remaining > 0) : (remaining -= 1) {
            const cp = self.latestCheckpoint(root, bound) orelse return null;
            if (self.ref(io, cp)) |state| return state;
            if (cp.epoch == 0) break;
            bound = cp.epoch - 1;
        }
        return null;
    }

    fn findSeed(self: *Self, cp: Checkpoint) error{ OutOfMemory, PoolExhausted }!?*StateRc {
        var max_epoch: Epoch = 0;
        for (self.epoch_index.keys()) |epoch| max_epoch = @max(max_epoch, epoch);
        const min_epoch = max_epoch -| (self.max_epochs_in_memory -| 1);
        var candidate_epoch: ?Epoch = null;
        if (self.max_epochs_in_memory > 0) {
            for (self.epoch_index.keys(), self.epoch_index.values()) |epoch, roots| {
                if (epoch < min_epoch) continue;
                if (candidate_epoch) |found| if (epoch >= found) continue;
                for (roots.keys()) |root| {
                    const entry = self.cache.get(key.datastoreKey(.{ .epoch = epoch, .root = root })) orelse continue;
                    if (entry.state != null) {
                        candidate_epoch = epoch;
                        break;
                    }
                }
            }
        }
        if (candidate_epoch) |epoch| {
            var first: ?*StateRc = null;
            for (self.epoch_index.get(epoch).?.keys()) |root| {
                const entry = self.cache.get(key.datastoreKey(.{ .epoch = epoch, .root = root })) orelse continue;
                const state = entry.state orelse continue;
                if (first == null) first = state;
                if (cp.epoch > std.math.maxInt(u64) / slots_per_epoch) continue;
                const ancestor = blockRootAtSlot(state.get(), cp.epoch * slots_per_epoch) catch |err| switch (err) {
                    error.BlockRootUnavailable => continue,
                    else => |other| return other,
                };
                if (std.mem.eql(u8, &ancestor, &cp.root)) return state;
            }
            return first;
        }
        return null;
    }

    pub fn findSeedStateToReload(self: *Self, cp: Checkpoint) error{ OutOfMemory, PoolExhausted }!?*CachedBeaconState {
        if (try self.findSeed(cp)) |seed| return seed.get();
        return self.block_state_cache.getSeedState();
    }

    pub fn refSeedStateToReload(self: *Self, cp: Checkpoint) error{ OutOfMemory, PoolExhausted }!?*StateRc {
        if (try self.findSeed(cp)) |seed| return seed.ref();
        return self.block_state_cache.refSeedState();
    }

    pub fn updatePreComputedCheckpoint(self: *Self, cp: Checkpoint) ?u64 {
        const previous = self.precomputed_hits;
        self.precomputed_checkpoint = key.datastoreKey(cp);
        self.precomputed_hits = 0;
        return previous;
    }

    pub fn onCheckpoint(self: *Self, finalized_epoch: Epoch, justified_epoch: Epoch) void {
        self.finalized_epoch = finalized_epoch;
        self.justified_epoch = justified_epoch;
    }

    /// Every successful result owns one reference, including a resident hit.
    /// Serialize the entire call, including file I/O, against cache mutation and destruction.
    pub fn getOrReload(self: *Self, io: std.Io, cp: Checkpoint) ReloadError!?*StateRc {
        if (self.ref(io, cp)) |state| return state;
        const entry = self.cache.getPtr(key.datastoreKey(cp)) orelse return null;
        std.debug.assert(entry.state == null);
        std.debug.assert(entry.persisted_key != null);
        const seed = (try self.refSeedStateToReload(cp)) orelse return error.NoSeedState;
        defer seed.unref();
        const state_bytes = (try self.store.read(io, self.allocator, entry.persisted_key.?, .limited(self.max_state_bytes))) orelse return null;
        defer self.allocator.free(state_bytes);
        const slot = st.getStateSlotFromBytes(state_bytes) catch return error.InvalidStateBytes;
        if (cp.epoch > std.math.maxInt(u64) / slots_per_epoch or cp.epoch != st.computeCheckpointEpochAtStateSlot(slot))
            return error.InvalidCheckpoint;
        const restored = try seed.get().loadCachedBeaconState(self.allocator, io, state_bytes, null);
        errdefer {
            restored.deinit();
            self.allocator.destroy(restored);
        }
        _ = restored.state.hashTreeRoot() catch |err| return switch (err) {
            error.OutOfMemory => error.OutOfMemory,
            error.PoolExhausted => error.PoolExhausted,
            else => error.InvalidStateBytes,
        };
        const owner = try StateRc.create(self.allocator, restored);
        entry.state = owner.ref();
        self.stats.reloads += 1;
        return owner;
    }

    /// Like TS, latest lookup skips unusable candidates, including NoSeedState.
    /// Direct getOrReload still reports NoSeedState. Resource failures propagate.
    pub fn getOrReloadLatest(self: *Self, io: std.Io, root: Root, max_epoch: ?Epoch) ReloadLatestError!?*StateRc {
        var bound = max_epoch;
        // Each attempt strictly decreases the epoch, bounded by the tracked epoch count.
        var remaining = self.epoch_index.count();
        while (remaining > 0) : (remaining -= 1) {
            const cp = self.latestCheckpoint(root, bound) orelse return null;
            const state = self.getOrReload(io, cp) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                error.PoolExhausted => return error.PoolExhausted,
                error.Canceled => return error.Canceled,
                else => null,
            };
            if (state) |found| return found;
            if (cp.epoch == 0) break;
            bound = cp.epoch - 1;
        }
        return null;
    }

    pub fn getStateOrLoadDb(self: *Self, io: std.Io, allocator: Allocator, cp: Checkpoint) FileStore.ReadError!?StateOrLoadedBytes {
        if (self.ref(io, cp)) |state| return .{ .state = state };
        const entry = self.cache.get(key.datastoreKey(cp)) orelse return null;
        std.debug.assert(entry.state == null);
        std.debug.assert(entry.persisted_key != null);
        const dk = entry.persisted_key.?;
        const bytes = (try self.store.read(io, allocator, dk, .limited(self.max_state_bytes))) orelse return null;
        return .{ .loaded = .{ .persisted_key = dk, .bytes = bytes } };
    }

    pub fn getStateOrBytes(self: *Self, io: std.Io, allocator: Allocator, cp: Checkpoint) FileStore.ReadError!?StateOrBytes {
        const data = (try self.getStateOrLoadDb(io, allocator, cp)) orelse return null;
        return switch (data) {
            .state => |state| .{ .state = state },
            .loaded => |loaded| .{ .bytes = loaded.bytes },
        };
    }

    fn reserveDeletes(self: *Self, extra: usize) Allocator.Error!void {
        try self.pending_deletes.ensureTotalCapacity(self.allocator, self.pending_deletes.count() + self.cache.count() + extra);
    }

    fn persist(self: *Self, io: std.Io, cp: Checkpoint) PersistError!bool {
        const dk = key.datastoreKey(cp);
        const entry = self.cache.getPtr(dk) orelse return false;
        const state = entry.state orelse return false;
        if (entry.persisted_key != null) return false;
        const size = switch (state.get().state.*) {
            inline else => |view| view.serializedSize() catch |err| return switch (err) {
                error.OutOfMemory => error.OutOfMemory,
                error.PoolExhausted => error.PoolExhausted,
                else => error.InvalidState,
            },
        };
        if (size > self.max_state_bytes) return error.StateTooLarge;
        const bytes = state.get().state.serialize(self.allocator) catch |err| return switch (err) {
            error.OutOfMemory => error.OutOfMemory,
            error.PoolExhausted => error.PoolExhausted,
            else => error.InvalidState,
        };
        defer self.allocator.free(bytes);
        entry.persisted_key = try self.store.write(io, cp, bytes);
        self.stats.persists += 1;
        // Track the file before fallible retention so a failed maintenance pass can retry.
        try self.onPersist(cp.epoch);
        // Tier maintenance can remove this checkpoint.
        if (self.cache.getPtr(dk)) |current| {
            current.state = null;
            state.unref();
        }
        return true;
    }

    fn onPersist(self: *Self, epoch: Epoch) Allocator.Error!void {
        if (self.disk_retention != .tiered) return;
        try self.persistent_tiers[0].put(self.allocator, epoch, {});
        for (0..tier_count) |tier| {
            while (self.persistent_tiers[tier].count() > CP_STATE_TIER_BASE) {
                var oldest: ?Epoch = null;
                for (self.persistent_tiers[tier].keys()) |candidate| {
                    if (candidate == self.justified_epoch) continue;
                    oldest = @min(oldest orelse candidate, candidate);
                }
                const victim = oldest.?;
                const aligned = victim >= self.finalized_epoch and alignedForTier(victim - self.finalized_epoch, tier + 1);
                if (aligned) {
                    std.debug.assert(tier + 1 < tier_count);
                    try self.persistent_tiers[tier + 1].put(self.allocator, victim, {});
                    _ = self.persistent_tiers[tier].orderedRemove(victim);
                } else {
                    self.removeEpoch(victim);
                }
            }
        }
    }

    fn alignedForTier(offset: Epoch, tier: usize) bool {
        if (offset == 0) return true;
        if (tier >= 16) return false;
        const shift: u6 = @intCast(tier * 4);
        return offset % (@as(u64, 1) << shift) == 0;
    }

    fn removeEntry(self: *Self, dk: DatastoreKey) void {
        const entry = (self.cache.fetchOrderedRemove(dk) orelse return).value;
        if (entry.persisted_key) |persisted| self.pending_deletes.putAssumeCapacity(persisted, {});
        if (entry.state) |state| state.unref();
    }

    fn removeEpoch(self: *Self, epoch: Epoch) void {
        if (self.epoch_index.fetchOrderedRemove(epoch)) |removed| {
            var roots = removed.value;
            defer roots.deinit(self.allocator);
            for (roots.keys()) |root| self.removeEntry(key.datastoreKey(.{ .epoch = epoch, .root = root }));
        }
        for (&self.persistent_tiers) |*tier| _ = tier.orderedRemove(epoch);
    }

    fn pruneFlat(self: *Self) void {
        const disk_epochs = switch (self.disk_retention) {
            .tiered => return,
            .flat => |n| n,
        };
        const max_epochs = self.max_epochs_in_memory +| disk_epochs;
        while (self.epoch_index.count() > max_epochs) {
            var oldest: Epoch = std.math.maxInt(Epoch);
            for (self.epoch_index.keys()) |epoch| oldest = @min(oldest, epoch);
            self.removeEpoch(oldest);
        }
    }

    fn delete(self: *Self, io: std.Io, dk: DatastoreKey) PruneError!void {
        std.debug.assert(self.pending_deletes.contains(dk));
        std.debug.assert(!self.cache.contains(dk));
        const removed = self.store.removeIfExists(io, dk) catch |err| {
            _ = self.pending_deletes.orderedRemove(dk);
            self.pending_deletes.putAssumeCapacity(dk, {});
            if (err != error.Canceled) {
                self.stats.failed_deletes += 1;
                const cp = key.checkpointFromDatastoreKey(dk);
                std.log.scoped(.checkpoint_state_cache).debug("epoch={d} root={x} delete failed: {s}", .{ cp.epoch, &cp.root, @errorName(err) });
            }
            return err;
        };
        _ = self.pending_deletes.orderedRemove(dk);
        if (removed) self.stats.removed_files += 1;
    }

    /// Attempts each queued key once, retaining failures for retry and returning the
    /// first error after the pass. Cancellation stops immediately. Never overlap drains.
    pub fn drainPendingDeletes(self: *Self, io: std.Io) PruneError!void {
        var first_error: ?PruneError = null;
        var remaining = self.pending_deletes.count();
        while (remaining > 0) : (remaining -= 1) {
            const dk = self.pending_deletes.keys()[0];
            self.delete(io, dk) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                else => |other| if (first_error == null) {
                    first_error = other;
                },
            };
        }
        if (first_error) |err| return err;
    }

    /// Removes logical entries before deleting files. Failed deletes remain queued
    /// for a later drainPendingDeletes() call.
    pub fn clear(self: *Self, io: std.Io) PruneError!void {
        while (self.epoch_index.count() > 0) self.removeEpoch(self.epoch_index.keys()[0]);
        try self.drainPendingDeletes(io);
    }

    /// Queues finalized files for deletion without performing I/O.
    pub fn queueFinalizedPrune(self: *Self, finalized_epoch: Epoch) void {
        var i: usize = 0;
        while (i < self.epoch_index.count()) {
            const epoch = self.epoch_index.keys()[i];
            if (epoch < finalized_epoch) self.removeEpoch(epoch) else i += 1;
        }
    }

    pub fn pruneFinalized(self: *Self, io: std.Io, finalized_epoch: Epoch) PruneError!void {
        self.queueFinalizedPrune(finalized_epoch);
        try self.drainPendingDeletes(io);
    }

    /// Caller owns the ascending snapshot. Retention counts tracked epochs, including
    /// persisted ones; max_epoch prevents an old processed state from pruning the future.
    pub fn getEpochsToPersist(self: *const Self, allocator: Allocator, max_epoch: Epoch) Allocator.Error![]Epoch {
        var eligible: usize = 0;
        for (self.epoch_index.keys()) |epoch| if (epoch <= max_epoch) {
            eligible += 1;
        };
        const count = @min(eligible, self.epoch_index.count() -| self.max_epochs_in_memory);
        if (count == 0) return &.{};
        const MaxHeap = std.PriorityQueue(Epoch, void, struct {
            fn compare(_: void, a: Epoch, b: Epoch) std.math.Order {
                return std.math.order(b, a);
            }
        }.compare);
        // Keep the oldest count epochs in exactly one allocation, without a larger
        // sorting scratch buffer or relying on allocator support for shrinking.
        var oldest = MaxHeap.initContext({});
        errdefer oldest.deinit(allocator);
        try oldest.ensureTotalCapacityPrecise(allocator, count);
        for (self.epoch_index.keys()) |epoch| {
            if (epoch > max_epoch) continue;
            if (oldest.count() == count) {
                if (epoch >= oldest.peek().?) continue;
                _ = oldest.pop();
            }
            try oldest.push(allocator, epoch);
        }
        std.debug.assert(oldest.count() == count);
        std.mem.sort(Epoch, oldest.items, {}, std.sort.asc(Epoch));
        return oldest.items;
    }

    fn blockRootAtSlot(state: *CachedBeaconState, slot: u64) error{ OutOfMemory, PoolExhausted, BlockRootUnavailable }!Root {
        return switch (state.state.*) {
            inline else => |_, fork| (st.getBlockRootAtSlot(fork, state.state.castToFork(fork), slot) catch |err| return switch (err) {
                error.OutOfMemory => error.OutOfMemory,
                error.PoolExhausted => error.PoolExhausted,
                else => error.BlockRootUnavailable,
            }).*,
        };
    }

    /// Applies memory-only branch selection and returns checkpoints needing writes.
    /// Caller frees the slice. processState performs the selected writes.
    pub fn preparePastEpoch(self: *Self, allocator: Allocator, block_root: Root, state: *CachedBeaconState, epoch: Epoch) ProcessError![]Checkpoint {
        const slot = state.state.slot() catch return error.InvalidState;
        if (epoch > slot / slots_per_epoch) return error.InvalidCheckpoint;
        const boundary = epoch * slots_per_epoch;
        const boundary_root = if (boundary == slot) block_root else try blockRootAtSlot(state, boundary);
        const previous_root = if (boundary == 0) boundary_root else try blockRootAtSlot(state, boundary - 1);
        const roots = self.epoch_index.get(epoch) orelse return allocator.alloc(Checkpoint, 0);
        const snapshot = try self.allocator.dupe(Root, roots.keys());
        defer self.allocator.free(snapshot);
        var writes: std.ArrayList(Checkpoint) = try .initCapacity(allocator, snapshot.len);
        errdefer writes.deinit(allocator);
        for (snapshot) |root| {
            const cp = Checkpoint{ .epoch = epoch, .root = root };
            const dk = key.datastoreKey(cp);
            const entry = self.cache.get(dk) orelse continue;
            const resident = entry.state orelse continue;
            const selected = std.mem.eql(u8, &root, &boundary_root) or !std.mem.eql(u8, &root, &previous_root);
            if (entry.persisted_key != null) {
                try self.onPersist(epoch);
                if (self.cache.getPtr(dk)) |current| {
                    current.state = null;
                    resident.unref();
                }
                if (!selected) self.stats.pruned_from_memory += 1;
            } else if (selected) {
                writes.appendAssumeCapacity(cp);
            } else {
                self.removeEntry(dk);
                if (self.epoch_index.getPtr(epoch)) |remaining| {
                    _ = remaining.orderedRemove(root);
                    if (remaining.count() == 0) self.removeEpoch(epoch);
                }
                self.stats.pruned_from_memory += 1;
            }
        }
        return writes.toOwnedSlice(allocator);
    }

    fn processPastEpoch(self: *Self, io: std.Io, block_root: Root, state: *CachedBeaconState, epoch: Epoch) ProcessError!usize {
        const writes = try self.preparePastEpoch(self.allocator, block_root, state, epoch);
        defer self.allocator.free(writes);
        var persisted: usize = 0;
        for (writes) |cp| {
            if (try self.persist(io, cp)) persisted += 1;
        }
        return persisted;
    }

    /// Runs finalized pruning, persistence, and pending file deletions without sleeping.
    /// Borrows state and retains it internally across pruning and storage calls.
    /// The caller keeps its reference on success and failure.
    /// Ordinary delete failures are recorded and retried without blocking writes or
    /// losing their count. Cancellation propagates.
    pub fn processState(self: *Self, io: std.Io, block_root: Root, state: *StateRc) ProcessError!usize {
        const retained = state.ref();
        defer retained.unref();
        var finalized: Checkpoint = undefined;
        state.get().state.finalizedCheckpoint(&finalized) catch return error.InvalidState;
        self.pruneFinalized(io, finalized.epoch) catch |err| switch (err) {
            error.Canceled => return err,
            else => {},
        };
        const slot = state.get().state.slot() catch return error.InvalidState;
        const epochs = try self.getEpochsToPersist(self.allocator, slot / slots_per_epoch);
        defer self.allocator.free(epochs);
        var persisted: usize = 0;
        for (epochs) |epoch| {
            persisted += self.processPastEpoch(io, block_root, state.get(), epoch) catch |err| switch (err) {
                error.OutOfMemory, error.PoolExhausted, error.Canceled => return err,
                else => blk: {
                    self.stats.failed_epochs += 1;
                    std.log.scoped(.checkpoint_state_cache).debug("epoch={d} persistence failed: {s}", .{ epoch, @errorName(err) });
                    break :blk 0;
                },
            };
        }
        self.drainPendingDeletes(io) catch |err| switch (err) {
            error.Canceled => return err,
            else => {},
        };
        return persisted;
    }

    pub fn dumpSummary(self: *const Self, allocator: Allocator) Allocator.Error![]StateCacheItem {
        const summary = try allocator.alloc(StateCacheItem, self.cache.count());
        for (self.cache.keys(), self.cache.values(), summary) |dk, entry, *out| {
            const cp = key.checkpointFromDatastoreKey(dk);
            out.* = .{ .slot = cp.epoch * slots_per_epoch, .root = cp.root, .reads = entry.reads, .last_read = entry.last_read, .checkpoint_state = true };
        }
        return summary;
    }

    pub fn dumpCheckpointKeys(self: *const Self, allocator: Allocator) Allocator.Error![]Checkpoint {
        const keys = try allocator.alloc(Checkpoint, self.cache.count());
        for (self.cache.keys(), keys) |dk, *cp| cp.* = key.checkpointFromDatastoreKey(dk);
        return keys;
    }

    pub const StateIterator = struct {
        entries: []const Entry,
        index: usize = 0,

        pub fn next(self: *StateIterator) ?*CachedBeaconState {
            while (self.index < self.entries.len) {
                const entry = self.entries[self.index];
                self.index += 1;
                if (entry.state) |state| return state.get();
            }
            return null;
        }
    };

    /// Borrowed iterator, invalidated by the next cache mutation.
    pub fn getStates(self: *const Self) StateIterator {
        return .{ .entries = self.cache.values() };
    }
};

test {
    _ = @import("checkpoint_state_cache_test.zig");
}
