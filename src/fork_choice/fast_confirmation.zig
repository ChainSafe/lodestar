//! Spec fast confirmation rule: https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/specs/phase0/fast-confirmation.md
//! with the Bellatrix and Gloas modifications, and the exact committee weight of
//! https://github.com/ethereum/consensus-specs/pull/5670 and
//! https://github.com/ethereum/consensus-specs/pull/5788.
//!
//! `FastConfirmation` holds the spec `FastConfirmationStore` fields and reads the fork
//! choice `Store` passed to each call. A run sums each balance source's votes once per
//! distinct vote and folds them up the block array, so `is_one_confirmed` reads a block's
//! attestation score instead of scanning every validator. Committee membership is one
//! byte per validator per epoch, built once per run from the head state's shuffling, and
//! committee weights are prefix sums per range end slot.

const std = @import("std");
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const store_mod = @import("store.zig");
const distinct_votes_mod = @import("distinct_votes.zig");
const Store = store_mod.Store;
const BalanceSource = store_mod.BalanceSource;
const BlockIndex = store_mod.BlockIndex;
const Checkpoint = store_mod.Checkpoint;
const ForkChoiceNode = store_mod.ForkChoiceNode;
const Root = store_mod.Root;
const Slot = store_mod.Slot;
const Epoch = store_mod.Epoch;
const ValidatorIndex = store_mod.ValidatorIndex;
const NO_BLOCK = store_mod.NO_BLOCK;
const NO_VOTE = distinct_votes_mod.NO_VOTE;
const computeEpochAtSlot = store_mod.computeEpochAtSlot;
const computeStartSlotAtEpoch = store_mod.computeStartSlotAtEpoch;
const computeSlotsSinceEpochStart = store_mod.computeSlotsSinceEpochStart;

/// Spec `FastConfirmationStore` without its `store` field.
pub const FastConfirmation = struct {
    confirmed_root: Root,
    previous_epoch_observed_justified_checkpoint: Checkpoint,
    current_epoch_observed_justified_checkpoint: Checkpoint,
    previous_epoch_greatest_unrealized_checkpoint: Checkpoint,
    previous_slot_head: Root,
    current_slot_head: Root,

    /// Spec `get_fast_confirmation_store`.
    pub fn init(store: *const Store) FastConfirmation {
        const finalized = store.finalized_checkpoint;
        return .{
            .confirmed_root = finalized.root,
            .previous_epoch_observed_justified_checkpoint = finalized,
            .current_epoch_observed_justified_checkpoint = finalized,
            .previous_epoch_greatest_unrealized_checkpoint = finalized,
            .previous_slot_head = finalized.root,
            .current_slot_head = finalized.root,
        };
    }

    /// Spec `on_fast_confirmation`. Call once per slot, after the past slots' attestations.
    /// A failed call may already have updated the slot's variables, so do not call again in
    /// the same slot: a second update would shift them again. On failure `confirmed_root`
    /// falls back to the finalized root.
    pub fn onFastConfirmation(self: *FastConfirmation, store: *Store) !void {
        errdefer self.confirmed_root = store.finalized_checkpoint.root;
        try self.updateFastConfirmationVariables(store);
        var arena = std.heap.ArenaAllocator.init(store.allocator);
        defer arena.deinit();
        var run = try Run.init(store, self, arena.allocator());
        self.confirmed_root = try run.getLatestConfirmed();
    }

    /// Spec `update_fast_confirmation_variables`.
    fn updateFastConfirmationVariables(self: *FastConfirmation, store: *Store) !void {
        const head_root = store.blockRoot((try store.getHead()).block);
        self.previous_slot_head = self.current_slot_head;
        self.current_slot_head = head_root;
        const current_slot = store.currentSlot();
        if (isStartSlotAtEpoch(current_slot + 1)) {
            self.previous_epoch_greatest_unrealized_checkpoint = store.unrealized_justified_checkpoint;
        }
        if (isStartSlotAtEpoch(current_slot)) {
            self.previous_epoch_observed_justified_checkpoint = self.current_epoch_observed_justified_checkpoint;
            self.current_epoch_observed_justified_checkpoint = self.previous_epoch_greatest_unrealized_checkpoint;
        }
    }

    /// Spec `get_safe_execution_block_hash`; null once `prune` dropped the confirmed block.
    pub fn safeExecutionBlockHash(self: *const FastConfirmation, store: *const Store) ?Root {
        const block = store.blockIndex(self.confirmed_root) orelse return null;
        if (store.blocks.items(.fork)[block].gte(.gloas)) return store.blocks.items(.bid_parent_block_hash)[block];
        return store.blocks.items(.payload_block_hash)[block];
    }
};

