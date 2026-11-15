//! Spec `get_head`, `get_weight` and `filter_node_tree` as array passes.
//!
//! The spec computes `get_weight` per node by scanning every latest message and
//! recurses through `filter_node_tree`. Here each latest message adds its weight to
//! the node it supports, and one reverse pass over the block table produces every
//! node's attestation score and viability at once: a message supports exactly the nodes on
//! the path from its supported node up to the justified root, which is the sum that
//! accumulates when each block hands its `pending` weight to the parent node it
//! hangs from. The proposer boost is the same kind of path, marked separately so
//! `get_attestation_score` stays available for the reorg helpers.
//!
//! Optimistic sync: each block stores the engine's verdict on its own payload; a node's
//! status is the worst verdict on the payloads it stands on, derived here in one forward
//! pass. A node derived invalid is treated as removed: no weight reaches its parent and
//! it is never viable.
//!
//! Node ids are `block * 3 + payload_status`.

const std = @import("std");
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const store_mod = @import("store.zig");
const Store = store_mod.Store;
const ForkChoiceNode = store_mod.ForkChoiceNode;
const PayloadStatus = store_mod.PayloadStatus;
const ExecutionStatus = store_mod.ExecutionStatus;
const BlockIndex = store_mod.BlockIndex;
const NO_BLOCK = store_mod.NO_BLOCK;
const LatestMessage = store_mod.LatestMessage;
const Root = store_mod.Root;
const Epoch = store_mod.Epoch;
const computeEpochAtSlot = store_mod.computeEpochAtSlot;
const computeStartSlotAtEpoch = store_mod.computeStartSlotAtEpoch;

const NO_NODE: u32 = std.math.maxInt(u32);

const NodeFlags = packed struct(u8) {
    exists: bool = false,
    viable: bool = false,
    has_children: bool = false,
    any_viable_child: bool = false,
    on_boost_chain: bool = false,
    _: u3 = 0,
};

pub const ViableHead = struct {
    root: Root,
    payload_status: PayloadStatus,
    weight: u64,
};

pub const Cache = struct {
    dirty: bool = true,
    /// Spec `get_attestation_score` per node, in Gwei.
    weight: std.ArrayList(u64) = .empty,
    flags: std.ArrayList(NodeFlags) = .empty,
    /// Per node: the worst engine verdict on the payloads the node stands on.
    execution: std.ArrayList(ExecutionStatus) = .empty,
    best_child: std.ArrayList(u32) = .empty,
    /// Per block: `store.finalized_checkpoint.root == get_checkpoint_block(store, root, finalized.epoch)`.
    finalized_ok: std.ArrayList(bool) = .empty,
    finalized_ancestor: std.ArrayList(BlockIndex) = .empty,
    apply_proposer_boost: bool = false,
    proposer_score: u64 = 0,
    head: ForkChoiceNode = .{ .block = 0, .payload_status = .pending },

    pub const empty: Cache = .{};

    pub fn deinit(self: *Cache, allocator: Allocator) void {
        self.weight.deinit(allocator);
        self.flags.deinit(allocator);
        self.execution.deinit(allocator);
        self.best_child.deinit(allocator);
        self.finalized_ok.deinit(allocator);
        self.finalized_ancestor.deinit(allocator);
        self.* = .empty;
    }
};

pub fn nodeId(node: ForkChoiceNode) u32 {
    return node.block * 3 + @intFromEnum(node.payload_status);
}

fn nodeAt(id: u32) ForkChoiceNode {
    return .{ .block = id / 3, .payload_status = @enumFromInt(id % 3) };
}

pub fn ensureComputed(store: *Store) !void {
    if (!store.head_cache.dirty) return;
    try compute(store);
}

