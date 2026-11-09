const std = @import("std");
const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const ssz = @import("ssz");
const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;
const TestCachedBeaconState = state_transition.test_utils.TestCachedBeaconState;
const AnyBeaconBlock = @import("fork_types").AnyBeaconBlock;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const preset = @import("preset").preset;
const store_mod = @import("store.zig");
const Store = store_mod.Store;
const Checkpoint = store_mod.Checkpoint;
const JustifiedBalances = store_mod.JustifiedBalances;
const StateProvider = store_mod.StateProvider;
const NO_BLOCK = store_mod.NO_BLOCK;
const vote_targets_mod = @import("vote_targets.zig");

const validator_count = 64;

const Provider = struct {
    fn justifiedBalances(_: *anyopaque, allocator: std.mem.Allocator, _: Checkpoint) anyerror!JustifiedBalances {
        const increments = try allocator.alloc(u16, validator_count);
        errdefer allocator.free(increments);
        @memset(increments, 32);
        var active = try std.DynamicBitSetUnmanaged.initFull(allocator, validator_count);
        errdefer active.deinit(allocator);
        return .{ .effective_balance_increments = increments, .active_unslashed = active };
    }

    fn slotCommitteeMembers(_: *anyopaque, _: std.mem.Allocator, _: store_mod.Root, _: store_mod.Slot, _: *std.ArrayList(store_mod.ValidatorIndex)) anyerror!void {}

    const vtable: StateProvider.VTable = .{
        .justifiedBalances = justifiedBalances,
        .slotCommitteeMembers = slotCommitteeMembers,
    };

    var instance: u8 = 0;

    fn stateProvider() StateProvider {
        return .{ .ctx = &instance, .vtable = &vtable };
    }
};

const Chain = struct {
    allocator: std.mem.Allocator,
    pool: Node.Pool,
    test_state: TestCachedBeaconState,
    anchor_block: ct.electra.BeaconBlock.Type,
    anchor_root: [32]u8,
    store: Store,
    states: std.ArrayList(*CachedBeaconState),
    blocks: std.ArrayList(*ct.electra.SignedBeaconBlock.Type),

    fn init(self: *Chain, allocator: std.mem.Allocator) !void {
        self.allocator = allocator;
        self.pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 400_000 });
        errdefer self.pool.deinit();
        self.test_state = try TestCachedBeaconState.init(allocator, &self.pool, validator_count);
        errdefer self.test_state.deinit();
        const cached_state = self.test_state.cached_state;
        // Make the state's latest block header describe the synthetic anchor block, so
        // children of the anchor pass `process_block_header`.
        self.anchor_block = ct.electra.BeaconBlock.default_value;
        self.anchor_block.slot = try cached_state.state.slot();
        var header = ct.phase0.BeaconBlockHeader.default_value;
        header.slot = self.anchor_block.slot;
        try ct.electra.BeaconBlockBody.hashTreeRoot(allocator, &self.anchor_block.body, &header.body_root);
        try cached_state.state.setLatestBlockHeader(&header);
        self.anchor_block.state_root = (try cached_state.state.hashTreeRoot()).*;
        const block: AnyBeaconBlock = .{ .full_electra = &self.anchor_block };
        try block.hashTreeRoot(allocator, &self.anchor_root);
        self.states = .empty;
        self.blocks = .empty;
        self.store = try Store.init(allocator, cached_state.config, cached_state, block, .valid, Provider.stateProvider());
    }

    fn deinit(self: *Chain) void {
        self.store.deinit();
        for (self.states.items) |state| {
            state.deinit();
            self.allocator.destroy(state);
        }
        self.states.deinit(self.allocator);
        for (self.blocks.items) |block| {
            ct.electra.SignedBeaconBlock.deinit(self.allocator, block);
            self.allocator.destroy(block);
        }
        self.blocks.deinit(self.allocator);
        self.test_state.deinit();
        self.pool.deinit();
    }

    fn anchorState(self: *Chain) *CachedBeaconState {
        return self.test_state.cached_state;
    }

    /// A valid empty block on `parent_state`; `graffiti` distinguishes siblings.
    fn addBlock(self: *Chain, parent_state: *CachedBeaconState, parent_root: [32]u8, graffiti: u8) !struct { root: [32]u8, state: *CachedBeaconState } {
        const allocator = self.allocator;
        const signed = try allocator.create(ct.electra.SignedBeaconBlock.Type);
        errdefer allocator.destroy(signed);
        signed.* = ct.electra.SignedBeaconBlock.default_value;
        const slot = try parent_state.state.slot() + 1;
        signed.message.slot = slot;
        signed.message.proposer_index = try parent_state.epoch_cache.getBeaconProposer(slot);
        signed.message.parent_root = parent_root;
        signed.message.body.graffiti[0] = graffiti;
        signed.message.body.execution_payload.timestamp = (try parent_state.state.genesisTime()) + slot * parent_state.config.chain.SECONDS_PER_SLOT;
        const epoch = store_mod.computeEpochAtSlot(slot);
        signed.message.body.execution_payload.prev_randao = (try state_transition.getRandaoMix(.electra, parent_state.state.castToFork(.electra), epoch)).*;

        const post_state = try state_transition.stateTransition(allocator, testing.io, parent_state, .{ .full_electra = signed }, .{
            .verify_signatures = false,
            .verify_proposer = false,
            .verify_state_root = false,
            .transfer_cache = false,
        }, null);
        errdefer {
            post_state.deinit();
            allocator.destroy(post_state);
        }
        // `process_block_header` zeroes the header's state root, so the block's own state
        // root can be filled in after the transition and still match the next slot's header.
        signed.message.state_root = (try post_state.state.hashTreeRoot()).*;
        const block: AnyBeaconBlock = .{ .full_electra = &signed.message };
        var root: [32]u8 = undefined;
        try block.hashTreeRoot(allocator, &root);
        try self.store.onBlock(block, root, post_state, .valid);
        try self.states.append(allocator, post_state);
        try self.blocks.append(allocator, signed);
        return .{ .root = root, .state = post_state };
    }

    fn tickToSlot(self: *Chain, slot: u64) !void {
        try self.store.onTick(self.store.timing.timeAtSlotMs(slot));
    }
};

