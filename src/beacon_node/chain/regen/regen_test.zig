const std = @import("std");
const testing = std.testing;
const allocator = testing.allocator;
const io = testing.io;
const ct = @import("consensus_types");
const st = @import("state_transition");
const fc = @import("fork_choice");
const Node = @import("persistent_merkle_tree").Node;
const AnyBeaconBlock = @import("fork_types").AnyBeaconBlock;
const caches = @import("../state_cache/root.zig");
const SeenBlock = @import("../seen_cache/root.zig").SeenBlock;
const regen = @import("regen.zig");
const StateRegenerator = regen.StateRegenerator;
const StateRc = st.CachedBeaconStateRc;
const Root = ct.primitive.Root.Type;
const spe = st.preset.SLOTS_PER_EPOCH;
const validator_count = 64;

const Provider = struct {
    var context: u8 = 0;
    const vtable: fc.StateProvider.VTable = .{
        .justifiedBalances = justifiedBalances,
        .slotCommitteeMembers = slotCommitteeMembers,
    };

    fn justifiedBalances(_: *anyopaque, alloc: std.mem.Allocator, _: fc.Checkpoint) anyerror!fc.JustifiedBalances {
        const increments = try alloc.alloc(u16, validator_count);
        errdefer alloc.free(increments);
        @memset(increments, 32);
        const active = try std.DynamicBitSetUnmanaged.initFull(alloc, validator_count);
        return .{ .effective_balance_increments = increments, .active_unslashed = active };
    }

    fn slotCommitteeMembers(_: *anyopaque, _: std.mem.Allocator, _: Root, _: u64, _: *std.ArrayList(u64)) anyerror!void {}
};

const Block = struct {
    root: Root,
    state: *StateRc,

    fn stateRoot(self: Block) !Root {
        return (try self.state.get().state.hashTreeRoot()).*;
    }

    fn slot(self: Block) !u64 {
        return self.state.get().state.slot();
    }
};