fn compute(store: *Store) !void {
    const allocator = store.allocator;
    const cache = &store.head_cache;
    const n: usize = store.blocks.len;
    const node_count = n * 3;
    try cache.weight.resize(allocator, node_count);
    try cache.flags.resize(allocator, node_count);
    try cache.execution.resize(allocator, node_count);
    try cache.best_child.resize(allocator, node_count);
    try cache.finalized_ok.resize(allocator, n);
    try cache.finalized_ancestor.resize(allocator, n);
    try store.votes.update(allocator, node_count);
    @memcpy(cache.weight.items, store.votes.vote_weight.items);
    @memset(cache.flags.items, .{});
    @memset(cache.best_child.items, NO_NODE);

    const slots = store.blocks.items(.slot);
    const parents = store.blocks.items(.parent);
    const forks = store.blocks.items(.fork);
    const parent_statuses = store.blocks.items(.parent_payload_status);
    const payload_verified = store.blocks.items(.payload_verified);
    const weight_col = cache.weight.items;
    const flags = cache.flags.items;
    const exec = cache.execution.items;
    const current_epoch = store.currentEpoch();

    const own_status = store.blocks.items(.execution_status);
    const finalized_slot = computeStartSlotAtEpoch(store.finalized_checkpoint.epoch);
    const finalized_index = store.blockIndex(store.finalized_checkpoint.root) orelse NO_BLOCK;
    const finalized_at_genesis = store.finalized_checkpoint.epoch == GENESIS_EPOCH;
    // Each block reads only its own row and its parent's results, so one forward pass fills all three.
    for (0..n) |i| {
        const index: BlockIndex = @intCast(i);
        const parent = parents[i];
        const gloas = forks[i].gte(.gloas);
        const pending = nodeId(Store.pendingNode(index));
        const empty = nodeId(.{ .block = index, .payload_status = .empty });
        const full = nodeId(.{ .block = index, .payload_status = .full });

        // A node stands on the node it hangs from plus, before Gloas and for `.full` nodes,
        // the block's own payload.
        const base: ExecutionStatus = if (parent == NO_BLOCK) store.root_base_status else exec[nodeId(.{ .block = parent, .payload_status = parent_statuses[i] })];
        const with_own = base.worst(own_status[i]);
        exec[pending] = if (gloas) base else with_own;
        exec[empty] = if (gloas) base else with_own;
        exec[full] = with_own;

        // Spec `get_checkpoint_block(store, root, store.finalized_checkpoint.epoch)`.
        const ancestor = if (slots[i] <= finalized_slot or parent == NO_BLOCK) index else cache.finalized_ancestor.items[parent];
        cache.finalized_ancestor.items[i] = ancestor;
        cache.finalized_ok.items[i] = finalized_at_genesis or ancestor == finalized_index;

        if (exec[pending] == .invalid) continue;
        flags[pending].exists = true;
        if (gloas) {
            flags[empty].exists = true;
            if (payload_verified[i] and exec[full] != .invalid) flags[full].exists = true;
        }
    }

    // Spec `filter_node_tree` plus weight accumulation, children before parents.
    var b: usize = n;
    while (b > 0) {
        b -= 1;
        const index: BlockIndex = @intCast(b);
        const pending = nodeId(Store.pendingNode(index));
        if (!flags[pending].exists) continue;
        const leaf_viable = leafViable(store, index, current_epoch, cache.finalized_ok.items[b]);
        if (forks[b].gte(.gloas)) {
            var any_viable = false;
            for ([_]PayloadStatus{ .empty, .full }) |status| {
                const id = nodeId(.{ .block = index, .payload_status = status });
                if (!flags[id].exists) continue;
                const viable = if (flags[id].has_children) flags[id].any_viable_child else leaf_viable;
                if (viable) flags[id].viable = true;
                any_viable = any_viable or viable;
                weight_col[pending] += weight_col[id];
            }
            flags[pending].has_children = true;
            if (any_viable) {
                flags[pending].viable = true;
                flags[pending].any_viable_child = true;
            }
        } else {
            const viable = if (flags[pending].has_children) flags[pending].any_viable_child else leaf_viable;
            if (viable) flags[pending].viable = true;
        }
        const parent = parents[b];
        if (parent == NO_BLOCK) continue;
        const parent_node = nodeId(.{ .block = parent, .payload_status = parent_statuses[b] });
        weight_col[parent_node] += weight_col[pending];
        flags[parent_node].has_children = true;
        if (flags[pending].viable) flags[parent_node].any_viable_child = true;
    }

    // Spec `get_weight` proposer boost: `is_ancestor(proposer_boost_node, node)` holds
    // exactly on the path from the boosted block's `pending` node to the root.
    cache.apply_proposer_boost = try shouldApplyProposerBoost(store);
    cache.proposer_score = store.proposerScore();
    if (cache.apply_proposer_boost and exec[nodeId(Store.pendingNode(store.blockIndex(store.proposer_boost_root).?))] == .invalid) {
        cache.apply_proposer_boost = false;
    }
    if (cache.apply_proposer_boost) {
        var node = Store.pendingNode(store.blockIndex(store.proposer_boost_root).?);
        while (true) {
            flags[nodeId(node)].on_boost_chain = true;
            const parent = parents[node.block];
            if (parent == NO_BLOCK) break;
            flags[nodeId(.{ .block = parent, .payload_status = parent_statuses[node.block] })].on_boost_chain = true;
            node = Store.pendingNode(parent);
        }
    }

    // Spec `get_head` child selection: `max(children, key=(get_weight, root, tiebreaker))`.
    for (0..n) |i| {
        const index: BlockIndex = @intCast(i);
        const pending: ForkChoiceNode = Store.pendingNode(index);
        if (parents[i] != NO_BLOCK and flags[nodeId(pending)].viable) {
            try offerChild(store, nodeId(.{ .block = parents[i], .payload_status = parent_statuses[i] }), pending);
        }
        if (forks[i].gte(.gloas)) {
            for ([_]PayloadStatus{ .empty, .full }) |status| {
                const child: ForkChoiceNode = .{ .block = index, .payload_status = status };
                const id = nodeId(child);
                if (flags[id].exists and flags[id].viable) try offerChild(store, nodeId(pending), child);
            }
        }
    }

    const justified = store.blockIndex(store.justified_checkpoint.root) orelse return error.UnknownBlock;
    var head = Store.pendingNode(justified);
    if (exec[nodeId(head)] == .invalid) return error.InvalidJustifiedPayload;
    if (forks[justified].gte(.gloas) and !flags[nodeId(head)].viable) {
        head = .{ .block = justified, .payload_status = .empty };
    } else {
        while (cache.best_child.items[nodeId(head)] != NO_NODE) {
            head = nodeAt(cache.best_child.items[nodeId(head)]);
        }
    }
    cache.head = head;
    cache.dirty = false;
}