fn indexedAttestation(indices: []u64, slot: u64, root: [32]u8, target: Checkpoint) ct.electra.IndexedAttestation.Type {
    var attestation = ct.electra.IndexedAttestation.default_value;
    attestation.attesting_indices = .initBuffer(indices);
    attestation.attesting_indices.items.len = indices.len;
    attestation.data = .{
        .slot = slot,
        .index = 0,
        .beacon_block_root = root,
        .source = .{ .epoch = 0, .root = @splat(0) },
        .target = target,
    };
    return attestation;
}

test "anchor store: head is the anchor and time starts at the anchor slot" {
    var chain: Chain = undefined;
    try chain.init(testing.allocator);
    defer chain.deinit();
    const store = &chain.store;
    const anchor_slot = chain.anchor_block.slot;

    try testing.expectEqual(anchor_slot, store.currentSlot());
    const head = try store.getHead();
    try testing.expectEqualSlices(u8, &chain.anchor_root, &store.blockRoot(head.block));
    try testing.expectEqual(store_mod.PayloadStatus.pending, head.payload_status);
    try testing.expectEqual(@as(u64, validator_count * 32 * preset.EFFECTIVE_BALANCE_INCREMENT), store.justified_total_balance);

    try chain.tickToSlot(anchor_slot + 1);
    try testing.expectEqual(anchor_slot + 1, store.currentSlot());
    try testing.expectEqual(@as(u64, 0), store.timeIntoSlotMs());
    try testing.expectError(error.PreGenesisTime, store.onTick(0));

    const heads = try store.viableHeads(testing.allocator);
    defer testing.allocator.free(heads);
    try testing.expectEqual(@as(usize, 1), heads.len);
    try testing.expectEqual(@as(u64, 0), heads[0].weight);
}

test "blocks, votes, equivocations and pruning on a two-branch chain" {
    var chain: Chain = undefined;
    try chain.init(testing.allocator);
    defer chain.deinit();
    const store = &chain.store;
    const anchor_slot = chain.anchor_block.slot;
    const anchor = chain.anchorState();

    // Blocks from the future are rejected before any state work.
    {
        var future = ct.electra.BeaconBlock.default_value;
        future.slot = anchor_slot + 1;
        future.parent_root = chain.anchor_root;
        const block: AnyBeaconBlock = .{ .full_electra = &future };
        try testing.expectError(error.FutureBlock, store.validateBlock(block, @splat(1)));
        var orphan = ct.electra.BeaconBlock.default_value;
        orphan.slot = anchor_slot;
        const orphan_block: AnyBeaconBlock = .{ .full_electra = &orphan };
        try testing.expectError(error.UnknownParent, store.validateBlock(orphan_block, @splat(2)));
    }

    try chain.tickToSlot(anchor_slot + 1);
    const a = try chain.addBlock(anchor, chain.anchor_root, 1);
    const a_index = store.blockIndex(a.root).?;
    // Timely first block of the slot: proposer boost and head.
    try testing.expectEqualSlices(u8, &a.root, &store.proposer_boost_root);
    try testing.expectEqual(a_index, (try store.getHead()).block);

    const a2 = try chain.addBlock(anchor, chain.anchor_root, 2);
    const a2_index = store.blockIndex(a2.root).?;
    try testing.expectEqual(a_index, (try store.getHead()).block);
    try testing.expectEqual(store.proposerScore(), try store.getWeight(Store.pendingNode(a_index)));
    try testing.expectEqual(@as(u64, 0), try store.getWeight(Store.pendingNode(a2_index)));

    // Attestations only count from the slot after their own.
    const vote_slot = anchor_slot + 1;
    const target: Checkpoint = .{ .epoch = store_mod.computeEpochAtSlot(vote_slot), .root = a2.root };
    var indices = [_]u64{0};
    var vote = indexedAttestation(&indices, vote_slot, a2.root, target);
    try testing.expectError(error.AttestationNotYetPast, store.validateOnAttestation(&vote.data, false));

    try chain.tickToSlot(anchor_slot + 2);
    // Boost gone, no votes: ties break on the lexicographically higher root.
    const higher = if (std.mem.order(u8, &a.root, &a2.root) == .gt) a_index else a2_index;
    try testing.expectEqual(higher, (try store.getHead()).block);

    const b = try chain.addBlock(a.state, a.root, 3);
    const b_index = store.blockIndex(b.root).?;
    try testing.expectEqual(a_index, store.getAncestor(Store.pendingNode(b_index), anchor_slot + 1).block);
    try testing.expectEqual(@as(u32, 0), store.getAncestor(Store.pendingNode(b_index), anchor_slot).block);
    try testing.expect(store.isAncestor(Store.pendingNode(b_index), Store.pendingNode(a_index)));
    try testing.expect(!store.isAncestor(Store.pendingNode(b_index), Store.pendingNode(a2_index)));
    try testing.expect(!store.isAncestor(Store.pendingNode(a2_index), Store.pendingNode(b_index)));

    // Validator 0 votes for the sibling branch once the boost on `b` has worn off.
    try chain.tickToSlot(anchor_slot + 3);
    try store.onAttestation(.{ .electra = &vote }, false);
    try testing.expectEqual(a2_index, (try store.getHead()).block);
    try testing.expectEqual(@as(u64, 32 * preset.EFFECTIVE_BALANCE_INCREMENT), try store.getWeight(Store.pendingNode(a2_index)));

    // A second vote in the same epoch does not replace the latest message.
    var same_epoch = indexedAttestation(&indices, vote_slot, a.root, .{ .epoch = target.epoch, .root = a.root });
    try store.onAttestation(.{ .electra = &same_epoch }, false);
    try testing.expectEqual(a2_index, store.latestMessage(0).?.block);

    // Equivocation removes the vote.
    var slashing = ct.electra.AttesterSlashing.default_value;
    slashing.attestation_1 = vote;
    slashing.attestation_2 = same_epoch;
    try store.onAttesterSlashing(.{ .electra = &slashing });
    try testing.expect(store.isEquivocating(0));
    const tie_head = if (higher == a_index) b_index else a2_index;
    try testing.expectEqual(tie_head, (try store.getHead()).block);
    try testing.expectEqual(@as(u64, 0), try store.getWeight(Store.pendingNode(a2_index)));
    var not_slashable = ct.electra.AttesterSlashing.default_value;
    not_slashable.attestation_1 = vote;
    not_slashable.attestation_2 = vote;
    try testing.expectError(error.NotSlashableAttestationData, store.onAttesterSlashing(.{ .electra = &not_slashable }));

    // Pruning at the anchor is a no-op; finalizing `a` drops the anchor and the sibling.
    try testing.expectEqual(@as(usize, 0), try store.prune());
    store.finalized_checkpoint = .{ .epoch = target.epoch, .root = a.root };
    store.justified_checkpoint = store.finalized_checkpoint;
    try testing.expectEqual(@as(usize, 2), try store.prune());
    try testing.expectEqual(@as(usize, 2), store.blockCount());
    try testing.expectEqual(@as(?u32, 0), store.blockIndex(a.root));
    try testing.expectEqual(@as(?u32, 1), store.blockIndex(b.root));
    try testing.expectEqual(@as(?u32, null), store.blockIndex(a2.root));
    try testing.expectEqual(NO_BLOCK, store.blocks.items(.parent)[0]);
    try testing.expectEqual(@as(u32, 0), store.blocks.items(.parent)[1]);
    try testing.expectEqual(NO_BLOCK, store.latestMessage(0).?.block);
    try testing.expectEqual(vote_slot, store.latestMessage(0).?.slot);
    try testing.expectEqual(@as(u32, 1), (try store.getHead()).block);
}