const Harness = struct {
    tmp: testing.TmpDir,
    path: []u8,
    pool: Node.Pool,
    helper: st.test_utils.TestCachedBeaconState,
    anchor: Block,
    fork_choice: fc.Store,
    block_cache: caches.BlockStateCache,
    checkpoint_cache: caches.PersistentCheckpointStateCache,
    seen: SeenBlock,
    regen: StateRegenerator,

    fn init() !*Harness {
        const h = try allocator.create(Harness);
        errdefer allocator.destroy(h);
        h.tmp = testing.tmpDir(.{});
        errdefer h.tmp.cleanup();
        h.path = try std.fs.path.join(allocator, &.{ ".zig-cache", "tmp", &h.tmp.sub_path });
        errdefer allocator.free(h.path);
        h.pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 600_000 });
        errdefer h.pool.deinit();
        h.helper = try st.test_utils.TestCachedBeaconState.init(allocator, &h.pool, validator_count);
        errdefer h.helper.deinit();
        try h.helper.cached_state.state.setSlot((try h.helper.cached_state.state.slot()) / spe * spe + 1);

        var anchor_block = ct.electra.BeaconBlock.default_value;
        anchor_block.slot = try h.helper.cached_state.state.slot();
        var header = ct.phase0.BeaconBlockHeader.default_value;
        header.slot = anchor_block.slot;
        try ct.electra.BeaconBlockBody.hashTreeRoot(allocator, &anchor_block.body, &header.body_root);
        try h.helper.cached_state.state.setLatestBlockHeader(&header);
        anchor_block.state_root = (try h.helper.cached_state.state.hashTreeRoot()).*;
        const block: AnyBeaconBlock = .{ .full_electra = &anchor_block };
        try block.hashTreeRoot(allocator, &h.anchor.root);
        h.anchor.state = try own(try h.helper.cached_state.clone(allocator, .{ .transfer_cache = false }));
        errdefer h.anchor.state.unref();
        h.fork_choice = try fc.Store.init(allocator, io, h.helper.config, h.anchor.state.get(), block, .valid, .{ .ctx = &Provider.context, .vtable = &Provider.vtable });
        errdefer h.fork_choice.deinit();
        h.block_cache = try caches.BlockStateCache.init(allocator, .{});
        errdefer h.block_cache.deinit();
        try h.block_cache.add(io, h.anchor.state, true);
        h.checkpoint_cache = try caches.PersistentCheckpointStateCache.init(allocator, &h.block_cache, .{ .data_dir = h.path });
        errdefer h.checkpoint_cache.deinit(io);
        try h.checkpoint_cache.initStore(io);
        h.seen = try SeenBlock.init(allocator, .{});
        errdefer h.seen.deinit();
        h.regen = StateRegenerator.init(allocator, .{
            .config = h.helper.config,
            .fork_choice = &h.fork_choice,
            .block_state_cache = &h.block_cache,
            .checkpoint_state_cache = &h.checkpoint_cache,
            .seen_block = &h.seen,
        });
        return h;
    }

    fn deinit(h: *Harness) void {
        h.seen.deinit();
        h.checkpoint_cache.deinit(io);
        h.block_cache.deinit();
        h.fork_choice.deinit();
        h.anchor.state.unref();
        h.helper.deinit();
        h.pool.deinit();
        allocator.free(h.path);
        h.tmp.cleanup();
        allocator.destroy(h);
    }

    fn own(state: *st.CachedBeaconState) !*StateRc {
        errdefer {
            state.deinit();
            allocator.destroy(state);
        }
        return StateRc.create(allocator, state);
    }

    fn addBlock(h: *Harness, parent: Block, slot: u64, graffiti: u8) !Block {
        const prepared = try own(try parent.state.get().clone(allocator, .{ .transfer_cache = false }));
        defer prepared.unref();
        try st.processSlots(allocator, io, prepared.get(), slot, null);
        var signed = ct.electra.SignedBeaconBlock.default_value;
        defer ct.electra.SignedBeaconBlock.deinit(allocator, &signed);
        signed.message.slot = slot;
        signed.message.proposer_index = try prepared.get().epoch_cache.getBeaconProposer(slot);
        signed.message.parent_root = parent.root;
        signed.message.body.graffiti[0] = graffiti;
        signed.message.body.execution_payload.timestamp = (try prepared.get().state.genesisTime()) + slot * h.helper.config.chain.SECONDS_PER_SLOT;
        signed.message.body.execution_payload.prev_randao = (try st.getRandaoMix(.electra, prepared.get().state.castToFork(.electra), slot / spe)).*;
        const post = try own(try st.stateTransition(allocator, io, parent.state.get(), .{ .full_electra = &signed }, .{
            .verify_signatures = false,
            .verify_proposer = false,
            .verify_state_root = false,
            .transfer_cache = false,
        }, null));
        errdefer post.unref();
        signed.message.state_root = (try post.get().state.hashTreeRoot()).*;
        var root: Root = undefined;
        const block: AnyBeaconBlock = .{ .full_electra = &signed.message };
        try block.hashTreeRoot(allocator, &root);
        try h.fork_choice.onTick(@max(h.fork_choice.time_ms, h.fork_choice.timing.timeAtSlotMs(slot)));
        try h.fork_choice.onBlock(io, block, root, post.get(), .valid);
        const bytes = try allocator.alloc(u8, ct.electra.SignedBeaconBlock.serializedSize(&signed));
        defer allocator.free(bytes);
        _ = ct.electra.SignedBeaconBlock.serializeIntoBytes(&signed, bytes);
        _ = try h.seen.add(root, bytes);
        return .{ .root = root, .state = post };
    }

    fn addSummary(h: *Harness, parent_root: Root, slot: u64, id: u64) !Root {
        var root: Root = @splat(0x91);
        std.mem.writeInt(u64, root[0..8], id, .little);
        var state_root: Root = @splat(0x92);
        std.mem.writeInt(u64, state_root[0..8], id, .little);
        const cp = h.fork_choice.finalized_checkpoint;
        try h.fork_choice.onTick(@max(h.fork_choice.time_ms, h.fork_choice.timing.timeAtSlotMs(slot)));
        try h.fork_choice.onBlockSummary(.{
            .root = root,
            .parent_root = parent_root,
            .slot = slot,
            .proposer_index = 0,
            .state_root = state_root,
            .fork = .electra,
            .justified_checkpoint = cp,
            .finalized_checkpoint = cp,
            .unrealized_justified_checkpoint = cp,
            .unrealized_finalized_checkpoint = cp,
            .execution_status = .pre_merge,
        });
        return root;
    }

    fn addGloasBlock(h: *Harness, parent: Block, slot: u64, id: u8, full_parent: bool) !Block {
        const c = @import("constants");
        const prepared = try own(try parent.state.get().clone(allocator, .{ .transfer_cache = false }));
        defer prepared.unref();
        try st.processSlots(allocator, io, prepared.get(), slot, null);
        const state = prepared.get().state.castToFork(.gloas);
        var parent_bid = ct.gloas.ExecutionPayloadBid.default_value;
        defer ct.gloas.ExecutionPayloadBid.deinit(allocator, &parent_bid);
        try state.inner.getValue(allocator, "latest_execution_payload_bid", &parent_bid);
        var signed = ct.gloas.SignedBeaconBlock.default_value;
        defer ct.gloas.SignedBeaconBlock.deinit(allocator, &signed);
        signed.message.slot = slot;
        signed.message.proposer_index = try prepared.get().getBeaconProposer(slot);
        signed.message.parent_root = parent.root;
        signed.message.body.graffiti[0] = id;
        signed.message.body.signed_execution_payload_bid.signature = c.G2_POINT_AT_INFINITY;
        const bid = &signed.message.body.signed_execution_payload_bid.message;
        bid.builder_index = c.BUILDER_INDEX_SELF_BUILD;
        bid.slot = slot;
        bid.parent_block_root = parent.root;
        bid.parent_block_hash = if (full_parent) parent_bid.block_hash else (try state.inner.getFieldRoot("latest_block_hash")).*;
        bid.block_hash = @splat(id);
        bid.prev_randao = (try st.getRandaoMix(.gloas, state, slot / spe)).*;
        try ct.gloas.ExecutionRequests.hashTreeRoot(allocator, &signed.message.body.parent_execution_requests, &bid.execution_requests_root);
        const post = try own(try st.stateTransition(allocator, io, parent.state.get(), .{ .full_gloas = &signed }, .{
            .verify_signatures = false,
            .verify_proposer = false,
            .verify_state_root = false,
            .transfer_cache = false,
        }, null));
        errdefer post.unref();
        signed.message.state_root = (try post.get().state.hashTreeRoot()).*;
        var root: Root = undefined;
        const block: AnyBeaconBlock = .{ .full_gloas = &signed.message };
        try block.hashTreeRoot(allocator, &root);
        try h.fork_choice.onTick(@max(h.fork_choice.time_ms, h.fork_choice.timing.timeAtSlotMs(slot)));
        if (full_parent and parent.state.get().state.forkSeq() == .gloas) {
            try h.fork_choice.onExecutionPayloadEnvelope(parent.root, .valid, null);
        }
        try h.fork_choice.onBlock(io, block, root, post.get(), .valid);
        const bytes = try allocator.alloc(u8, ct.gloas.SignedBeaconBlock.serializedSize(&signed));
        defer allocator.free(bytes);
        _ = ct.gloas.SignedBeaconBlock.serializeIntoBytes(&signed, bytes);
        _ = try h.seen.add(root, bytes);
        return .{ .root = root, .state = post };
    }
};