const SourceKind = enum { previous, current };

const Source = struct {
    balances: BalanceSource,
    /// Spec `get_total_active_balance`.
    total_active: u64,
    /// Spec `compute_proposer_score`.
    proposer_score: u64,
    /// Spec `get_attestation_score` of each block's node, by block index.
    block_score: []u64,
};

const NOT_ASSIGNED: u8 = std.math.maxInt(u8);

/// The slot within `epoch` each validator is assigned to, `NOT_ASSIGNED` otherwise.
const CommitteeEpoch = struct {
    epoch: Epoch,
    slot_offsets: []const u8,
};

/// A range that covers no full epoch spans at most two epochs and is shorter than this.
const MAX_PARTIAL_RANGE_SLOTS = 2 * preset.SLOTS_PER_EPOCH;

/// `weights[i]`: active balance of `source`'s validators in the committees of
/// `[end_slot - i, end_slot]`. Without `spans_previous_epoch` only the slots of the end
/// slot's epoch are valid: the head state may not hold the shuffling of the epoch before.
const CommitteeWeights = struct {
    source: *const Source,
    end_slot: Slot,
    spans_previous_epoch: bool,
    weights: [MAX_PARTIAL_RANGE_SLOTS]u64,
};

/// One `on_fast_confirmation` run. The head and every input are fixed for its duration.
const Run = struct {
    store: *Store,
    fcr: *const FastConfirmation,
    allocator: Allocator,
    current_slot: Slot,
    current_epoch: Epoch,
    head: BlockIndex,
    sources: [2]?Source = .{ null, null },
    pulled_up: ?Source = null,
    honest_ffg_support: ?u64 = null,
    committee_epochs: std.ArrayList(CommitteeEpoch) = .empty,
    committee_weights: std.ArrayList(CommitteeWeights) = .empty,

    fn init(store: *Store, fcr: *const FastConfirmation, allocator: Allocator) !Run {
        return .{
            .store = store,
            .fcr = fcr,
            .allocator = allocator,
            .current_slot = store.currentSlot(),
            .current_epoch = store.currentEpoch(),
            .head = (try store.getHead()).block,
        };
    }

    // --- block helpers ----------------------------------------------------------------

    fn slotOf(self: *const Run, block: BlockIndex) Slot {
        return self.store.blockSlot(block);
    }

    /// Spec `get_block_epoch`.
    fn epochOf(self: *const Run, block: BlockIndex) Epoch {
        return computeEpochAtSlot(self.slotOf(block));
    }

    fn parentOf(self: *const Run, block: BlockIndex) BlockIndex {
        return self.store.blocks.items(.parent)[block];
    }

    fn unrealizedJustification(self: *const Run, block: BlockIndex) Checkpoint {
        return self.store.blocks.items(.unrealized_justified_checkpoint)[block];
    }

    /// Spec `get_voting_source`.
    fn votingSource(self: *const Run, block: BlockIndex) Checkpoint {
        if (self.current_epoch > self.epochOf(block)) return self.unrealizedJustification(block);
        return self.store.blocks.items(.justified_checkpoint)[block];
    }

    /// Spec `get_checkpoint_for_block`, compared against `checkpoint`.
    fn isCheckpointOf(self: *const Run, checkpoint: Checkpoint, block: BlockIndex, epoch: Epoch) bool {
        if (checkpoint.epoch != epoch) return false;
        const checkpoint_block = self.store.getCheckpointBlock(block, epoch);
        return std.mem.eql(u8, &self.store.blockRoot(checkpoint_block), &checkpoint.root);
    }

    /// Spec `get_current_target`.
    fn currentTarget(self: *const Run) Checkpoint {
        const block = self.store.getCheckpointBlock(self.head, self.current_epoch);
        return .{ .epoch = self.current_epoch, .root = self.store.blockRoot(block) };
    }

    /// Spec `is_ancestor` over block nodes.
    fn isAncestor(self: *const Run, block: BlockIndex, ancestor: BlockIndex) bool {
        return self.store.isAncestor(Store.pendingNode(block), Store.pendingNode(ancestor));
    }

    /// Spec `get_ancestor_roots`: from the child of `terminal` up to `block`, empty when
    /// `terminal` is not in the chain of `block`.
    fn ancestorRoots(self: *const Run, block: BlockIndex, terminal: BlockIndex) ![]const BlockIndex {
        var roots: std.ArrayList(BlockIndex) = .empty;
        const terminal_slot = self.slotOf(terminal);
        var current = block;
        while (self.slotOf(current) > terminal_slot) {
            try roots.append(self.allocator, current);
            current = self.parentOf(current);
            if (current == terminal) {
                std.mem.reverse(BlockIndex, roots.items);
                return roots.items;
            }
            if (current == NO_BLOCK) break;
        }
        return &.{};
    }

    // --- balance sources ----------------------------------------------------------------

    fn checkpointOf(self: *const Run, kind: SourceKind) Checkpoint {
        return switch (kind) {
            .previous => self.fcr.previous_epoch_observed_justified_checkpoint,
            .current => self.fcr.current_epoch_observed_justified_checkpoint,
        };
    }

    /// Spec `get_previous_balance_source` and `get_current_balance_source`.
    fn source(self: *Run, kind: SourceKind) !*const Source {
        const slot = &self.sources[@intFromEnum(kind)];
        if (slot.*) |*loaded| return loaded;
        const other = self.sources[1 - @intFromEnum(kind)];
        if (other != null and checkpointEql(self.checkpointOf(.previous), self.checkpointOf(.current))) {
            slot.* = other;
            return &slot.*.?;
        }
        const balances = try self.store.provider.checkpointBalanceSource(self.allocator, self.checkpointOf(kind));
        slot.* = self.newSource(balances, try self.blockScores(&balances));
        return &slot.*.?;
    }

    /// Spec `get_pulled_up_head_state`.
    fn pulledUpSource(self: *Run) !*const Source {
        if (self.pulled_up) |*loaded| return loaded;
        const balances = try self.store.provider.pulledUpBalanceSource(self.allocator, self.store.blockRoot(self.head), self.current_epoch);
        self.pulled_up = self.newSource(balances, &.{});
        return &self.pulled_up.?;
    }

    fn newSource(self: *const Run, balances: BalanceSource, block_score: []u64) Source {
        const totals = activeTotals(&balances);
        return .{
            .balances = balances,
            .total_active = totals.active,
            .proposer_score = totals.unslashed / preset.SLOTS_PER_EPOCH * self.store.config.chain.PROPOSER_SCORE_BOOST / 100,
            .block_score = block_score,
        };
    }

    /// Votes of active, unslashed, non-equivocating validators summed per distinct vote.
    fn voteWeights(self: *const Run, balances: *const BalanceSource) ![]u64 {
        const weights = try self.allocator.alloc(u64, self.store.distinct_votes.len());
        @memset(weights, 0);
        for (self.store.latest_votes.items, 0..) |target, validator| {
            if (target == NO_VOTE or self.store.isEquivocating(validator)) continue;
            weights[target] += unslashedWeight(balances, validator);
        }
        return weights;
    }

    /// Spec `get_attestation_score` for every block: a vote counts toward each ancestor of
    /// the block it supports, which a child-to-parent pass over the block array adds up.
    fn blockScores(self: *const Run, balances: *const BalanceSource) ![]u64 {
        const vote_weights = try self.voteWeights(balances);
        const scores = try self.allocator.alloc(u64, self.store.blocks.len);
        @memset(scores, 0);
        for (self.store.distinct_votes.messages.items, vote_weights) |message, weight| {
            if (weight == 0 or message.block == NO_BLOCK) continue;
            scores[message.block] += weight;
        }
        const parents = self.store.blocks.items(.parent);
        var i = scores.len;
        while (i > 0) {
            i -= 1;
            if (parents[i] != NO_BLOCK) scores[parents[i]] += scores[i];
        }
        return scores;
    }

    // --- committees -----------------------------------------------------------------------

    /// Spec `get_slot_committee` for every slot of `epoch`, from the head state.
    fn committeeEpoch(self: *Run, epoch: Epoch) ![]const u8 {
        for (self.committee_epochs.items) |entry| {
            if (entry.epoch == epoch) return entry.slot_offsets;
        }
        var offsets: std.ArrayList(u8) = .empty;
        var members: std.ArrayList(ValidatorIndex) = .empty;
        const head_root = self.store.blockRoot(self.head);
        const start_slot = computeStartSlotAtEpoch(epoch);
        for (0..preset.SLOTS_PER_EPOCH) |offset| {
            members.clearRetainingCapacity();
            try self.store.provider.slotCommitteeMembers(self.allocator, head_root, start_slot + offset, &members);
            for (members.items) |validator| {
                if (validator >= offsets.items.len) {
                    try offsets.appendNTimes(self.allocator, NOT_ASSIGNED, validator + 1 - offsets.items.len);
                }
                offsets.items[validator] = @intCast(offset);
            }
        }
        try self.committee_epochs.append(self.allocator, .{ .epoch = epoch, .slot_offsets = offsets.items });
        return offsets.items;
    }

    /// Whether `validator` sits in a committee of a slot in `[start_slot, end_slot]`.
    fn isInCommittees(self: *Run, validator: ValidatorIndex, start_slot: Slot, end_slot: Slot) !bool {
        var epoch = computeEpochAtSlot(start_slot);
        while (epoch <= computeEpochAtSlot(end_slot)) : (epoch += 1) {
            const offsets = try self.committeeEpoch(epoch);
            if (validator >= offsets.len or offsets[validator] == NOT_ASSIGNED) continue;
            const slot = computeStartSlotAtEpoch(epoch) + offsets[validator];
            if (slot >= start_slot and slot <= end_slot) return true;
        }
        return false;
    }

    /// Spec `compute_committee_weight_between_slots`.
    fn committeeWeightBetweenSlots(self: *Run, src: *const Source, start_slot: Slot, end_slot: Slot) !u64 {
        if (start_slot > end_slot) return 0;
        if (isFullValidatorSetCovered(start_slot, end_slot)) return src.total_active;
        std.debug.assert(end_slot - start_slot < MAX_PARTIAL_RANGE_SLOTS);
        const end_epoch = computeEpochAtSlot(end_slot);
        const spans_previous_epoch = computeEpochAtSlot(start_slot) < end_epoch;
        const cached = for (self.committee_weights.items) |*entry| {
            if (entry.source == src and entry.end_slot == end_slot) break entry;
        } else null;
        if (cached) |entry| {
            if (entry.spans_previous_epoch or !spans_previous_epoch) {
                return @max(preset.EFFECTIVE_BALANCE_INCREMENT, entry.weights[end_slot - start_slot]);
            }
        }
        const end_epoch_offsets = try self.committeeEpoch(end_epoch);
        const previous_epoch_offsets: []const u8 = if (spans_previous_epoch) try self.committeeEpoch(end_epoch - 1) else &.{};
        const entry = cached orelse try self.committee_weights.addOne(self.allocator);
        entry.* = .{
            .source = src,
            .end_slot = end_slot,
            .spans_previous_epoch = spans_previous_epoch,
            .weights = committeeWeights(&src.balances, end_slot, end_epoch_offsets, previous_epoch_offsets),
        };
        return @max(preset.EFFECTIVE_BALANCE_INCREMENT, entry.weights[end_slot - start_slot]);
    }

    // --- LMD-GHOST helpers ----------------------------------------------------------------

    /// Spec `get_node_support_between_slots`.
    fn nodeSupportBetweenSlots(self: *Run, balances: *const BalanceSource, node: ForkChoiceNode, start_slot: Slot, end_slot: Slot) !u64 {
        if (start_slot > end_slot) return 0;
        const node_id = store_mod.nodeId(node);
        const vote_nodes = self.store.distinct_votes.nodes.items;
        var support: u64 = 0;
        for (self.store.latest_votes.items, 0..) |target, validator| {
            if (target == NO_VOTE or vote_nodes[target] != node_id) continue;
            if (self.store.isEquivocating(validator)) continue;
            const weight = unslashedWeight(balances, validator);
            if (weight == 0) continue;
            if (try self.isInCommittees(validator, start_slot, end_slot)) support += weight;
        }
        return support;
    }

    /// Spec `get_equivocation_score`.
    fn equivocationScore(self: *Run, balances: *const BalanceSource, start_slot: Slot, end_slot: Slot) !u64 {
        if (start_slot > end_slot) return 0;
        var score: u64 = 0;
        var it = self.store.equivocating_indices.iterator(.{});
        while (it.next()) |validator| {
            if (validator >= balances.effective_balance_increments.len or !balances.active.isSet(validator)) continue;
            if (!try self.isInCommittees(validator, start_slot, end_slot)) continue;
            score += @as(u64, balances.effective_balance_increments[validator]) * preset.EFFECTIVE_BALANCE_INCREMENT;
        }
        return score;
    }

    /// Spec `compute_adversarial_weight`.
    fn computeAdversarialWeight(self: *Run, src: *const Source, start_slot: Slot, end_slot: Slot) !u64 {
        const maximum_weight = try self.committeeWeightBetweenSlots(src, start_slot, end_slot);
        const max_adversarial_weight = maximum_weight / 100 * self.store.config.chain.CONFIRMATION_BYZANTINE_THRESHOLD;
        return max_adversarial_weight -| try self.equivocationScore(&src.balances, start_slot, end_slot);
    }

    /// Spec `get_adversarial_weight`.
    fn adversarialWeight(self: *Run, src: *const Source, block: BlockIndex) !u64 {
        const block_epoch = self.epochOf(block);
        const start_slot = if (block_epoch > self.epochOf(self.parentOf(block)))
            computeStartSlotAtEpoch(block_epoch)
        else
            self.slotOf(block);
        return self.computeAdversarialWeight(src, start_slot, self.current_slot - 1);
    }

    /// Spec `compute_empty_slot_support_discount`, which `get_support_discount` returns.
    fn supportDiscount(self: *Run, src: *const Source, block: BlockIndex) !u64 {
        const parent = self.parentOf(block);
        const parent_slot = self.slotOf(parent);
        if (parent_slot + 1 == self.slotOf(block)) return 0;
        const parent_node = self.store.getAncestor(Store.pendingNode(block), parent_slot);
        const parent_support = try self.nodeSupportBetweenSlots(&src.balances, parent_node, parent_slot + 1, self.slotOf(block) - 1);
        const adversarial_weight = try self.computeAdversarialWeight(src, parent_slot + 1, self.slotOf(block) - 1);
        return parent_support -| adversarial_weight;
    }

    /// Spec `compute_safety_threshold`.
    fn computeSafetyThreshold(self: *Run, src: *const Source, block: BlockIndex) !u64 {
        const parent_slot = self.slotOf(self.parentOf(block));
        const maximum_support = try self.committeeWeightBetweenSlots(src, parent_slot + 1, self.current_slot - 1);
        const support_discount = try self.supportDiscount(src, block);
        const adversarial_weight = try self.adversarialWeight(src, block);
        if (support_discount > maximum_support) return error.SupportDiscountExceedsMaximumSupport;
        return (maximum_support + src.proposer_score + 2 * adversarial_weight - support_discount) / 2;
    }

    /// Spec `is_one_confirmed`, false for a block whose payload chain is not `VALID`.
    fn isOneConfirmed(self: *Run, kind: SourceKind, block: BlockIndex) !bool {
        if (self.current_slot == 0 or self.parentOf(block) == NO_BLOCK) return false;
        switch (try self.store.executionStatus(Store.pendingNode(block))) {
            .valid, .pre_merge => {},
            .syncing, .invalid => return false,
        }
        const src = try self.source(kind);
        return src.block_score[block] > try self.computeSafetyThreshold(src, block);
    }

    /// Spec `is_confirmed_chain_safe`.
    fn isConfirmedChainSafe(self: *Run, confirmed: BlockIndex) !bool {
        const observed = self.fcr.current_epoch_observed_justified_checkpoint;
        if (!self.isCheckpointOf(observed, confirmed, observed.epoch)) return false;
        const start_exclusive = if (observed.epoch + 1 >= self.current_epoch)
            self.store.blockIndex(observed.root) orelse return false
        else start: {
            const first = self.store.getAncestor(Store.pendingNode(confirmed), computeStartSlotAtEpoch(self.current_epoch - 1)).block;
            break :start if (self.epochOf(first) + 1 == self.current_epoch) self.parentOf(first) else first;
        };
        if (start_exclusive == NO_BLOCK) return false;
        for (try self.ancestorRoots(confirmed, start_exclusive)) |block| {
            if (!try self.isOneConfirmed(.previous, block)) return false;
        }
        return true;
    }

    // --- FFG helpers ----------------------------------------------------------------------

    /// Spec `get_current_target_score`: the pulled-up head state's votes summed per vote
    /// target, then each target's checkpoint compared once.
    fn currentTargetScore(self: *Run) !u64 {
        const src = try self.pulledUpSource();
        const target = self.currentTarget();
        const weights = try self.voteWeights(&src.balances);
        var score: u64 = 0;
        for (self.store.distinct_votes.messages.items, weights) |message, weight| {
            if (weight == 0 or message.block == NO_BLOCK) continue;
            if (self.isCheckpointOf(target, message.block, computeEpochAtSlot(message.slot))) score += weight;
        }
        return score;
    }

    /// Spec `compute_honest_ffg_support_for_current_target`.
    fn honestFfgSupport(self: *Run) !u64 {
        if (self.honest_ffg_support) |support| return support;
        const src = try self.pulledUpSource();
        const epoch_start = computeStartSlotAtEpoch(self.current_epoch);
        const ffg_support = try self.currentTargetScore();
        const ffg_weight_till_now = try self.committeeWeightBetweenSlots(src, epoch_start, self.current_slot -| 1);
        const remaining_ffg_weight = src.total_active - ffg_weight_till_now;
        const remaining_honest_ffg_weight = remaining_ffg_weight / 100 * (100 - self.store.config.chain.CONFIRMATION_BYZANTINE_THRESHOLD);
        const adversarial_weight = try self.computeAdversarialWeight(src, epoch_start, self.current_slot -| 1);
        const support = (ffg_support -| adversarial_weight) + remaining_honest_ffg_weight;
        self.honest_ffg_support = support;
        return support;
    }

    /// Spec `will_no_conflicting_checkpoint_be_justified`.
    fn willNoConflictingCheckpointBeJustified(self: *Run) !bool {
        if (checkpointEql(self.currentTarget(), self.store.unrealized_justified_checkpoint)) return true;
        const src = try self.pulledUpSource();
        return 3 * try self.honestFfgSupport() > src.total_active;
    }

    /// Spec `will_current_target_be_justified`.
    fn willCurrentTargetBeJustified(self: *Run) !bool {
        const src = try self.pulledUpSource();
        return 3 * try self.honestFfgSupport() >= 2 * src.total_active;
    }

    // --- confirmation ---------------------------------------------------------------------

    /// Spec `find_latest_confirmed_descendant`.
    fn findLatestConfirmedDescendant(self: *Run, latest_confirmed: BlockIndex) !BlockIndex {
        const is_epoch_start = isStartSlotAtEpoch(self.current_slot);
        const previous_head = self.store.blockIndex(self.fcr.previous_slot_head);
        var confirmed = latest_confirmed;

        const advance_previous_epoch = blk: {
            const previous = previous_head orelse break :blk false;
            if (self.epochOf(confirmed) + 1 != self.current_epoch) break :blk false;
            if (self.votingSource(previous).epoch + 2 < self.current_epoch) break :blk false;
            if (is_epoch_start) break :blk true;
            if (!try self.willNoConflictingCheckpointBeJustified()) break :blk false;
            break :blk self.unrealizedJustification(previous).epoch + 1 >= self.current_epoch or
                self.unrealizedJustification(self.head).epoch + 1 >= self.current_epoch;
        };
        if (advance_previous_epoch) {
            for (try self.ancestorRoots(self.head, confirmed)) |block| {
                if (self.epochOf(block) == self.current_epoch) break;
                if (!self.isAncestor(previous_head.?, block)) break;
                if (!try self.isOneConfirmed(.current, block)) break;
                confirmed = block;
            }
        }

        if (is_epoch_start or self.unrealizedJustification(self.head).epoch + 1 >= self.current_epoch) {
            var tentative = confirmed;
            for (try self.ancestorRoots(self.head, confirmed)) |block| {
                if (self.epochOf(block) > self.epochOf(tentative)) {
                    if (!try self.willCurrentTargetBeJustified()) break;
                }
                if (!try self.isOneConfirmed(.current, block)) break;
                tentative = block;
            }
            if (self.epochOf(tentative) == self.current_epoch or
                (self.votingSource(tentative).epoch + 2 >= self.current_epoch and
                    (is_epoch_start or try self.willNoConflictingCheckpointBeJustified())))
            {
                confirmed = tentative;
            }
        }
        return confirmed;
    }

    /// Spec `get_latest_confirmed`.
    fn getLatestConfirmed(self: *Run) !Root {
        const finalized = self.store.blockIndex(self.store.finalized_checkpoint.root) orelse return error.UnknownBlock;
        const is_epoch_start = isStartSlotAtEpoch(self.current_slot);
        var confirmed = self.store.blockIndex(self.fcr.confirmed_root) orelse finalized;
        if (self.epochOf(confirmed) + 1 < self.current_epoch or
            !self.isAncestor(self.head, confirmed) or
            (is_epoch_start and !try self.isConfirmedChainSafe(confirmed)))
        {
            confirmed = finalized;
        }

        const observed = self.fcr.current_epoch_observed_justified_checkpoint;
        if (self.store.blockIndex(observed.root)) |observed_block| {
            const observed_slot = self.slotOf(observed_block);
            if (is_epoch_start and
                computeEpochAtSlot(observed_slot) + 1 == self.current_epoch and
                checkpointEql(observed, self.unrealizedJustification(self.head)) and
                self.slotOf(confirmed) < observed_slot)
            {
                confirmed = observed_block;
            }
        }

        if (self.epochOf(confirmed) + 1 >= self.current_epoch) {
            confirmed = try self.findLatestConfirmedDescendant(confirmed);
        }
        return self.store.blockRoot(confirmed);
    }
};