test "summary-only chain: blocks are viable and the tip is the head" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    const zero: [32]u8 = @splat(0);
    var anchor_root: [32]u8 = zero;
    anchor_root[31] = 1;
    const genesis: Checkpoint = .{ .epoch = 0, .root = anchor_root };
    var store = try Store.initFromSummary(allocator, config, 0, .{
        .root = anchor_root,
        .parent_root = zero,
        .slot = 0,
        .proposer_index = 0,
        .state_root = zero,
        .fork = .electra,
        .justified_checkpoint = genesis,
        .finalized_checkpoint = genesis,
        .unrealized_justified_checkpoint = genesis,
        .unrealized_finalized_checkpoint = genesis,
        .execution_status = .pre_merge,
    }, Provider.stateProvider());
    defer store.deinit();
    try store.onTick(store.timing.timeAtSlotMs(64));
    var parent_root = anchor_root;
    for (1..64) |slot| {
        var root: [32]u8 = anchor_root;
        std.mem.writeInt(u64, root[0..8], slot, .little);
        try store.onBlockSummary(.{
            .root = root,
            .parent_root = parent_root,
            .slot = slot,
            .proposer_index = 0,
            .state_root = root,
            .fork = .electra,
            .justified_checkpoint = genesis,
            .finalized_checkpoint = genesis,
            .unrealized_justified_checkpoint = .{ .epoch = @min(slot / preset.SLOTS_PER_EPOCH, 1), .root = anchor_root },
            .unrealized_finalized_checkpoint = genesis,
            .execution_status = .pre_merge,
        });
        parent_root = root;
    }
    try testing.expectEqual(@as(usize, 64), store.blockCount());
    // Blocks from epoch 1 pulled the unrealized justification up into the store.
    try testing.expectEqual(@as(u64, 1), store.justified_checkpoint.epoch);
    const head = try store.getHead();
    try testing.expectEqual(@as(u64, 63), store.blockSlot(head.block));
}

/// Balances that change with the checkpoint epoch: increments vary, some validators
/// drop to zero and return, and the list alternately shrinks and grows.
const VaryingProvider = struct {
    fn justifiedBalances(_: *anyopaque, allocator: std.mem.Allocator, checkpoint: Checkpoint) anyerror!JustifiedBalances {
        const count = validator_count - 4 + (checkpoint.epoch % 2) * 8;
        const increments = try allocator.alloc(u16, count);
        errdefer allocator.free(increments);
        for (increments, 0..) |*increment, i| increment.* = 32 - @as(u16, @intFromBool(i % 8 == checkpoint.epoch % 8));
        var active = try std.DynamicBitSetUnmanaged.initFull(allocator, count);
        errdefer active.deinit(allocator);
        for (0..count) |i| {
            if ((i + checkpoint.epoch) % 13 == 0) active.unset(i);
        }
        return .{ .effective_balance_increments = increments, .active_unslashed = active };
    }

    const vtable: StateProvider.VTable = .{
        .justifiedBalances = justifiedBalances,
        .slotCommitteeMembers = Provider.slotCommitteeMembers,
    };
};