test "StateRegenerator cache hits retain the same owner and survive eviction" {
    const h = try Harness.init();
    defer h.deinit();
    const root = try h.anchor.stateRoot();
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    h.regen.allocator = failing.allocator();
    const state = try h.regen.getState(io, root, false, null);
    defer state.unref();
    try testing.expectEqual(h.anchor.state, state);
    h.block_cache.clear();
    h.seen.clear();
    try testing.expectEqualSlices(u8, &root, try state.get().state.hashTreeRoot());
    try testing.expect(!failing.has_induced_failure);
}

test "StateRegenerator replays a branch and admits states only with disk reload enabled" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const a = try h.addBlock(h.anchor, slot + 1, 1);
    defer a.state.unref();
    const b = try h.addBlock(a, slot + 2, 2);
    defer b.state.unref();
    const sibling = try h.addBlock(h.anchor, slot + 1, 3);
    defer sibling.state.unref();
    try h.block_cache.add(io, sibling.state, false);
    const transferred_before = h.anchor.state.get().cloned_count_with_transfer_cache;
    const root = try b.stateRoot();
    const first = try h.regen.getState(io, root, false, null);
    defer first.unref();
    try testing.expectEqualSlices(u8, &root, try first.get().state.hashTreeRoot());
    try testing.expect(h.block_cache.get(io, root) == null);
    try testing.expectEqual(slot, try (try h.anchor.state.get().state.latestBlockHeader()).get("slot"));
    try testing.expect(h.anchor.state.get().cloned_count_with_transfer_cache > transferred_before);
    const second = try h.regen.getState(io, root, true, null);
    defer second.unref();
    try testing.expectEqual(second.get(), h.block_cache.get(io, root));
    try testing.expect(h.block_cache.get(io, try a.stateRoot()) != null);
    try testing.expect(h.block_cache.get(io, try a.stateRoot()).?.cloned_count_with_transfer_cache > 0);
    h.block_cache.clear();
    try testing.expectEqualSlices(u8, &root, try second.get().state.hashTreeRoot());
}

test "StateRegenerator reports unknown states parents missing seeds and missing blocks" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    try testing.expectError(error.StateNotInForkChoice, h.regen.getState(io, @splat(255), false, null));
    try testing.expectError(error.BlockNotInForkChoice, h.regen.getPreState(io, @splat(255), slot + 1, .{}));
    try testing.expectError(error.SlotBeforeBlockSlot, h.regen.getPreState(io, h.anchor.root, slot - 1, .{}));
    try testing.expectError(error.SlotBeforeBlockSlot, h.regen.getBlockSlotState(io, h.anchor.root, slot - 1, .{}, false));
    const block = try h.addBlock(h.anchor, slot + 1, 1);
    defer block.state.unref();
    h.seen.clear();
    try testing.expectError(error.BlockNotInCache, h.regen.getState(io, try block.stateRoot(), true, null));
    try testing.expect(h.block_cache.get(io, try block.stateRoot()) == null);
    h.block_cache.clear();
    try testing.expectError(error.NoSeedState, h.regen.getState(io, try block.stateRoot(), false, null));
}

test "StateRegenerator advances checkpoints and preserves same epoch prestate semantics" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const boundary = (slot / spe + 1) * spe;
    const same_epoch = try h.regen.getPreState(io, h.anchor.root, slot + 1, .{});
    defer same_epoch.unref();
    try testing.expectEqual(h.anchor.state, same_epoch);
    const before_root = try h.anchor.stateRoot();
    const advanced = try h.regen.getPreState(io, h.anchor.root, boundary + 1, .{ .dont_transfer_cache = true });
    defer advanced.unref();
    try testing.expectEqual(boundary + 1, try advanced.get().state.slot());
    try testing.expectEqualSlices(u8, &before_root, try h.anchor.state.get().state.hashTreeRoot());
    const cp: caches.Checkpoint = .{ .epoch = boundary / spe, .root = h.anchor.root };
    const checkpoint = h.checkpoint_cache.ref(io, cp).?;
    defer checkpoint.unref();
    try testing.expectEqual(boundary, try checkpoint.get().state.slot());
    const checkpoint_root = (try checkpoint.get().state.hashTreeRoot()).*;
    h.block_cache.clear();
    const hit = try h.regen.getBlockSlotState(io, h.anchor.root, boundary, .{}, false);
    defer hit.unref();
    try testing.expectEqual(checkpoint, hit);
    try testing.expectEqualSlices(u8, &checkpoint_root, try checkpoint.get().state.hashTreeRoot());
}