/// Spec `is_start_slot_at_epoch`.
fn isStartSlotAtEpoch(slot: Slot) bool {
    return computeSlotsSinceEpochStart(slot) == 0;
}

fn checkpointEql(a: Checkpoint, b: Checkpoint) bool {
    return a.epoch == b.epoch and std.mem.eql(u8, &a.root, &b.root);
}

const ActiveTotals = struct {
    /// Spec `get_total_active_balance`.
    active: u64,
    /// Spec `get_total_balance` over the active, unslashed validators.
    unslashed: u64,
};

fn activeTotals(balances: *const BalanceSource) ActiveTotals {
    var active: u64 = 0;
    var unslashed: u64 = 0;
    var it = balances.active.iterator(.{});
    while (it.next()) |validator| {
        if (validator >= balances.effective_balance_increments.len) continue;
        const increments = balances.effective_balance_increments[validator];
        active += increments;
        if (!balances.slashed.isSet(validator)) unslashed += increments;
    }
    return .{
        .active = @max(preset.EFFECTIVE_BALANCE_INCREMENT, active * preset.EFFECTIVE_BALANCE_INCREMENT),
        .unslashed = @max(preset.EFFECTIVE_BALANCE_INCREMENT, unslashed * preset.EFFECTIVE_BALANCE_INCREMENT),
    };
}