/// Compares the incremental totals with a full recount, then puts the incremental state
/// back so a wrong count keeps showing in later rounds.
fn expectVoteWeightsMatchRecount(store: *Store) !void {
    const cache = &store.head_cache;
    _ = try store.getHead();
    try testing.expectEqual(@as(usize, 0), cache.changed_count);
    const weights = try testing.allocator.dupe(u64, cache.vote_weight.items);
    defer testing.allocator.free(weights);
    // A run with no changes leaves the totals as they are.
    cache.dirty = true;
    _ = try store.getHead();
    try testing.expectEqualSlices(u64, weights, cache.vote_weight.items);
    const applied = try testing.allocator.dupe(u32, cache.applied_votes.items);
    defer testing.allocator.free(applied);
    cache.rescan_votes = true;
    cache.dirty = true;
    _ = try store.getHead();
    try testing.expectEqualSlices(u64, cache.vote_weight.items, weights);
    // A vote on a pruned block may keep its target id where a recount records none;
    // both count nowhere, so compare where each applied vote lands.
    const nodes = store.vote_targets.nodes.items;
    for (cache.applied_votes.items, applied) |recounted, incremental| {
        try testing.expectEqual(nodes[recounted], nodes[incremental]);
    }
    @memcpy(cache.vote_weight.items, weights);
    @memcpy(cache.applied_votes.items, applied);
}

test "vote weights: incremental updates match a full recount" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    const zero: [32]u8 = @splat(0);
    var anchor_root: [32]u8 = zero;
    anchor_root[31] = 1;
    const genesis: Checkpoint = .{ .epoch = 0, .root = anchor_root };
    var store = try Store.initFromSummary(allocator, config, 0, .{
        .root = anchor_root,
        .parent_root = zero,
        .slot = 0,
        .proposer_index = 0,
        .state_root = zero,
        .fork = .electra,
        .justified_checkpoint = genesis,
        .finalized_checkpoint = genesis,
        .unrealized_justified_checkpoint = genesis,
        .unrealized_finalized_checkpoint = genesis,
        .execution_status = .pre_merge,
    }, .{ .ctx = &Provider.instance, .vtable = &VaryingProvider.vtable });
    defer store.deinit();
    try store.onTick(store.timing.timeAtSlotMs(7 * preset.SLOTS_PER_EPOCH));

    var prng = std.Random.DefaultPrng.init(0x5eed);
    const random = prng.random();
    var tips = [2][32]u8{ anchor_root, anchor_root };
    var branches: usize = 2;
    for (0..6) |epoch| {
        // Each round grows the branches by an epoch, so new nodes appear between runs.
        for (0..preset.SLOTS_PER_EPOCH) |offset| {
            const slot = epoch * preset.SLOTS_PER_EPOCH + offset + 1;
            for (tips[0..branches], 0..) |*tip, branch| {
                var root: [32]u8 = anchor_root;
                std.mem.writeInt(u64, root[0..8], slot, .little);
                root[8] = @intCast(branch + 1);
                try store.onBlockSummary(.{
                    .root = root,
                    .parent_root = tip.*,
                    .slot = slot,
                    .proposer_index = 0,
                    .state_root = root,
                    .fork = .electra,
                    .justified_checkpoint = genesis,
                    .finalized_checkpoint = genesis,
                    .unrealized_justified_checkpoint = genesis,
                    .unrealized_finalized_checkpoint = genesis,
                    .execution_status = .pre_merge,
                });
                tip.* = root;
            }
        }
        const vote_slot = (epoch + 1) * preset.SLOTS_PER_EPOCH - 1;
        for (0..validator_count) |validator| {
            // A quarter of the validators vote per round, below the full recount threshold.
            if (random.uintLessThan(u8, 4) != 0) continue;
            var block = store.blockIndex(tips[random.uintLessThan(usize, branches)]).?;
            for (0..1 + random.uintLessThan(usize, preset.SLOTS_PER_EPOCH)) |_| block = store.blocks.items(.parent)[block];
            const target_block = store.getCheckpointBlock(block, epoch);
            const target: Checkpoint = .{ .epoch = epoch, .root = store.blockRoot(target_block) };
            var indices = [_]u64{validator};
            var vote = indexedAttestation(&indices, vote_slot, store.blockRoot(block), target);
            try store.onAttestation(.{ .electra = &vote }, true);
            if (random.uintLessThan(u8, 16) == 0) {
                var slashing = ct.electra.AttesterSlashing.default_value;
                slashing.attestation_1 = vote;
                slashing.attestation_2 = vote;
                slashing.attestation_2.data.slot -= 1;
                try store.onAttesterSlashing(.{ .electra = &slashing });
            }
        }
        try expectVoteWeightsMatchRecount(&store);

        // A new justified checkpoint installs different balances.
        const justified_root = if (branches == 2) anchor_root else store.blockRoot(0);
        try store.updateCheckpoints(.{ .epoch = epoch + 1, .root = justified_root }, store.finalized_checkpoint);
        // Below the full recount threshold, so the balance diff itself is checked.
        try testing.expect(store.head_cache.changed_count * 2 <= store.head_cache.applied_votes.items.len);
        try testing.expectEqual(store.head_cache.changed_votes.count(), store.head_cache.changed_count);
        try expectVoteWeightsMatchRecount(&store);

        // Finalizing the first branch at epoch 1 drops the second branch and its votes.
        if (epoch == 2) {
            var finalized_root: [32]u8 = anchor_root;
            std.mem.writeInt(u64, finalized_root[0..8], preset.SLOTS_PER_EPOCH, .little);
            finalized_root[8] = 1;
            const finalized: Checkpoint = .{ .epoch = 1, .root = finalized_root };
            try store.updateCheckpoints(.{ .epoch = epoch + 2, .root = finalized_root }, finalized);
            try testing.expect(try store.prune() > 0);
            branches = 1;
            try expectVoteWeightsMatchRecount(&store);

            // A vote identical to one on a kept block reuses its renumbered target.
            const kept_vote = for (0..validator_count) |validator| {
                const message = store.latestMessage(validator) orelse continue;
                if (message.block != NO_BLOCK) break message;
            } else unreachable;
            const target_epoch = store_mod.computeEpochAtSlot(kept_vote.slot);
            const target_root = store.blockRoot(store.getCheckpointBlock(kept_vote.block, target_epoch));
            var repeat_indices = [_]u64{0};
            var repeat = indexedAttestation(&repeat_indices, kept_vote.slot, store.blockRoot(kept_vote.block), .{ .epoch = target_epoch, .root = target_root });
            const targets_before = store.vote_targets.len();
            try store.onAttestation(.{ .electra = &repeat }, true);
            try testing.expectEqual(targets_before, store.vote_targets.len());
        }
    }
}