test "StateRegenerator uses the nearest branch checkpoint before the replay block epoch" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const boundary = (slot / spe + 1) * spe;
    const block = try h.addBlock(h.anchor, boundary + 1, 1);
    defer block.state.unref();
    const checkpoint = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary, .{});
    defer checkpoint.unref();
    const newer = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary + spe, .{});
    defer newer.unref();
    h.block_cache.clear();
    const actual = try h.regen.getState(io, try block.stateRoot(), false, null);
    defer actual.unref();
    try testing.expectEqualSlices(u8, try block.state.get().state.hashTreeRoot(), try actual.get().state.hashTreeRoot());
    try testing.expectEqual(boundary, try checkpoint.get().state.slot());
    try testing.expectEqual(boundary + spe, try newer.get().state.slot());
}

test "StateRegenerator bounds checkpoint seeds strictly before a boundary block" {
    const h = try Harness.init();
    defer h.deinit();
    const boundary = (try h.anchor.slot() / spe + 1) * spe;
    const block = try h.addBlock(h.anchor, boundary, 1);
    defer block.state.unref();
    const checkpoint = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary, .{});
    defer checkpoint.unref();
    h.block_cache.clear();
    try testing.expectError(error.NoSeedState, h.regen.getState(io, try block.stateRoot(), false, null));
}

test "StateRegenerator persists from the second boundary and optionally reloads a checkpoint" {
    const h = try Harness.init();
    defer h.deinit();
    const boundary = (try h.anchor.slot() / spe + 1) * spe;
    h.checkpoint_cache.max_epochs_in_memory = 0;
    const first = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary + 1, .{});
    defer first.unref();
    try testing.expectEqual(boundary, try first.get().state.slot());
    try testing.expectEqual(0, h.checkpoint_cache.stats.persists);
    const second = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary + spe, .{});
    defer second.unref();
    try testing.expect(h.checkpoint_cache.stats.persists > 0);
    const cp: caches.Checkpoint = .{ .epoch = boundary / spe, .root = h.anchor.root };
    try testing.expect(h.checkpoint_cache.get(io, cp) == null);
    const block = try h.addBlock(h.anchor, boundary + 1, 1);
    defer block.state.unref();

    // Keep a different root available only as the filesystem loader's seed.
    h.block_cache.clear();
    const other = try Harness.own(try h.anchor.state.get().clone(allocator, .{ .transfer_cache = false }));
    defer other.unref();
    try (try other.get().state.latestBlockHeader()).set("proposer_index", 1);
    try h.block_cache.add(io, other, false);
    try testing.expectError(error.NoSeedState, h.regen.getState(io, try block.stateRoot(), false, null));
    const restored = try h.regen.getState(io, try block.stateRoot(), true, null);
    defer restored.unref();
    try testing.expectEqualSlices(u8, try block.state.get().state.hashTreeRoot(), try restored.get().state.hashTreeRoot());
    try testing.expectEqual(1, h.checkpoint_cache.stats.reloads);
    try testing.expectEqual(restored.get(), h.block_cache.get(io, try block.stateRoot()));
}

test "StateRegenerator prestate and block slot lookups reload a persisted-only parent checkpoint" {
    const h = try Harness.init();
    defer h.deinit();
    const parent = try h.addBlock(h.anchor, try h.anchor.slot() + 1, 1);
    defer parent.state.unref();
    const boundary = (try parent.slot() / spe + 1) * spe;
    const checkpoint = try h.regen.processSlotsToNearestCheckpoint(io, parent.state, boundary, .{});
    defer checkpoint.unref();
    const cp: caches.Checkpoint = .{ .epoch = boundary / spe, .root = parent.root };
    h.checkpoint_cache.max_epochs_in_memory = 0;
    const expected = try Harness.own(try parent.state.get().clone(allocator, .{ .transfer_cache = false }));
    defer expected.unref();
    try st.processSlots(allocator, io, expected.get(), boundary + 1, null);
    const expected_root = (try expected.get().state.hashTreeRoot()).*;

    h.seen.clear();
    try testing.expect(h.block_cache.get(io, try parent.stateRoot()) == null);
    var canceled_vtable = io.vtable.*;
    canceled_vtable.dirOpenFile = struct {
        fn open(_: ?*anyopaque, _: std.Io.Dir, _: []const u8, _: std.Io.Dir.OpenFileOptions) std.Io.File.OpenError!std.Io.File {
            return error.Canceled;
        }
    }.open;
    const canceled_io: std.Io = .{ .userdata = io.userdata, .vtable = &canceled_vtable };

    for ([_]bool{ true, false }, 0..) |prestate, i| {
        errdefer std.debug.print("persisted checkpoint lookup prestate={any}\n", .{prestate});
        try testing.expectEqual(@as(usize, if (i == 0) 1 else 0), try h.checkpoint_cache.processState(io, parent.root, checkpoint));
        try testing.expect(h.checkpoint_cache.get(io, cp) == null);
        try testing.expectError(error.BlockNotInCache, h.regen.getBlockSlotState(io, parent.root, boundary + 1, .{}, false));
        if (prestate) {
            try testing.expectError(error.Canceled, h.regen.getPreState(canceled_io, parent.root, boundary + 1, .{}));
        } else {
            try testing.expectError(error.Canceled, h.regen.getBlockSlotState(canceled_io, parent.root, boundary + 1, .{}, true));
        }
        try testing.expect(h.checkpoint_cache.get(io, cp) == null);
        try testing.expectEqual(i, h.checkpoint_cache.stats.reloads);
        try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));

        const restored = if (prestate)
            try h.regen.getPreState(io, parent.root, boundary + 1, .{})
        else
            try h.regen.getBlockSlotState(io, parent.root, boundary + 1, .{}, true);
        defer restored.unref();
        try testing.expectEqual(boundary + 1, try restored.get().state.slot());
        try testing.expectEqualSlices(u8, &expected_root, try restored.get().state.hashTreeRoot());
        try testing.expectEqual(i + 1, h.checkpoint_cache.stats.reloads);
        try testing.expectEqual(@as(u64, 1), h.checkpoint_cache.stats.persists);
        try testing.expectEqual(boundary, try h.checkpoint_cache.get(io, cp).?.state.slot());
        try testing.expect(h.block_cache.get(io, try parent.stateRoot()) == null);
        try testing.expectEqual(@as(usize, 0), h.seen.size());
    }
}