/// Effective balance of an active, unslashed validator, zero otherwise.
fn unslashedWeight(balances: *const BalanceSource, validator: usize) u64 {
    if (validator >= balances.effective_balance_increments.len) return 0;
    if (!balances.active.isSet(validator) or balances.slashed.isSet(validator)) return 0;
    return @as(u64, balances.effective_balance_increments[validator]) * preset.EFFECTIVE_BALANCE_INCREMENT;
}

/// Spec `is_full_validator_set_covered`.
fn isFullValidatorSetCovered(start_slot: Slot, end_slot: Slot) bool {
    return computeEpochAtSlot(start_slot + preset.SLOTS_PER_EPOCH - 1) < computeEpochAtSlot(end_slot + 1);
}

/// Buckets each active validator's balance by how many slots before `end_slot` its latest
/// committee slot at or before `end_slot` is, then prefix-sums the buckets. A validator is
/// counted once even when it sits in a committee of both epochs.
fn committeeWeights(
    balances: *const BalanceSource,
    end_slot: Slot,
    end_epoch_offsets: []const u8,
    previous_epoch_offsets: []const u8,
) [MAX_PARTIAL_RANGE_SLOTS]u64 {
    const end_offset = computeSlotsSinceEpochStart(end_slot);
    var weights = std.mem.zeroes([MAX_PARTIAL_RANGE_SLOTS]u64);
    var it = balances.active.iterator(.{});
    while (it.next()) |validator| {
        if (validator >= balances.effective_balance_increments.len) continue;
        const end_epoch_offset = if (validator < end_epoch_offsets.len) end_epoch_offsets[validator] else NOT_ASSIGNED;
        const previous_epoch_offset = if (validator < previous_epoch_offsets.len) previous_epoch_offsets[validator] else NOT_ASSIGNED;
        const distance = if (end_epoch_offset != NOT_ASSIGNED and end_epoch_offset <= end_offset)
            end_offset - end_epoch_offset
        else if (previous_epoch_offset != NOT_ASSIGNED)
            end_offset + preset.SLOTS_PER_EPOCH - previous_epoch_offset
        else
            continue;
        weights[distance] += @as(u64, balances.effective_balance_increments[validator]) * preset.EFFECTIVE_BALANCE_INCREMENT;
    }
    for (1..weights.len) |i| weights[i] += weights[i - 1];
    return weights;
}