/// Spec `get_supported_node`.
pub fn supportedNode(store: *const Store, message: LatestMessage) ForkChoiceNode {
    const block = message.block;
    if (store.blocks.items(.fork)[block].gte(.gloas) and store.blocks.items(.slot)[block] < message.slot) {
        return .{ .block = block, .payload_status = if (message.payload_present) .full else .empty };
    }
    return Store.pendingNode(block);
}

/// The leaf case of spec `filter_node_tree`: the voting source and finalized checkpoint checks.
fn leafViable(store: *const Store, block: BlockIndex, current_epoch: Epoch, finalized_ok: bool) bool {
    const block_epoch = computeEpochAtSlot(store.blocks.items(.slot)[block]);
    // Spec `get_voting_source`
    const voting_source = if (current_epoch > block_epoch)
        store.blocks.items(.unrealized_justified_checkpoint)[block]
    else
        store.blocks.items(.justified_checkpoint)[block];
    const justified_epoch = store.justified_checkpoint.epoch;
    const correct_justified = justified_epoch == GENESIS_EPOCH or
        voting_source.epoch == justified_epoch or
        voting_source.epoch + 2 >= current_epoch;
    return correct_justified and finalized_ok;
}

fn offerChild(store: *Store, parent_id: u32, child: ForkChoiceNode) !void {
    const cache = &store.head_cache;
    const current = cache.best_child.items[parent_id];
    if (current == NO_NODE or try childGreater(store, child, nodeAt(current))) {
        cache.best_child.items[parent_id] = nodeId(child);
    }
}

fn childGreater(store: *Store, a: ForkChoiceNode, b: ForkChoiceNode) !bool {
    const weight_a = weight(store, a);
    const weight_b = weight(store, b);
    if (weight_a != weight_b) return weight_a > weight_b;
    const roots = store.blocks.items(.root);
    switch (std.mem.order(u8, &roots[a.block], &roots[b.block])) {
        .gt => return true,
        .lt => return false,
        .eq => {},
    }
    return try payloadStatusTiebreaker(store, a) > try payloadStatusTiebreaker(store, b);
}

/// Spec `get_weight`, valid after `ensureComputed`.
pub fn weight(store: *const Store, node: ForkChoiceNode) u64 {
    if (store.isPreviousSlotPayloadDecision(node)) return 0;
    const cache = &store.head_cache;
    const id = nodeId(node);
    var total = cache.weight.items[id];
    if (cache.apply_proposer_boost and cache.flags.items[id].on_boost_chain) total += cache.proposer_score;
    return total;
}

/// Spec `get_attestation_score`, valid after `ensureComputed`.
pub fn attestationScore(store: *const Store, node: ForkChoiceNode) u64 {
    return store.head_cache.weight.items[nodeId(node)];
}