test "StateRegenerator matches TS checkpoint persistence with two roots and two resident epochs" {
    for ([_]bool{ false, true }) |multiple_epochs| {
        errdefer std.debug.print("TS checkpoint persistence multiple_epochs={any}\n", .{multiple_epochs});
        const h = try Harness.init();
        defer h.deinit();
        h.checkpoint_cache.max_epochs_in_memory = 2;
        const boundary = (try h.anchor.slot() / spe + 1) * spe;
        const previous = try h.addBlock(h.anchor, boundary - 1, 1);
        defer previous.state.unref();
        const previous_checkpoint = try Harness.own(try previous.state.get().clone(allocator, .{ .transfer_cache = false }));
        defer previous_checkpoint.unref();
        try st.processSlots(allocator, io, previous_checkpoint.get(), boundary, null);
        const current = try h.addBlock(previous, boundary, 2);
        defer current.state.unref();
        const next = try h.addBlock(current, boundary + spe, 3);
        defer next.state.unref();
        const cp0a: caches.Checkpoint = .{ .epoch = boundary / spe, .root = previous.root };
        const cp0b: caches.Checkpoint = .{ .epoch = boundary / spe, .root = current.root };
        const cp1: caches.Checkpoint = .{ .epoch = boundary / spe + 1, .root = next.root };
        try h.checkpoint_cache.add(io, cp0a, previous_checkpoint);
        try h.checkpoint_cache.add(io, cp0b, current.state);
        try h.checkpoint_cache.add(io, cp1, next.state);
        const before = try h.checkpoint_cache.store.readKeys(io, allocator);
        defer allocator.free(before);
        try testing.expectEqual(@as(usize, 0), before.len);

        const result = try h.regen.processSlotsToNearestCheckpoint(io, if (multiple_epochs) current.state else next.state, boundary + 2 * spe, .{ .dont_transfer_cache = true });
        defer result.unref();
        try testing.expectEqual(boundary + 2 * spe, try result.get().state.slot());
        const keys = try h.checkpoint_cache.store.readKeys(io, allocator);
        defer allocator.free(keys);
        try testing.expectEqual(@as(usize, if (multiple_epochs) 1 else 0), keys.len);
        try testing.expectEqual(@as(u64, if (multiple_epochs) 1 else 0), h.checkpoint_cache.stats.persists);
        try testing.expectEqual(@as(u64, 0), h.checkpoint_cache.stats.failed_epochs);
        if (multiple_epochs) {
            try testing.expectEqualSlices(u8, &caches.datastoreKey(cp0b), &keys[0]);
            try testing.expectEqual(@as(u64, 1), h.checkpoint_cache.stats.pruned_from_memory);
            try testing.expect(h.checkpoint_cache.get(io, cp0a) == null);
            try testing.expect(h.checkpoint_cache.get(io, cp0b) == null);
            var removed = try h.checkpoint_cache.getStateOrBytes(io, allocator, cp0a);
            defer if (removed) |*state_or_bytes| state_or_bytes.deinit(allocator);
            try testing.expect(removed == null);
        } else {
            try testing.expect(h.checkpoint_cache.get(io, cp0a) != null);
            try testing.expect(h.checkpoint_cache.get(io, cp0b) != null);
        }
        try testing.expect(h.checkpoint_cache.get(io, cp1) != null);
    }
}

test "StateRegenerator slot failures report diagnostics and preserve the source" {
    const h = try Harness.init();
    defer h.deinit();
    const epoch = try h.anchor.slot() / spe + 1;
    const before_root = try h.anchor.stateRoot();
    const BeaconConfig = @import("config").BeaconConfig;
    // Gloas without the preceding Fulu upgrade fails inside processSlots.
    h.helper.config.* = BeaconConfig.init(h.helper.config.chain.merge(.{ .GLOAS_FORK_EPOCH = epoch }), (try h.anchor.state.get().state.genesisValidatorsRoot()).*);
    var diagnostics: regen.Diagnostics = .{};
    try testing.expectError(error.StateTransitionError, h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, epoch * spe, .{ .diagnostics = &diagnostics }));
    try testing.expectEqualStrings("InvalidForkCast", diagnostics.transition_error.?);
    try testing.expectEqualSlices(u8, &before_root, try h.anchor.state.get().state.hashTreeRoot());
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
    try testing.expect(h.checkpoint_cache.getLatest(io, h.anchor.root, null) == null);
}