test "committeeWeights" {
    const allocator = std.testing.allocator;
    const epoch = preset.SLOTS_PER_EPOCH;
    const increment = preset.EFFECTIVE_BALANCE_INCREMENT;
    var increments = [_]u16{ 1, 2, 4, 8, 16 };
    var active = try std.DynamicBitSetUnmanaged.initFull(allocator, increments.len);
    defer active.deinit(allocator);
    var slashed = try std.DynamicBitSetUnmanaged.initEmpty(allocator, increments.len);
    defer slashed.deinit(allocator);
    active.unset(3);
    slashed.set(4);
    const balances: BalanceSource = .{ .effective_balance_increments = &increments, .active = active, .slashed = slashed };

    // Validator 0 sits in both epochs, 3 is inactive, 4 is slashed and still counts.
    const previous_epoch_offsets = [_]u8{ epoch - 1, epoch - 2, NOT_ASSIGNED, epoch - 1, 0 };
    const end_epoch_offsets = [_]u8{ 0, 1, 1, 0 };
    const weights = committeeWeights(&balances, epoch + 1, &end_epoch_offsets, &previous_epoch_offsets);

    try std.testing.expectEqual(@as(u64, 6) * increment, weights[0]);
    try std.testing.expectEqual(@as(u64, 7) * increment, weights[1]);
    try std.testing.expectEqual(@as(u64, 7) * increment, weights[2]);
    try std.testing.expectEqual(@as(u64, 7) * increment, weights[epoch]);
    try std.testing.expectEqual(@as(u64, 23) * increment, weights[epoch + 1]);
    try std.testing.expectEqual(@as(u64, 23) * increment, weights[MAX_PARTIAL_RANGE_SLOTS - 1]);

    const ahead = committeeWeights(&balances, epoch, &end_epoch_offsets, &previous_epoch_offsets);
    try std.testing.expectEqual(@as(u64, 1) * increment, ahead[0]);
    try std.testing.expectEqual(@as(u64, 1) * increment, ahead[1]);
    try std.testing.expectEqual(@as(u64, 3) * increment, ahead[2]);
    try std.testing.expectEqual(@as(u64, 19) * increment, ahead[epoch]);

    const totals = activeTotals(&balances);
    try std.testing.expectEqual(@as(u64, 23) * increment, totals.active);
    try std.testing.expectEqual(@as(u64, 7) * increment, totals.unslashed);

    try std.testing.expect(isFullValidatorSetCovered(epoch, 2 * epoch - 1));
    try std.testing.expect(!isFullValidatorSetCovered(1, 2 * epoch - 2));
}