/// Spec `get_payload_status_tiebreaker`, plus consensus-specs#5769: during its own slot a
/// Heze payload known to fail its inclusion list ranks below its EMPTY variant.
fn payloadStatusTiebreaker(store: *const Store, node: ForkChoiceNode) !u8 {
    if (store.isPreviousSlotPayloadDecision(node)) {
        if (node.payload_status == .empty) return 1;
        return if (try store.shouldExtendPayload(node.block)) 2 else 0;
    }
    return switch (node.payload_status) {
        .empty => 1,
        .full => if (store.blockSlot(node.block) == store.currentSlot() and
            store.blocks.items(.fork)[node.block].gte(.heze) and
            store.blocks.items(.inclusion_list_satisfaction)[node.block] == .unsatisfied) 0 else 2,
        .pending => 3,
    };
}

/// Spec `should_apply_proposer_boost`; pre-Gloas the boost applies whenever it is set.
fn shouldApplyProposerBoost(store: *Store) !bool {
    const boosted = store.blockIndex(store.proposer_boost_root) orelse return false;
    if (!store.isGloas()) return true;
    const parents = store.blocks.items(.parent);
    const slots = store.blocks.items(.slot);
    const parent = parents[boosted];
    if (parent == NO_BLOCK) return true;
    const slot = slots[boosted];
    if (slots[parent] + 1 < slot) return true;
    if (!try isHeadWeak(store, parent)) return true;
    const proposers = store.blocks.items(.proposer_index);
    const timely = store.blocks.items(.timely);
    for (0..store.blocks.len) |i| {
        if (i == parent) continue;
        if (timely[i][store_mod.PTC_TIMELINESS_INDEX] and proposers[i] == proposers[parent] and slots[i] + 1 == slot) return false;
    }
    return true;
}

/// Spec `is_head_weak`, valid after the attestation scores of `compute` are in place.
pub fn isHeadWeak(store: *Store, block: BlockIndex) !bool {
    const reorg_threshold = store.committeeFraction(store.config.chain.REORG_HEAD_WEIGHT_THRESHOLD);
    var head_weight = attestationScore(store, Store.pendingNode(block));
    if (store.votes.equivocating_indices.count() > 0) {
        var members: std.ArrayList(store_mod.ValidatorIndex) = .empty;
        defer members.deinit(store.allocator);
        try store.provider.slotCommitteeMembers(store.allocator, store.blockRoot(block), store.blockSlot(block), &members);
        const increments = store.justified_balances.effective_balance_increments;
        for (members.items) |member| {
            if (!store.isEquivocating(member)) continue;
            if (member >= increments.len) continue;
            head_weight += @as(u64, increments[member]) * preset.EFFECTIVE_BALANCE_INCREMENT;
        }
    }
    return head_weight < reorg_threshold;
}

/// Spec `is_parent_strong`.
pub fn isParentStrong(store: *Store, block: BlockIndex) bool {
    const parent_threshold = store.committeeFraction(store.config.chain.REORG_PARENT_WEIGHT_THRESHOLD);
    const parent = store.blocks.items(.parent)[block];
    const parent_weight = attestationScore(store, Store.pendingNode(parent));
    return parent_weight > parent_threshold;
}

/// Leaves of the filtered node tree below the justified root. The root itself is a
/// leaf when none of its children is viable, whether or not it passes the filter.
pub fn viableHeads(store: *Store, allocator: Allocator) ![]ViableHead {
    var out: std.ArrayList(ViableHead) = .empty;
    errdefer out.deinit(allocator);
    const n = store.blocks.len;
    const justified = store.blockIndex(store.justified_checkpoint.root) orelse return error.UnknownBlock;
    const parents = store.blocks.items(.parent);
    const in_subtree = try allocator.alloc(bool, n);
    defer allocator.free(in_subtree);
    for (0..n) |i| {
        in_subtree[i] = i == justified or (parents[i] != NO_BLOCK and in_subtree[parents[i]]);
    }
    const flags = store.head_cache.flags.items;
    const roots = store.blocks.items(.root);
    for (flags, 0..) |flag, id| {
        const node = nodeAt(@intCast(id));
        if (!in_subtree[node.block]) continue;
        if (!flag.exists or flag.any_viable_child) continue;
        const is_root = node.block == justified and node.payload_status == .pending;
        if (!is_root and !flag.viable) continue;
        try out.append(allocator, .{ .root = roots[node.block], .payload_status = node.payload_status, .weight = weight(store, node) });
    }
    return out.toOwnedSlice(allocator);
}