test "StateRegenerator rejects missing finalized roots and non-descending ancestry" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    {
        const finalized = h.fork_choice.finalized_checkpoint;
        defer h.fork_choice.finalized_checkpoint = finalized;
        h.fork_choice.finalized_checkpoint.root = @splat(255);
        try testing.expectError(error.InvalidForkChoice, h.regen.getPreState(io, h.anchor.root, slot + 1, .{}));
    }
    const root = try h.addSummary(h.anchor.root, slot + 1, 1);
    const index = h.fork_choice.blockIndex(root).?;
    const parent = h.fork_choice.blocks.items(.parent)[index];
    defer h.fork_choice.blocks.items(.parent)[index] = parent;
    h.fork_choice.blocks.items(.parent)[index] = index;
    try testing.expectError(error.InvalidForkChoice, h.regen.getState(io, h.fork_choice.blocks.items(.state_root)[index], false, null));
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
}

test "StateRegenerator preflights all replay blocks before admitting any state" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const first = try h.addBlock(h.anchor, slot + 1, 1);
    defer first.state.unref();
    const second = try h.addBlock(first, slot + 2, 2);
    defer second.state.unref();
    try testing.expect(h.seen.remove(second.root));
    try testing.expectError(error.BlockNotInCache, h.regen.getState(io, try second.stateRoot(), true, null));
    try testing.expect(h.block_cache.get(io, try first.stateRoot()) == null);
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
}

test "StateRegenerator releases failed decode and transition results without changing the seed" {
    const h = try Harness.init();
    defer h.deinit();
    const block = try h.addBlock(h.anchor, try h.anchor.slot() + 1, 1);
    defer block.state.unref();
    const expected = try h.anchor.stateRoot();
    var signed = ct.electra.SignedBeaconBlock.default_value;
    defer ct.electra.SignedBeaconBlock.deinit(allocator, &signed);
    try ct.electra.SignedBeaconBlock.deserializeFromBytes(allocator, h.seen.get(block.root).?, &signed);
    try testing.expect(h.seen.remove(block.root));
    _ = try h.seen.add(block.root, "bad SSZ");
    try testing.expectError(error.InvalidBlockBytes, h.regen.getState(io, try block.stateRoot(), true, null));

    signed.message.parent_root = @splat(255);
    const bytes = try allocator.alloc(u8, ct.electra.SignedBeaconBlock.serializedSize(&signed));
    defer allocator.free(bytes);
    _ = ct.electra.SignedBeaconBlock.serializeIntoBytes(&signed, bytes);
    try testing.expect(h.seen.remove(block.root));
    _ = try h.seen.add(block.root, bytes);
    const regenerator: *const StateRegenerator = &h.regen;
    var diagnostics: regen.Diagnostics = .{};
    try testing.expectError(error.StateTransitionError, regenerator.getState(io, try block.stateRoot(), true, &diagnostics));
    try testing.expectEqualStrings("BlockParentRootMismatch", diagnostics.transition_error.?);
    try testing.expect(h.block_cache.get(io, try block.stateRoot()) == null);
    try testing.expectEqualSlices(u8, &expected, try h.anchor.state.get().state.hashTreeRoot());
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
    const cached = try h.regen.getState(io, expected, false, null);
    defer cached.unref();
    try testing.expectEqualStrings("BlockParentRootMismatch", diagnostics.transition_error.?);
    const same_output = try regenerator.getState(io, expected, false, &diagnostics);
    defer same_output.unref();
    try testing.expect(diagnostics.transition_error == null);

    try testing.expectError(error.StateTransitionError, regenerator.getPreState(io, block.root, try block.slot() + 1, .{ .diagnostics = &diagnostics }));
    try testing.expectEqualStrings("BlockParentRootMismatch", diagnostics.transition_error.?);
    try testing.expectError(error.StateTransitionError, regenerator.getBlockSlotState(io, block.root, try block.slot() + 1, .{ .diagnostics = &diagnostics }, false));
    try testing.expectEqualStrings("BlockParentRootMismatch", diagnostics.transition_error.?);
}

test "StateRegenerator forwards transition details into caller-owned diagnostics" {
    const h = try Harness.init();
    defer h.deinit();
    const block = try h.addBlock(h.anchor, try h.anchor.slot() + 1, 1);
    defer block.state.unref();
    var signed = ct.electra.SignedBeaconBlock.default_value;
    defer ct.electra.SignedBeaconBlock.deinit(allocator, &signed);
    try ct.electra.SignedBeaconBlock.deserializeFromBytes(allocator, h.seen.get(block.root).?, &signed);
    signed.message.body.execution_payload.block_hash = @splat(1);
    try signed.message.body.execution_payload.withdrawals.append(allocator, ct.capella.Withdrawal.default_value);
    const bytes = try allocator.alloc(u8, ct.electra.SignedBeaconBlock.serializedSize(&signed));
    defer allocator.free(bytes);
    _ = ct.electra.SignedBeaconBlock.serializeIntoBytes(&signed, bytes);
    try testing.expect(h.seen.remove(block.root));
    _ = try h.seen.add(block.root, bytes);

    var diagnostics: regen.Diagnostics = .{};
    try testing.expectError(error.StateTransitionError, h.regen.getState(io, try block.stateRoot(), false, &diagnostics));
    try testing.expectEqualStrings("WithdrawalsLengthMismatch", diagnostics.transition_error.?);
    const mismatch = diagnostics.transition.detail.?.withdrawals_length_mismatch;
    try testing.expectEqual(@as(usize, 0), mismatch.expected);
    try testing.expectEqual(@as(usize, 1), mismatch.actual);

    const cached = try h.regen.getPreState(io, h.anchor.root, try h.anchor.slot() + 1, .{});
    defer cached.unref();
    try testing.expectEqualStrings("WithdrawalsLengthMismatch", diagnostics.transition_error.?);
    try testing.expect(diagnostics.transition.detail != null);
    try testing.expectError(error.BlockNotInForkChoice, h.regen.getPreState(io, @splat(255), 0, .{ .diagnostics = &diagnostics }));
    try testing.expect(diagnostics.transition_error == null);
    try testing.expect(diagnostics.transition.detail == null);
}