test "vote targets: identical votes share an entry and the table stays bounded" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    const zero: [32]u8 = @splat(0);
    var anchor_root: [32]u8 = zero;
    anchor_root[31] = 1;
    const genesis: Checkpoint = .{ .epoch = 0, .root = anchor_root };
    var store = try Store.initFromSummary(allocator, config, 0, .{
        .root = anchor_root,
        .parent_root = zero,
        .slot = 0,
        .proposer_index = 0,
        .state_root = zero,
        .fork = .electra,
        .justified_checkpoint = genesis,
        .finalized_checkpoint = genesis,
        .unrealized_justified_checkpoint = genesis,
        .unrealized_finalized_checkpoint = genesis,
        .execution_status = .pre_merge,
    }, Provider.stateProvider());
    defer store.deinit();
    const last_slot = 5000;
    try store.onTick(store.timing.timeAtSlotMs(last_slot + 1));
    // Two sibling blocks, so a vote that lands on the wrong target lands on the wrong node.
    var roots: [2][32]u8 = undefined;
    for (&roots, 1..) |*root, slot| {
        root.* = anchor_root;
        root[0] = @intCast(slot);
        try store.onBlockSummary(.{
            .root = root.*,
            .parent_root = anchor_root,
            .slot = slot,
            .proposer_index = 0,
            .state_root = root.*,
            .fork = .electra,
            .justified_checkpoint = genesis,
            .finalized_checkpoint = genesis,
            .unrealized_justified_checkpoint = genesis,
            .unrealized_finalized_checkpoint = genesis,
            .execution_status = .pre_merge,
        });
    }

    const before = store.vote_targets.len();
    for (0..2) |validator| {
        var indices = [_]u64{validator};
        var vote = indexedAttestation(&indices, 3, roots[0], .{ .epoch = 0, .root = anchor_root });
        try store.onAttestation(.{ .electra = &vote }, true);
    }
    try testing.expectEqual(before + 1, store.vote_targets.len());

    // Without finality `prune` never runs, yet every slot adds a target.
    for (3..last_slot + 1) |slot| {
        const epoch = slot / preset.SLOTS_PER_EPOCH;
        const block = (slot / validator_count) % 2;
        const target_root = if (epoch == 0) anchor_root else roots[block];
        var indices = [_]u64{slot % validator_count};
        var vote = indexedAttestation(&indices, slot, roots[block], .{ .epoch = epoch, .root = target_root });
        try store.onAttestation(.{ .electra = &vote }, true);
        // Few enough validators change between checks to stay on the incremental path.
        if (slot % 16 == 0) try expectVoteWeightsMatchRecount(&store);
    }
    // About 5000 targets were added, so the table only stays this small by compacting.
    try testing.expect(store.vote_targets.len() < vote_targets_mod.MIN_COMPACT_AT);
    for (0..validator_count) |validator| {
        const newest = last_slot - (last_slot + validator_count - validator) % validator_count;
        const message = store.latestMessage(validator).?;
        try testing.expectEqual(@as(u64, newest), message.slot);
        try testing.expectEqual(store.blockIndex(roots[(newest / validator_count) % 2]).?, message.block);
    }
    try expectVoteWeightsMatchRecount(&store);
}

const ExecutionStatus = store_mod.ExecutionStatus;
const ZERO: [32]u8 = @splat(0);

fn tagRoot(tag: u8) [32]u8 {
    var root = ZERO;
    root[0] = tag;
    root[31] = 1;
    return root;
}

/// Zero for `tag == 0`, the pre-merge "no payload" hash.
fn tagHash(tag: u8) [32]u8 {
    if (tag == 0) return ZERO;
    var hash = ZERO;
    hash[0] = tag;
    hash[30] = 1;
    return hash;
}

const OptimisticBlock = struct {
    tag: u8,
    parent: u8,
    slot: u64,
    fork: @import("config").ForkSeq = .electra,
    bid_parent: u8 = 0,
    status: ExecutionStatus = .syncing,
};

