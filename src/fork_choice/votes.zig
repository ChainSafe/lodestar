//! Vote accounting: every validator's latest message and the weight those messages put
//! on each node, which is spec `get_attestation_score` before `head.zig` sums it up the
//! tree.
//!
//! The per-node weights persist between head computations. `update` recounts only the
//! validators whose message or weight changed since the last one. New balances move only
//! the weights that changed, and `remap` renumbers the counted nodes in place, so neither
//! recounts every vote.

const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const preset = @import("preset").preset;
const store_mod = @import("store.zig");
const LatestMessage = store_mod.LatestMessage;
const BlockIndex = store_mod.BlockIndex;
const NO_BLOCK = store_mod.NO_BLOCK;
const NodeId = store_mod.NodeId;
const NO_NODE = store_mod.NO_NODE;
const NODES_PER_BLOCK = store_mod.NODES_PER_BLOCK;
const Slot = store_mod.Slot;
const ValidatorIndex = store_mod.ValidatorIndex;
const computeEpochAtSlot = store_mod.computeEpochAtSlot;
const vote_targets = @import("vote_targets.zig");
const VoteTargets = vote_targets.VoteTargets;
const TargetId = vote_targets.TargetId;
const NO_TARGET = vote_targets.NO_TARGET;

/// A caller that caches results derived from `vote_weight` must invalidate them after
/// `drain`, `slash`, `setIncrements`, `markChanged` and `remap`, and after a `record`
/// that returns true.
pub const Votes = struct {
    vote_targets: VoteTargets,
    /// Dense by validator index: each validator's latest message as an id into `vote_targets`.
    latest_votes: std.ArrayList(TargetId) = .empty,
    /// Votes whose slot is not yet past, one per validator like `latest_votes`; applied by
    /// `drain` once their slot is past. The spec rejects such attestations and expects the
    /// caller to retry; gossip delivers them in their own slot.
    queued_votes: std.ArrayList(TargetId) = .empty,
    /// The validators with a queued vote. Few validators attest per slot, so `drain`
    /// visits these instead of every entry of `queued_votes`.
    queued_validators: std.DynamicBitSetUnmanaged = .{},
    /// Set bits in `queued_validators`, so a `drain` with nothing queued skips scanning it.
    queued_count: usize = 0,
    equivocating_indices: std.DynamicBitSetUnmanaged = .{},
    /// Per validator: the weight `get_attestation_score` sums, in effective balance
    /// increments. Zero for validators inactive or slashed in the justified state.
    vote_increments: []u16 = &.{},
    /// Per node: the weight of the latest messages that land on it, kept across updates.
    vote_weight: std.ArrayList(u64) = .empty,
    /// Per validator: the vote target counted in `vote_weight`, `NO_TARGET` if none.
    applied_votes: std.ArrayList(TargetId) = .empty,
    /// Validators below `applied_votes.items.len` whose message or weight changed since the last update.
    changed_votes: std.DynamicBitSetUnmanaged = .{},
    /// Set bits in `changed_votes`, so an update with no changes skips scanning it.
    changed_count: usize = 0,
    /// Validators whose message or weight was re-checked, plus validators counted for the
    /// first time, summed over every update. A full recount adds only the pending changes.
    vote_changes_total: u64 = 0,
    rescan_votes: bool = true,

    pub fn init(allocator: Allocator) !Votes {
        return .{ .vote_targets = try VoteTargets.init(allocator) };
    }

    pub fn deinit(self: *Votes, allocator: Allocator) void {
        self.vote_targets.deinit(allocator);
        self.latest_votes.deinit(allocator);
        self.queued_votes.deinit(allocator);
        self.queued_validators.deinit(allocator);
        self.equivocating_indices.deinit(allocator);
        allocator.free(self.vote_increments);
        self.vote_weight.deinit(allocator);
        self.applied_votes.deinit(allocator);
        self.changed_votes.deinit(allocator);
        self.* = undefined;
    }

    /// Spec `update_latest_messages` for the validators of one attestation. `node` is
    /// where `message` counts (spec `get_supported_node`), and `message.slot` is in the
    /// attestation's target epoch. With `queue` the votes wait for `drain`. Returns whether
    /// a latest message changed.
    pub fn record(
        self: *Votes,
        allocator: Allocator,
        config: *const BeaconConfig,
        attesting_indices: []const ValidatorIndex,
        message: LatestMessage,
        node: NodeId,
        queue: bool,
    ) !bool {
        try ensureValidatorSlots(allocator, &self.latest_votes, attesting_indices);
        if (queue) {
            try ensureValidatorSlots(allocator, &self.queued_votes, attesting_indices);
            try self.queued_validators.resize(allocator, self.queued_votes.items.len, false);
        }
        if (self.vote_targets.needsCompaction()) {
            try self.vote_targets.compact(allocator, &.{ self.latest_votes.items, self.queued_votes.items, self.applied_votes.items });
        }
        const id = try self.vote_targets.getOrInsert(allocator, message, node);
        if (queue) {
            self.queueVotes(attesting_indices, id, message);
            return false;
        }
        var any_changed = false;
        for (attesting_indices) |index| {
            if (self.apply(config, index, id, message)) any_changed = true;
        }
        return any_changed;
    }

    fn ensureValidatorSlots(allocator: Allocator, list: *std.ArrayList(TargetId), attesting_indices: []const ValidatorIndex) !void {
        var max_index: usize = 0;
        for (attesting_indices) |index| max_index = @max(max_index, index);
        if (max_index >= list.items.len) {
            try list.appendNTimes(allocator, NO_TARGET, max_index + 1 - list.items.len);
        }
    }

    /// The replacement rule of spec `update_latest_messages` for one validator: a later
    /// target epoch before Gloas, a later slot from Gloas on.
    fn apply(self: *Votes, config: *const BeaconConfig, index: ValidatorIndex, id: TargetId, message: LatestMessage) bool {
        if (self.isEquivocating(index)) return false;
        const current_id = &self.latest_votes.items[index];
        const current = self.vote_targets.messages.items[current_id.*];
        const newer = current_id.* == NO_TARGET or
            (if (config.forkSeq(message.slot).gte(.gloas)) message.slot > current.slot else computeEpochAtSlot(message.slot) > computeEpochAtSlot(current.slot));
        if (!newer) return false;
        current_id.* = id;
        self.markChanged(index);
        return true;
    }

    /// Holds a vote until its slot is past. The first vote of a slot wins, as applying
    /// them in order would, and a vote for a later slot replaces an earlier one.
    fn queueVotes(self: *Votes, attesting_indices: []const ValidatorIndex, id: TargetId, message: LatestMessage) void {
        const messages = self.vote_targets.messages.items;
        for (attesting_indices) |index| {
            if (self.isEquivocating(index)) continue;
            const queued = &self.queued_votes.items[index];
            if (queued.* == NO_TARGET) {
                self.queued_validators.set(index);
                self.queued_count += 1;
                queued.* = id;
            } else if (message.slot > messages[queued.*].slot) {
                queued.* = id;
            }
        }
    }

    /// Applies the queued votes whose slot is before `current_slot`.
    pub fn drain(self: *Votes, config: *const BeaconConfig, current_slot: Slot) void {
        const queued = self.queued_votes.items;
        std.debug.assert(queued.len <= self.latest_votes.items.len);
        var validators = self.queued_validators.iterator(.{});
        // Bounded by the count, so the scan skips the empty words after the last queued validator.
        for (0..self.queued_count) |_| {
            const index = validators.next().?;
            const id = &queued[index];
            std.debug.assert(id.* != NO_TARGET);
            const message = self.vote_targets.messages.items[id.*];
            if (message.slot >= current_slot) continue;
            _ = self.apply(config, index, id.*, message);
            id.* = NO_TARGET;
            self.queued_validators.unset(index);
            self.queued_count -= 1;
        }
    }

    pub fn latestMessage(self: *const Votes, validator_index: ValidatorIndex) ?LatestMessage {
        if (validator_index >= self.latest_votes.items.len) return null;
        const id = self.latest_votes.items[validator_index];
        return if (id == NO_TARGET) null else self.vote_targets.messages.items[id];
    }

    /// Marks the validators in both lists as equivocating. Each list is sorted ascending.
    pub fn slash(self: *Votes, allocator: Allocator, indices_1: []const ValidatorIndex, indices_2: []const ValidatorIndex) !void {
        var max_index: usize = 0;
        for (indices_1) |index| max_index = @max(max_index, index);
        if (max_index >= self.equivocating_indices.bit_length) {
            try self.equivocating_indices.resize(allocator, max_index + 1, false);
        }
        var i: usize = 0;
        var j: usize = 0;
        while (i < indices_1.len and j < indices_2.len) {
            if (indices_1[i] == indices_2[j]) {
                self.equivocating_indices.set(indices_1[i]);
                self.markChanged(indices_1[i]);
                i += 1;
                j += 1;
            } else if (indices_1[i] < indices_2[j]) {
                i += 1;
            } else {
                j += 1;
            }
        }
    }

    pub fn isEquivocating(self: *const Votes, validator_index: ValidatorIndex) bool {
        return validator_index < self.equivocating_indices.bit_length and self.equivocating_indices.isSet(validator_index);
    }

    /// Validators past the end of `applied_votes` are counted as new on the next update.
    pub fn markChanged(self: *Votes, validator_index: usize) void {
        if (validator_index < self.changed_votes.bit_length and !self.changed_votes.isSet(validator_index)) {
            self.changed_votes.set(validator_index);
            self.changed_count += 1;
        }
    }

    /// Installs new per-validator weights and takes ownership of `increments`. The counted
    /// votes move to the new weights, and a validator whose weight changed is marked, so
    /// the next update re-checks whether its vote counts at all.
    pub fn setIncrements(self: *Votes, allocator: Allocator, increments: []u16) void {
        self.applyBalanceChange(self.vote_increments, increments);
        allocator.free(self.vote_increments);
        self.vote_increments = increments;
    }

    fn applyBalanceChange(self: *Votes, old: []const u16, new: []const u16) void {
        if (self.rescan_votes) return;
        const validator_count = self.applied_votes.items.len;
        const shared = @min(validator_count, old.len, new.len);
        // Few balances change per epoch, so whole equal chunks are skipped.
        const chunk = 64;
        var start: usize = 0;
        while (start < shared) : (start += chunk) {
            const end = @min(start + chunk, shared);
            if (std.mem.eql(u16, old[start..end], new[start..end])) continue;
            for (start..end) |validator_index| self.moveVoteWeight(validator_index, old[validator_index], new[validator_index]);
        }
        for (shared..validator_count) |validator_index| {
            const old_increment = if (validator_index < old.len) old[validator_index] else 0;
            const new_increment = if (validator_index < new.len) new[validator_index] else 0;
            self.moveVoteWeight(validator_index, old_increment, new_increment);
        }
    }

    fn moveVoteWeight(self: *Votes, validator_index: usize, old_increment: u64, new_increment: u64) void {
        if (old_increment == new_increment) return;
        const node = self.vote_targets.nodes.items[self.applied_votes.items[validator_index]];
        if (node != NO_NODE) {
            self.vote_weight.items[node] -= old_increment * preset.EFFECTIVE_BALANCE_INCREMENT;
            self.vote_weight.items[node] += new_increment * preset.EFFECTIVE_BALANCE_INCREMENT;
        }
        self.markChanged(validator_index);
    }

    /// Carries the votes over a `prune` that moved block `b` to `block_remap[b]`,
    /// `NO_BLOCK` when dropped, leaving `kept` blocks; the weight on dropped blocks goes
    /// with them. `update` must have run for the block count before the prune.
    pub fn remap(self: *Votes, block_remap: []const BlockIndex, kept: usize) void {
        std.debug.assert(!self.rescan_votes);
        std.debug.assert(self.vote_weight.items.len == block_remap.len * NODES_PER_BLOCK);
        // Votes hold target ids, so renumbering the target table carries every vote over.
        self.vote_targets.remap(block_remap);
        const node_weight = self.vote_weight.items;
        for (block_remap, 0..) |target, block| {
            if (target == NO_BLOCK) continue;
            std.mem.copyForwards(u64, node_weight[target * NODES_PER_BLOCK ..][0..NODES_PER_BLOCK], node_weight[block * NODES_PER_BLOCK ..][0..NODES_PER_BLOCK]);
        }
        self.vote_weight.shrinkRetainingCapacity(kept * NODES_PER_BLOCK);
    }

    /// Brings `vote_weight` in line with the latest messages, for `node_count` nodes. Every
    /// allocation happens before the first write, so a failure leaves the counts consistent.
    pub fn update(self: *Votes, allocator: Allocator, node_count: usize) !void {
        const validator_count = self.latest_votes.items.len;
        const target_nodes = self.vote_targets.nodes.items;
        std.debug.assert(self.rescan_votes or (node_count >= self.vote_weight.items.len and validator_count >= self.applied_votes.items.len));
        try self.vote_weight.ensureTotalCapacity(allocator, node_count);
        try self.applied_votes.ensureTotalCapacity(allocator, validator_count);
        try self.changed_votes.resize(allocator, validator_count, false);
        self.vote_changes_total += self.changed_count + (validator_count -| self.applied_votes.items.len);
        // Moving a vote costs about twice counting one, so past half the validators a recount is cheaper.
        if (self.changed_count * 2 > self.applied_votes.items.len) self.rescan_votes = true;
        if (self.rescan_votes) {
            self.vote_weight.clearRetainingCapacity();
            self.applied_votes.clearRetainingCapacity();
            if (self.changed_count > 0) self.changed_votes.unsetAll();
            self.changed_count = 0;
            self.rescan_votes = false;
        }
        self.vote_weight.appendNTimesAssumeCapacity(0, node_count - self.vote_weight.items.len);
        const node_weight = self.vote_weight.items;

        const applied_count = self.applied_votes.items.len;
        var changed = self.changed_votes.iterator(.{});
        // The scan stops at the last changed validator.
        for (0..self.changed_count) |_| {
            const validator_index = changed.next().?;
            const applied = &self.applied_votes.items[validator_index];
            const counted = self.countedTarget(validator_index);
            if (counted == applied.*) continue;
            // `setIncrements` keeps the applied weight at the current balance.
            const message_weight = self.voteWeight(validator_index);
            const from = target_nodes[applied.*];
            const to = target_nodes[counted];
            if (from != NO_NODE) node_weight[from] -= message_weight;
            if (to != NO_NODE) node_weight[to] += message_weight;
            applied.* = counted;
        }
        if (self.changed_count > 0) self.changed_votes.unsetAll();
        self.changed_count = 0;

        const applied = self.applied_votes.addManyAsSliceAssumeCapacity(validator_count - applied_count);
        for (self.latest_votes.items[applied_count..], applied, applied_count..) |id, *counted, validator_index| {
            const message_weight = self.voteWeight(validator_index);
            const node = target_nodes[id];
            const counts = message_weight != 0 and node != NO_NODE and !self.isEquivocating(validator_index);
            counted.* = if (counts) id else NO_TARGET;
            if (counts) node_weight[node] += message_weight;
        }
    }

    /// Spec `get_attestation_score`: the latest message of an active, unslashed,
    /// non-equivocating validator counts on `get_supported_node`, which `vote_targets`
    /// resolved per target.
    fn countedTarget(self: *const Votes, validator_index: usize) TargetId {
        const id = self.latest_votes.items[validator_index];
        if (self.vote_targets.nodes.items[id] == NO_NODE) return NO_TARGET;
        if (self.voteWeight(validator_index) == 0) return NO_TARGET;
        if (self.isEquivocating(validator_index)) return NO_TARGET;
        return id;
    }

    fn voteWeight(self: *const Votes, validator_index: usize) u64 {
        if (validator_index >= self.vote_increments.len) return 0;
        return @as(u64, self.vote_increments[validator_index]) * preset.EFFECTIVE_BALANCE_INCREMENT;
    }
};