test "StateRegenerator verifies the fork choice state root before cache admission" {
    const h = try Harness.init();
    defer h.deinit();
    const block = try h.addBlock(h.anchor, try h.anchor.slot() + 1, 1);
    defer block.state.unref();
    const bad_root: Root = @splat(254);
    h.fork_choice.blocks.items(.state_root)[h.fork_choice.blockIndex(block.root).?] = bad_root;
    var diagnostics: regen.Diagnostics = .{};
    try testing.expectError(error.InvalidStateRoot, h.regen.getState(io, bad_root, true, &diagnostics));
    const mismatch = diagnostics.invalid_state_root.?;
    try testing.expectEqual(try block.slot(), mismatch.slot);
    try testing.expectEqual(bad_root, mismatch.expected);
    try testing.expectEqual(try block.stateRoot(), mismatch.actual);
    try testing.expect(h.block_cache.get(io, bad_root) == null);
    try testing.expect(h.block_cache.get(io, try block.stateRoot()) == null);
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
    const state = try h.regen.getState(io, try h.anchor.stateRoot(), false, &diagnostics);
    defer state.unref();
    try testing.expect(diagnostics.invalid_state_root == null);
}

test "StateRegenerator replay bound counts blocks and accepts the exact limit" {
    const h = try Harness.init();
    defer h.deinit();
    var root = h.anchor.root;
    const slot = try h.anchor.slot();
    for (0..regen.MAX_REPLAY_BLOCKS) |i| {
        errdefer std.debug.print("replay descriptor {d}\n", .{i});
        root = try h.addSummary(root, slot + i + 1, i);
    }
    const index = h.fork_choice.blockIndex(root).?;
    try testing.expectError(error.BlockNotInCache, h.regen.getState(io, h.fork_choice.blocks.items(.state_root)[index], false, null));
    root = try h.addSummary(root, slot + regen.MAX_REPLAY_BLOCKS + 1, regen.MAX_REPLAY_BLOCKS);
    try testing.expectError(error.TooManyBlocksProcessed, h.regen.getState(io, h.fork_choice.blocks.items(.state_root)[h.fork_choice.blockIndex(root).?], false, null));
    h.block_cache.clear();
    try testing.expectError(error.NoSeedState, h.regen.getState(io, h.fork_choice.blocks.items(.state_root)[h.fork_choice.blockIndex(root).?], false, null));
}

test "StateRegenerator replays skipped slots beyond five epochs" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot() + 6 * spe + 1;
    const block = try h.addBlock(h.anchor, slot, 1);
    defer block.state.unref();
    const actual = try h.regen.getState(io, try block.stateRoot(), false, null);
    defer actual.unref();
    try testing.expectEqual(slot, try actual.get().state.slot());
    try testing.expectEqualSlices(u8, try block.state.get().state.hashTreeRoot(), try actual.get().state.hashTreeRoot());
}

test "StateRegenerator dont_transfer_cache preserves checkpoint child views across further epochs" {
    const h = try Harness.init();
    defer h.deinit();
    const boundary = (try h.anchor.slot() / spe + 1) * spe;
    const first = try h.regen.processSlotsToNearestCheckpoint(io, h.anchor.state, boundary, .{});
    defer first.unref();
    const root = (try first.get().state.hashTreeRoot()).*;
    const header = try first.get().state.latestBlockHeader();
    const header_slot = try header.get("slot");
    const second = try h.regen.getBlockSlotState(io, h.anchor.root, boundary + spe + 1, .{ .dont_transfer_cache = true }, false);
    defer second.unref();
    try testing.expectEqual(boundary + spe + 1, try second.get().state.slot());
    try testing.expectEqual(header_slot, try header.get("slot"));
    try testing.expectEqualSlices(u8, &root, try first.get().state.hashTreeRoot());
    try testing.expectEqual(0, first.get().cloned_count_with_transfer_cache);
}

test "StateRegenerator transfers cached epoch states and the final partial epoch by default" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const epoch = slot / spe + 1;
    const before = try h.anchor.stateRoot();
    const count = h.anchor.state.get().cloned_count_with_transfer_cache;
    const result = try h.regen.getBlockSlotState(io, h.anchor.root, (epoch + 1) * spe + 1, .{}, false);
    defer result.unref();
    try testing.expectEqual(count + 1, h.anchor.state.get().cloned_count_with_transfer_cache);
    for (epoch..epoch + 2) |e| {
        errdefer std.debug.print("checkpoint epoch {d}\n", .{e});
        const state = h.checkpoint_cache.get(io, .{ .epoch = e, .root = h.anchor.root }).?;
        try testing.expect(state.cloned_count_with_transfer_cache > 0);
        try testing.expectEqual(e * spe, try state.state.slot());
    }
    try testing.expect(result.get().created_with_transfer_cache);
    try testing.expectEqualSlices(u8, &before, try h.anchor.state.get().state.hashTreeRoot());
}