fn optimisticSummary(block: OptimisticBlock) store_mod.BlockSummary {
    const genesis: Checkpoint = .{ .epoch = 0, .root = tagRoot(1) };
    return .{
        .root = tagRoot(block.tag),
        .parent_root = if (block.parent == 0) ZERO else tagRoot(block.parent),
        .slot = block.slot,
        .proposer_index = 0,
        .state_root = ZERO,
        .fork = block.fork,
        .justified_checkpoint = genesis,
        .finalized_checkpoint = genesis,
        .unrealized_justified_checkpoint = genesis,
        .unrealized_finalized_checkpoint = genesis,
        .payload_block_hash = if (block.status == .pre_merge) ZERO else tagHash(block.tag),
        .bid_parent_block_hash = tagHash(block.bid_parent),
        .execution_status = block.status,
    };
}

fn pendingOf(store: *Store, tag: u8) store_mod.ForkChoiceNode {
    return Store.pendingNode(store.blockIndex(tagRoot(tag)).?);
}

fn fullOf(store: *Store, tag: u8) store_mod.ForkChoiceNode {
    return .{ .block = store.blockIndex(tagRoot(tag)).?, .payload_status = .full };
}

const FailingProvider = struct {
    fn justifiedBalances(_: *anyopaque, _: std.mem.Allocator, _: Checkpoint) anyerror!store_mod.JustifiedBalances {
        return error.StateUnavailable;
    }

    const vtable: StateProvider.VTable = .{
        .justifiedBalances = justifiedBalances,
        .slotCommitteeMembers = Provider.vtable.slotCommitteeMembers,
    };
};

test "anchor store: a provider failure during init releases everything once" {
    const anchor = optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .status = .pre_merge });
    try testing.expectError(error.StateUnavailable, Store.initFromSummary(
        testing.allocator,
        &@import("config").minimal.config,
        0,
        anchor,
        .{ .ctx = &Provider.instance, .vtable = &FailingProvider.vtable },
    ));
}

test "optimistic sync: valid walks down to the merge boundary, invalid removes the branch" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    // Anchor 0x01 has no payload. Branch B (0x20, 0x30, 0x31) wins the root tie-break over
    // branch C (0x20, 0x21, 0x22) at the fork below 0x20.
    var store = try Store.initFromSummary(allocator, config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .status = .pre_merge }), Provider.stateProvider());
    defer store.deinit();
    try store.onTick(store.timing.timeAtSlotMs(8));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x30, .parent = 0x20, .slot = 2 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x31, .parent = 0x30, .slot = 3 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x21, .parent = 0x20, .slot = 2 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x22, .parent = 0x21, .slot = 3 }));

    try testing.expectEqual(pendingOf(&store, 0x31), try store.getHead());
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x31)));
    try testing.expect(try store.isOptimistic(pendingOf(&store, 0x31)));
    try testing.expectEqual(ExecutionStatus.pre_merge, try store.executionStatus(pendingOf(&store, 1)));

    try store.onPayloadValid(tagHash(0x30));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x31)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x21)));
    try testing.expectEqual(ExecutionStatus.pre_merge, try store.executionStatus(pendingOf(&store, 1)));
    try testing.expect(!try store.isOptimistic(pendingOf(&store, 0x30)));

    // The engine rejects a child of 0x31 with latest valid hash 0x30: only 0x31 is invalidated.
    try store.onPayloadInvalid(tagRoot(0x31), tagHash(0x31), tagHash(0x30));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(pendingOf(&store, 0x31)));
    try testing.expectEqual(pendingOf(&store, 0x30), try store.getHead());
    const heads = try store.viableHeads(allocator);
    defer allocator.free(heads);
    try testing.expectEqual(@as(usize, 2), heads.len);
    try testing.expectError(error.ParentPayloadInvalid, store.onBlockSummary(optimisticSummary(.{ .tag = 0x32, .parent = 0x31, .slot = 4 })));

    try store.onPayloadInvalid(tagRoot(0x22), tagHash(0x22), tagHash(0x20));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(pendingOf(&store, 0x21)));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(pendingOf(&store, 0x22)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x20)));
    const only = try store.viableHeads(allocator);
    defer allocator.free(only);
    try testing.expectEqual(@as(usize, 1), only.len);
    try testing.expectEqual(tagRoot(0x30), only[0].root);

    try testing.expectError(error.PayloadInvalidToValid, store.onPayloadValid(tagHash(0x22)));
    try testing.expectError(error.PayloadValidToInvalid, store.onPayloadInvalid(tagRoot(0x30), tagHash(0x30), tagHash(0x20)));
    try testing.expectError(error.UnknownLatestValidHash, store.onPayloadInvalid(tagRoot(0x30), tagHash(0x30), tagHash(0x77)));
    try testing.expectError(error.UnknownPayload, store.onPayloadValid(tagHash(0x77)));
    try store.onPayloadInvalid(tagRoot(0x30), tagHash(0x30), null);
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(pendingOf(&store, 0x30), try store.getHead());
}

test "optimistic sync: a zero latest valid hash invalidates through the merge block" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    var store = try Store.initFromSummary(allocator, config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .status = .pre_merge }), Provider.stateProvider());
    defer store.deinit();
    try store.onTick(store.timing.timeAtSlotMs(8));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x30, .parent = 0x20, .slot = 2 }));
    try testing.expectEqual(pendingOf(&store, 0x30), try store.getHead());

    try store.onPayloadInvalid(tagRoot(0x30), tagHash(0x30), ZERO);
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(pendingOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(pendingOf(&store, 1), try store.getHead());
    const heads = try store.viableHeads(allocator);
    defer allocator.free(heads);
    try testing.expectEqual(@as(usize, 1), heads.len);
    try testing.expectEqual(tagRoot(1), heads[0].root);

    // A justified checkpoint standing on an invalidated payload has no head.
    store.justified_checkpoint.root = tagRoot(0x20);
    store.head_cache.dirty = true;
    try testing.expectError(error.InvalidJustifiedPayload, store.getHead());
}

test "optimistic sync: Gloas empty links skip the parent's own payload" {
    const allocator = testing.allocator;
    const config_mod = @import("config");
    const chain_config = config_mod.mainnet.chain_config.merge(.{
        .ALTAIR_FORK_EPOCH = 0,
        .BELLATRIX_FORK_EPOCH = 0,
        .CAPELLA_FORK_EPOCH = 0,
        .DENEB_FORK_EPOCH = 0,
        .ELECTRA_FORK_EPOCH = 0,
        .FULU_FORK_EPOCH = 0,
        .GLOAS_FORK_EPOCH = 0,
    });
    const config = config_mod.BeaconConfig.init(chain_config, config_mod.mainnet.genesis_validators_root);
    var store = try Store.initFromSummary(allocator, &config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .fork = .gloas }), Provider.stateProvider());
    defer store.deinit();
    try store.onExecutionPayloadEnvelope(tagRoot(1), .valid, null);
    try store.onTick(store.timing.timeAtSlotMs(8));
    // 0x20 extends the anchor's payload (full link); 0x21 extends the anchor's payload
    // too, hanging off 0x20's empty node, so 0x20's own payload is not below it.
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1, .fork = .gloas, .bid_parent = 1 }));
    try store.onExecutionPayloadEnvelope(tagRoot(0x20), .syncing, null);
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x21, .parent = 0x20, .slot = 2, .fork = .gloas, .bid_parent = 1 }));
    try store.onExecutionPayloadEnvelope(tagRoot(0x21), .syncing, null);

    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(fullOf(&store, 1)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(fullOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x21)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(fullOf(&store, 0x21)));
    try testing.expect(!try store.isOptimistic(pendingOf(&store, 0x21)));

    // Invalidating 0x21's payload down to the anchor's leaves 0x20's payload alone.
    try store.onPayloadInvalid(tagRoot(0x21), tagHash(0x21), tagHash(1));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(fullOf(&store, 0x21)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x21)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(fullOf(&store, 0x20)));
    try testing.expectError(error.ParentPayloadInvalid, store.onBlockSummary(optimisticSummary(.{ .tag = 0x22, .parent = 0x21, .slot = 3, .fork = .gloas, .bid_parent = 0x21 })));

    try store.onPayloadValid(tagHash(0x20));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(fullOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.invalid, try store.executionStatus(fullOf(&store, 0x21)));
}

test "optimistic sync: a valid import and a valid envelope validate the payloads below them" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    var store = try Store.initFromSummary(allocator, config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .status = .pre_merge }), Provider.stateProvider());
    defer store.deinit();
    try store.onTick(store.timing.timeAtSlotMs(8));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x30, .parent = 0x20, .slot = 2 }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x31, .parent = 0x30, .slot = 3, .status = .valid }));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x20)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x31)));
    try testing.expectEqual(ExecutionStatus.pre_merge, try store.executionStatus(pendingOf(&store, 1)));

    const config_mod = @import("config");
    const chain_config = config_mod.mainnet.chain_config.merge(.{
        .ALTAIR_FORK_EPOCH = 0,
        .BELLATRIX_FORK_EPOCH = 0,
        .CAPELLA_FORK_EPOCH = 0,
        .DENEB_FORK_EPOCH = 0,
        .ELECTRA_FORK_EPOCH = 0,
        .FULU_FORK_EPOCH = 0,
        .GLOAS_FORK_EPOCH = 0,
    });
    const gloas_config = config_mod.BeaconConfig.init(chain_config, config_mod.mainnet.genesis_validators_root);
    var gloas = try Store.initFromSummary(allocator, &gloas_config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .fork = .gloas }), Provider.stateProvider());
    defer gloas.deinit();
    try gloas.onExecutionPayloadEnvelope(tagRoot(1), .syncing, null);
    try gloas.onTick(gloas.timing.timeAtSlotMs(8));
    try gloas.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1, .fork = .gloas, .bid_parent = 1 }));
    try gloas.onExecutionPayloadEnvelope(tagRoot(0x20), .valid, null);
    try testing.expectEqual(ExecutionStatus.valid, try gloas.executionStatus(fullOf(&gloas, 1)));
    try testing.expectEqual(ExecutionStatus.valid, try gloas.executionStatus(fullOf(&gloas, 0x20)));
    // A later syncing verdict never downgrades a validated payload.
    try gloas.onExecutionPayloadEnvelope(tagRoot(0x20), .syncing, null);
    try testing.expectEqual(ExecutionStatus.valid, try gloas.executionStatus(fullOf(&gloas, 0x20)));
}