test "StateRegenerator replay cleans up every induced allocation failure" {
    const h = try Harness.init();
    defer h.deinit();
    const block = try h.addBlock(h.anchor, try h.anchor.slot() + 1, 1);
    defer block.state.unref();
    try testing.checkAllAllocationFailures(allocator, struct {
        fn run(alloc: std.mem.Allocator, harness: *Harness, root: Root) !void {
            defer st.deinitReusedEpochTransitionCache();
            var regenerator = harness.regen;
            regenerator.allocator = alloc;
            const state = try regenerator.getState(io, root, false, null);
            defer state.unref();
            try testing.expectEqualSlices(u8, &root, try state.get().state.hashTreeRoot());
        }
    }.run, .{ h, try block.stateRoot() });
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
}

test "StateRegenerator slot advancement cleans up every induced allocation failure" {
    const h = try Harness.init();
    defer h.deinit();
    const target_slot = try h.anchor.slot() + 1;
    try testing.checkAllAllocationFailures(allocator, struct {
        fn run(alloc: std.mem.Allocator, harness: *Harness, target: u64) !void {
            defer harness.checkpoint_cache.clear(io) catch unreachable;
            defer st.deinitReusedEpochTransitionCache();
            var regenerator = harness.regen;
            regenerator.allocator = alloc;
            const state = try regenerator.getBlockSlotState(io, harness.anchor.root, target, .{}, false);
            defer state.unref();
            try testing.expectEqual(target, try state.get().state.slot());
        }
    }.run, .{ h, target_slot });
    try testing.expectEqual(@as(u32, 2), h.anchor.state.ref_count.load(.monotonic));
}

test "StateRegenerator follows fork choice after finalization and index compaction" {
    const h = try Harness.init();
    defer h.deinit();
    const slot = try h.anchor.slot();
    const sibling = try h.addBlock(h.anchor, slot + 1, 1);
    defer sibling.state.unref();
    const boundary = (slot / spe + 1) * spe;
    const finalized = try h.addBlock(h.anchor, boundary, 2);
    defer finalized.state.unref();
    const child = try h.addBlock(finalized, boundary + 1, 3);
    defer child.state.unref();
    const cp: fc.Checkpoint = .{ .epoch = boundary / spe, .root = finalized.root };
    try h.fork_choice.updateCheckpoints(cp, cp);
    try testing.expectError(error.BlockNotInForkChoice, h.regen.getPreState(io, sibling.root, slot + spe + 2, .{}));
    try h.block_cache.add(io, finalized.state, true);
    try testing.expect(try h.fork_choice.prune() > 0);
    try testing.expectEqual(@as(?fc.BlockIndex, 0), h.fork_choice.blockIndex(finalized.root));
    const result = try h.regen.getState(io, try child.stateRoot(), false, null);
    defer result.unref();
    try testing.expectEqualSlices(u8, try child.state.get().state.hashTreeRoot(), try result.get().state.hashTreeRoot());
}

test "StateRegenerator slot advancement crosses the Electra Fulu fork" {
    const h = try Harness.init();
    defer h.deinit();
    const epoch = try h.anchor.slot() / spe + 1;
    const BeaconConfig = @import("config").BeaconConfig;
    h.helper.config.* = BeaconConfig.init(h.helper.config.chain.merge(.{ .FULU_FORK_EPOCH = epoch }), (try h.anchor.state.get().state.genesisValidatorsRoot()).*);
    const result = try h.regen.getBlockSlotState(io, h.anchor.root, epoch * spe + 1, .{}, false);
    defer result.unref();
    try testing.expectEqual(.fulu, result.get().state.forkSeq());
    try testing.expectEqual(.electra, h.anchor.state.get().state.forkSeq());
    const checkpoint = h.checkpoint_cache.get(io, .{ .epoch = epoch, .root = h.anchor.root }).?;
    try testing.expectEqual(.fulu, checkpoint.state.forkSeq());
    try testing.expectEqual(epoch * spe, try checkpoint.state.slot());
}

test "StateRegenerator replays Gloas full and empty parent branches from block bytes" {
    const h = try Harness.init();
    defer h.deinit();
    const epoch = try h.anchor.slot() / spe + 1;
    const BeaconConfig = @import("config").BeaconConfig;
    h.helper.config.* = BeaconConfig.init(h.helper.config.chain.merge(.{ .FULU_FORK_EPOCH = epoch, .GLOAS_FORK_EPOCH = epoch }), (try h.anchor.state.get().state.genesisValidatorsRoot()).*);
    const parent = try h.addGloasBlock(h.anchor, epoch * spe + 1, 1, true);
    defer parent.state.unref();
    const full = try h.addGloasBlock(parent, epoch * spe + 2, 2, true);
    defer full.state.unref();
    const empty = try h.addGloasBlock(parent, epoch * spe + 2, 3, false);
    defer empty.state.unref();
    try testing.expectEqual(.full, h.fork_choice.blocks.items(.parent_payload_status)[h.fork_choice.blockIndex(full.root).?]);
    try testing.expectEqual(.empty, h.fork_choice.blocks.items(.parent_payload_status)[h.fork_choice.blockIndex(empty.root).?]);
    for ([_]Block{ full, empty }) |block| {
        errdefer std.debug.print("Gloas branch root {x}\n", .{block.root});
        const replayed = try h.regen.getState(io, try block.stateRoot(), false, null);
        defer replayed.unref();
        try testing.expectEqual(.gloas, replayed.get().state.forkSeq());
        try testing.expectEqualSlices(u8, try block.state.get().state.hashTreeRoot(), try replayed.get().state.hashTreeRoot());
    }
}