test "queued votes: a vote for the current slot lands on the next tick" {
    const allocator = testing.allocator;
    const config = &@import("config").mainnet.config;
    var store = try Store.initFromSummary(allocator, config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .status = .pre_merge }), Provider.stateProvider());
    defer store.deinit();
    const target: Checkpoint = .{ .epoch = 0, .root = tagRoot(1) };
    // Blocks from a past slot, so no proposer boost: ties break on the higher root.
    try store.onTick(store.timing.timeAtSlotMs(2));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1, .status = .pre_merge }));
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x30, .parent = 1, .slot = 1, .status = .pre_merge }));
    const low = store.blockIndex(tagRoot(0x20)).?;
    const high = store.blockIndex(tagRoot(0x30)).?;
    try testing.expectEqual(high, (try store.getHead()).block);

    // Validator 0 votes for the lower root in its own slot: queued, not counted.
    var v0 = [_]u64{0};
    var vote_low = indexedAttestation(&v0, 2, tagRoot(0x20), target);
    try store.onAttestation(.{ .electra = &vote_low }, false);
    try testing.expectEqual(@as(?store_mod.LatestMessage, null), store.latestMessage(0));
    try testing.expectEqual(@as(usize, 1), store.queuedVoteCount());
    try testing.expectEqual(high, (try store.getHead()).block);
    // A second vote in the same slot does not replace the first.
    var vote_high = indexedAttestation(&v0, 2, tagRoot(0x30), target);
    try store.onAttestation(.{ .electra = &vote_high }, false);

    try store.onTick(store.timing.timeAtSlotMs(3));
    try testing.expectEqual(@as(usize, 0), store.queuedVoteCount());
    try testing.expectEqual(low, store.latestMessage(0).?.block);
    try testing.expectEqual(low, (try store.getHead()).block);

    // A validator slashed after queueing is skipped at the drain.
    var v1 = [_]u64{1};
    var vote_1 = indexedAttestation(&v1, 3, tagRoot(0x30), target);
    try store.onAttestation(.{ .electra = &vote_1 }, false);
    try store.equivocating_indices.resize(allocator, 2, false);
    store.equivocating_indices.set(1);
    try store.onTick(store.timing.timeAtSlotMs(4));
    try testing.expectEqual(@as(?store_mod.LatestMessage, null), store.latestMessage(1));

    // A vote for the next slot waits one more tick.
    var v2 = [_]u64{2};
    var vote_2 = indexedAttestation(&v2, 5, tagRoot(0x30), target);
    try store.onAttestation(.{ .electra = &vote_2 }, false);
    try store.onTick(store.timing.timeAtSlotMs(5));
    try testing.expectEqual(@as(?store_mod.LatestMessage, null), store.latestMessage(2));
    try testing.expectEqual(@as(usize, 1), store.queuedVoteCount());
    try store.onTick(store.timing.timeAtSlotMs(6));
    try testing.expectEqual(high, store.latestMessage(2).?.block);

    // A queued vote for a block pruned before the drain lands as a slot-only message.
    var v3 = [_]u64{3};
    var vote_3 = indexedAttestation(&v3, 6, tagRoot(0x20), target);
    try store.onAttestation(.{ .electra = &vote_3 }, false);
    store.finalized_checkpoint = .{ .epoch = 0, .root = tagRoot(0x30) };
    store.justified_checkpoint = store.finalized_checkpoint;
    try testing.expectEqual(@as(usize, 2), try store.prune());
    try store.onTick(store.timing.timeAtSlotMs(7));
    try testing.expectEqual(NO_BLOCK, store.latestMessage(3).?.block);
    try testing.expectEqual(@as(u64, 6), store.latestMessage(3).?.slot);
}

test "optimistic sync: pruning keeps the status a Gloas root inherited from dropped ancestors" {
    const allocator = testing.allocator;
    const config_mod = @import("config");
    const chain_config = config_mod.mainnet.chain_config.merge(.{
        .ALTAIR_FORK_EPOCH = 0,
        .BELLATRIX_FORK_EPOCH = 0,
        .CAPELLA_FORK_EPOCH = 0,
        .DENEB_FORK_EPOCH = 0,
        .ELECTRA_FORK_EPOCH = 0,
        .FULU_FORK_EPOCH = 0,
        .GLOAS_FORK_EPOCH = 0,
    });
    const config = config_mod.BeaconConfig.init(chain_config, config_mod.mainnet.genesis_validators_root);
    var store = try Store.initFromSummary(allocator, &config, 0, optimisticSummary(.{ .tag = 1, .parent = 0, .slot = 0, .fork = .gloas }), Provider.stateProvider());
    defer store.deinit();
    try store.onExecutionPayloadEnvelope(tagRoot(1), .valid, null);
    try store.onTick(store.timing.timeAtSlotMs(8));
    // 0x20 and 0x30 extend the previous payload (full links); 0x30's payload is syncing.
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x20, .parent = 1, .slot = 1, .fork = .gloas, .bid_parent = 1 }));
    try store.onExecutionPayloadEnvelope(tagRoot(0x20), .syncing, null);
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x30, .parent = 0x20, .slot = 2, .fork = .gloas, .bid_parent = 0x20 }));
    try store.onExecutionPayloadEnvelope(tagRoot(0x30), .syncing, null);
    // 0x40 hangs off 0x30's empty node, so it stands on 0x20's syncing payload.
    try store.onBlockSummary(optimisticSummary(.{ .tag = 0x40, .parent = 0x30, .slot = 3, .fork = .gloas, .bid_parent = 0x20 }));
    try store.onExecutionPayloadEnvelope(tagRoot(0x40), .syncing, null);
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x40)));

    store.finalized_checkpoint = .{ .epoch = 0, .root = tagRoot(0x30) };
    store.justified_checkpoint = store.finalized_checkpoint;
    try testing.expectEqual(@as(usize, 2), try store.prune());
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(pendingOf(&store, 0x40)));
    try testing.expect(try store.isOptimistic(pendingOf(&store, 0x40)));

    // Validating 0x40's payload validates the dropped ancestors' too.
    try store.onPayloadValid(tagHash(0x40));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(pendingOf(&store, 0x30)));
    try testing.expectEqual(ExecutionStatus.valid, try store.executionStatus(fullOf(&store, 0x40)));
    try testing.expectEqual(ExecutionStatus.syncing, try store.executionStatus(fullOf(&store, 0x30)));
}
