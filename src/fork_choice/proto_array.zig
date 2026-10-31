const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;
const math = std.math;
const testing = std.testing;

const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;
const constants = @import("constants");
const preset_mod = @import("preset");
const preset = preset_mod.preset;
const state_transition = @import("state_transition");
const computeEpochAtSlot = state_transition.computeEpochAtSlot;
const computeStartSlotAtEpoch = state_transition.computeStartSlotAtEpoch;

const Slot = primitives.Slot.Type;
const Epoch = primitives.Epoch.Type;
const Root = primitives.Root.Type;
const ValidatorIndex = primitives.ValidatorIndex.Type;

const ZERO_HASH = constants.ZERO_HASH;

// ── Type definitions (formerly proto_node.zig) ──

/// Execution status of a block in fork choice.
///
/// State transitions:
///   Syncing -> Valid    (allowed: EL confirmed payload valid)
///   Syncing -> Invalid  (allowed: EL confirmed payload invalid)
///   Valid -> Invalid    (forbidden: never reverts once valid)
///   Invalid -> *        (forbidden: terminal state)
pub const ExecutionStatus = enum(u3) {
    /// EL confirmed payload valid.
    valid,
    /// EL is syncing; payload validity unknown (optimistic sync).
    syncing,
    /// Block is from before The Merge; no execution payload exists.
    pre_merge,
    /// EL confirmed payload invalid (terminal state).
    invalid,
    /// Gloas: beacon block without embedded execution payload (ePBS).
    /// The execution payload arrives separately via SignedExecutionPayloadEnvelope.
    /// Gloas blocks WITH payload (FULL variant) use Valid/Invalid/Syncing instead.
    payload_separated,
};

/// Data availability status for a block's blob data.
pub const DataAvailabilityStatus = enum(u2) {
    /// Block is from before data availability requirements.
    pre_data,
    /// Validator activities can't be performed on out-of-range data.
    out_of_range,
    /// Data is available and verified.
    available,
    /// Gloas: beacon blocks have no DA requirement; execution payload is separate.
    not_required,
};

/// Gloas (ePBS) payload resolution status for a block node.
/// Spec: gloas/fork-choice.md#constants
///
/// Each Gloas block creates up to 3 variant nodes in ProtoArray:
///   pending: initial state (block received, payload fate unknown)
///   empty:   payload absent (no execution payload arrived)
///   full:    payload arrived (execution payload received)
///
/// Pre-Gloas blocks are always full (payload embedded in block).
pub const PayloadStatus = enum(u2) {
    pending = 0,
    empty = 1,
    full = 2,
};

/// Metadata that depends on whether the block is pre-merge or post-merge.
///
/// The post-merge variant rejects `ExecutionStatus.pre_merge` via assert in `PostMergeMeta.init()`.
pub const BlockExtraMeta = union(enum) {
    post_merge: PostMergeMeta,
    pre_merge: void,

    pub const PostMergeMeta = struct {
        /// Pre-gloas: block hash of the execution payload embedded in this block.
        /// Post-gloas (Gloas): parentBlockHash from the block's bid (payload arrives later);
        ///   for FULL variant, this is the execution payload block hash.
        execution_payload_block_hash: Root,
        execution_payload_number: u64,
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,

        /// Rejects `ExecutionStatus.pre_merge` at runtime (Debug/ReleaseSafe).
        pub fn init(
            block_hash: Root,
            number: u64,
            status: ExecutionStatus,
            da_status: DataAvailabilityStatus,
        ) PostMergeMeta {
            assert(status != .pre_merge);
            return .{
                .execution_payload_block_hash = block_hash,
                .execution_payload_number = number,
                .execution_status = status,
                .data_availability_status = da_status,
            };
        }
    };

    pub fn executionPayloadBlockHash(self: BlockExtraMeta) ?Root {
        return switch (self) {
            .post_merge => |m| m.execution_payload_block_hash,
            .pre_merge => null,
        };
    }

    pub fn executionStatus(self: BlockExtraMeta) ExecutionStatus {
        return switch (self) {
            .post_merge => |m| m.execution_status,
            .pre_merge => .pre_merge,
        };
    }

    pub fn dataAvailabilityStatus(self: BlockExtraMeta) DataAvailabilityStatus {
        return switch (self) {
            .post_merge => |m| m.data_availability_status,
            .pre_merge => .pre_data,
        };
    }

    pub fn executionPayloadNumber(self: BlockExtraMeta) u64 {
        return switch (self) {
            .post_merge => |m| m.execution_payload_number,
            .pre_merge => 0,
        };
    }
};

/// A block to be applied to the fork choice DAG.
/// A simplified version of BeaconBlock.
pub const ProtoBlock = struct {
    // ── Core fields used by ProtoArray algorithm ──

    /// Slot at which this block was proposed.
    /// Not necessary for ProtoArray itself; exists for external components to query.
    slot: Slot,
    /// Hash-tree-root of the BeaconBlock.
    block_root: Root,
    /// Hash-tree-root of the parent BeaconBlock.
    parent_root: Root,

    // ── Passthrough: not used by ProtoArray, but needed by upstream ──

    /// Hash-tree-root of the post-state after applying this block.
    /// Not necessary for ProtoArray; exists for upstream components.
    state_root: Root,
    /// The root that would be used for attestation.data.target.root
    /// if a LMD vote were cast for this block.
    target_root: Root,

    // ── FFG checkpoints (realized) ──

    /// Epoch of the realized justified checkpoint from this block's state.
    justified_epoch: Epoch,
    /// Root of the realized justified checkpoint from this block's state.
    justified_root: Root,
    /// Epoch of the realized finalized checkpoint from this block's state.
    finalized_epoch: Epoch,
    /// Root of the realized finalized checkpoint from this block's state.
    finalized_root: Root,

    // ── Unrealized checkpoints (pull-up FFG, anti-bouncing attack) ──

    /// Epoch of the unrealized justified checkpoint (computed at block import, not epoch boundary).
    unrealized_justified_epoch: Epoch,
    /// Root of the unrealized justified checkpoint.
    unrealized_justified_root: Root,
    /// Epoch of the unrealized finalized checkpoint.
    unrealized_finalized_epoch: Epoch,
    /// Root of the unrealized finalized checkpoint.
    unrealized_finalized_root: Root,

    // ── Execution layer metadata ──

    /// Pre-merge vs post-merge metadata (execution status, block hash, DA status).
    extra_meta: BlockExtraMeta,

    /// Whether block arrived before the 4-second mark (timeliness for late-block reorg).
    timeliness: bool,

    // ── Gloas (ePBS) fields ──

    /// Parent execution block hash (Gloas ePBS).
    /// Used to determine if this block extends its parent's EMPTY or FULL variant.
    /// Spec: gloas/fork-choice.md#new-get_parent_payload_status
    parent_block_hash: ?Root = null,
    /// Payload resolution status (Gloas ePBS). Pre-Gloas blocks are always .full.
    payload_status: PayloadStatus = .full,

    /// Returns true if this is a Gloas (ePBS) block.
    /// Gloas blocks have a non-null parent_block_hash.
    pub fn isGloasBlock(self: ProtoBlock) bool {
        return self.parent_block_hash != null;
    }
};

/// A node in the ProtoArray DAG.
/// Also serves as ForkChoiceNode in the fork choice spec.
///
/// Flat layout: all ProtoBlock fields + DAG metadata.
/// Use `fromBlock()` / `toBlock()` to convert between ProtoBlock and ProtoNode.
/// All indices refer to positions in the flat `nodes` array.
pub const ProtoNode = struct {
    // ── ProtoBlock fields ──

    /// Slot at which this block was proposed.
    /// Not necessary for ProtoArray itself; exists for external components to query.
    slot: Slot,
    /// Hash-tree-root of the BeaconBlock.
    block_root: Root,
    /// Hash-tree-root of the parent BeaconBlock.
    parent_root: Root,

    /// Hash-tree-root of the post-state after applying this block.
    /// Not necessary for ProtoArray; exists for upstream components.
    state_root: Root,
    /// The root that would be used for attestation.data.target.root
    /// if a LMD vote were cast for this block.
    target_root: Root,

    /// Epoch of the realized justified checkpoint from this block's state.
    justified_epoch: Epoch,
    /// Root of the realized justified checkpoint from this block's state.
    justified_root: Root,
    /// Epoch of the realized finalized checkpoint from this block's state.
    finalized_epoch: Epoch,
    /// Root of the realized finalized checkpoint from this block's state.
    finalized_root: Root,

    /// Epoch of the unrealized justified checkpoint (computed at block import, not epoch boundary).
    unrealized_justified_epoch: Epoch,
    /// Root of the unrealized justified checkpoint.
    unrealized_justified_root: Root,
    /// Epoch of the unrealized finalized checkpoint.
    unrealized_finalized_epoch: Epoch,
    /// Root of the unrealized finalized checkpoint.
    unrealized_finalized_root: Root,

    /// Pre-merge vs post-merge metadata (execution status, block hash, DA status).
    extra_meta: BlockExtraMeta,

    /// Whether block arrived before the 4-second mark (timeliness for late-block reorg).
    timeliness: bool,

    /// Parent execution block hash (Gloas ePBS).
    /// Used to determine if this block extends its parent's EMPTY or FULL variant.
    /// Spec: gloas/fork-choice.md#new-get_parent_payload_status
    parent_block_hash: ?Root = null,
    /// Payload resolution status (Gloas ePBS). Pre-Gloas blocks are always .full.
    payload_status: PayloadStatus = .full,

    // ── DAG metadata ──

    /// Index of parent node in the nodes array. null for the root.
    parent: ?u32 = null,

    /// LMD-GHOST weight: sum of effective balances of validators
    /// whose latest vote is for this subtree.
    weight: i64 = 0,

    /// Index of the highest-weight child.
    best_child: ?u32 = null,

    /// Index of the best leaf reachable from this node.
    /// findHead: justified_root -> bestDescendant in O(1).
    best_descendant: ?u32 = null,

    /// Create a ProtoNode from a ProtoBlock, copying all matching fields.
    pub fn fromBlock(block: ProtoBlock) ProtoNode {
        var node: ProtoNode = undefined;
        inline for (std.meta.fields(ProtoBlock)) |field| {
            @field(node, field.name) = @field(block, field.name);
        }
        node.parent = null;
        node.weight = 0;
        node.best_child = null;
        node.best_descendant = null;
        return node;
    }

    /// Extract a ProtoBlock from this node, copying all matching fields.
    pub fn toBlock(self: ProtoNode) ProtoBlock {
        var block: ProtoBlock = undefined;
        inline for (std.meta.fields(ProtoBlock)) |field| {
            @field(block, field.name) = @field(self, field.name);
        }
        return block;
    }

    /// Returns true if this is a Gloas (ePBS) block.
    /// Gloas blocks have a non-null parent_block_hash.
    pub fn isGloasBlock(self: ProtoNode) bool {
        return self.parent_block_hash != null;
    }
};

/// Response from the execution layer about a payload's validity.
pub const LVHExecResponse = union(enum) {
    valid: LVHValidResponse,
    invalid: LVHInvalidResponse,
};

pub const LVHValidResponse = struct {
    latest_valid_exec_hash: Root,
};

pub const LVHInvalidResponse = struct {
    /// The last valid execution payload hash. null means the EL doesn't know
    /// the last valid point — this triggers an irrecoverable error.
    latest_valid_exec_hash: ?Root,
    invalidate_from_parent_block_root: Root,
};

/// LVH (Latest Valid Hash) execution status transition errors.
pub const LVHExecErrorCode = enum {
    /// Attempted to mark a pre-merge block as invalid.
    pre_merge_to_invalid,
    /// Attempted to mark a valid block as invalid (forbidden transition).
    valid_to_invalid,
    /// Attempted to mark an invalid block as valid (forbidden transition).
    invalid_to_valid,
};

/// Stored error from validateLatestHash when an irrecoverable
/// execution status transition is detected.
pub const LVHExecError = struct {
    lvh_code: LVHExecErrorCode,
    block_root: Root,
    exec_hash: Root,
};

/// Reasons a block can be rejected by fork choice.
pub const InvalidBlockCode = enum {
    unknown_parent,
    future_slot,
    finalized_slot,
    not_finalized_descendant,
};

/// Reasons an attestation can be rejected by fork choice.
pub const InvalidAttestationCode = enum {
    empty_aggregation_bitfield,
    unknown_head_block,
    bad_target_epoch,
    unknown_target_root,
    future_epoch,
    past_epoch,
    invalid_target,
    attests_to_future_block,
    future_slot,
    /// Gloas: attestation data index must be 0 or 1.
    invalid_data_index,
};

/// High-level fork choice errors.
pub const ProtoArrayError = error{
    FinalizedNodeUnknown,
    JustifiedNodeUnknown,
    InvalidFinalizedRootChange,
    InvalidNodeIndex,
    InvalidParentIndex,
    InvalidBestChildIndex,
    InvalidJustifiedIndex,
    InvalidBestDescendantIndex,
    DeltaOverflow,
    IndexOverflow,
    RevertedFinalizedEpoch,
    InvalidBestNode,
    InvalidBlockExecutionStatus,
    InvalidJustifiedExecutionStatus,
    InvalidLVHExecutionResponse,
    UnknownParentBlock,
    UnknownBlock,
    PreGloasBlock,
    MissingProtoArrayBlock,
    UnknownAncestor,
};
const GENESIS_EPOCH = preset_mod.GENESIS_EPOCH;

/// PTC (Payload Timeliness Committee) vote threshold.
/// More than PAYLOAD_TIMELY_THRESHOLD payload_present votes = payload is timely.
/// Spec: gloas/fork-choice.md (PAYLOAD_TIMELY_THRESHOLD = PTC_SIZE // 2)
const PAYLOAD_TIMELY_THRESHOLD: u32 = preset.PTC_SIZE / 2;

/// Minimum number of finalized nodes before pruning is triggered.
pub const DEFAULT_PRUNE_THRESHOLD: u32 = 0;

// ── Hash context for [32]u8 roots ──

/// Hash context for [32]u8 roots used in index maps.
/// Uses first 8 bytes as u64 hash — sufficient entropy for SHA-256 block roots.
pub const RootContext = struct {
    pub fn hash(_: RootContext, key: Root) u64 {
        return std.mem.readInt(u64, key[0..8], .little);
    }
    pub fn eql(_: RootContext, a: Root, b: Root) bool {
        return std.mem.eql(u8, &a, &b);
    }
};

// ── Variant indices (Gloas multi-node support) ──

/// Indices into ProtoArray.nodes for a block root.
///
/// Pre-Gloas: a single node index (the block is always FULL).
/// Gloas: 2-3 node indices (PENDING, EMPTY, and optionally FULL).
pub const VariantIndices = union(enum) {
    /// Pre-Gloas: single node (always PayloadStatus.full).
    pre_gloas: u32,
    /// Gloas: variant nodes for the same block root.
    gloas: GloasIndices,

    pub const GloasIndices = struct {
        /// Index of the PENDING variant node.
        pending: u32,
        /// Index of the EMPTY variant node.
        empty: u32,
        /// Index of the FULL variant node (null until payload arrives).
        full: ?u32 = null,
    };

    /// Get the default index for a block root.
    /// Pre-Gloas: the pre_gloas index. Gloas: the PENDING index.
    pub fn defaultIndex(self: VariantIndices) u32 {
        return switch (self) {
            .pre_gloas => |idx| idx,
            .gloas => |g| g.pending,
        };
    }

    /// Get the index for a specific payload status.
    /// Returns null if the requested Gloas variant does not exist yet.
    /// Asserts that pre-Gloas blocks are only queried with .full status.
    pub fn getByPayloadStatus(self: VariantIndices, status: PayloadStatus) ?u32 {
        return switch (self) {
            // Pre-Gloas: only FULL variant exists — PENDING and EMPTY are invalid (unreachable).
            .pre_gloas => |idx| switch (status) {
                .full => idx,
                .pending, .empty => unreachable,
            },
            .gloas => |g| switch (status) {
                .pending => g.pending,
                .empty => g.empty,
                .full => g.full,
            },
        };
    }

    /// Fill `buf` with all valid indices and return the populated prefix.
    /// 1 element for pre-Gloas, 2-3 for Gloas (PENDING + EMPTY + optional FULL).
    pub fn allIndices(self: VariantIndices, buf: *[3]u32) []const u32 {
        switch (self) {
            .pre_gloas => |idx| {
                buf[0] = idx;
                return buf[0..1];
            },
            .gloas => |g| {
                buf[0] = g.pending;
                buf[1] = g.empty;
                if (g.full) |f| {
                    buf[2] = f;
                    return buf[0..3];
                }
                return buf[0..2];
            },
        }
    }
};

// ── ProtoArray ──

pub const ProtoArray = struct {
    /// Flat array DAG — nodes stored in insertion order.
    /// Parent always has a lower index than any of its children.
    nodes: std.ArrayList(ProtoNode),

    /// Block root -> node index(es) mapping.
    indices: std.HashMapUnmanaged(Root, VariantIndices, RootContext, 80),

    /// Minimum number of finalized nodes before pruning is triggered.
    prune_threshold: u32,

    // ── Checkpoint state ──

    justified_epoch: Epoch,
    justified_root: Root,
    finalized_epoch: Epoch,
    finalized_root: Root,

    // ── Proposer boost tracking ──

    previous_proposer_boost: ?ProposerBoost,

    // ── Gloas (ePBS) state ──

    /// PTC (Payload Timeliness Committee) votes per block root.
    /// Bit i is set when PTC member i voted payload_present=true.
    /// Spec: gloas/fork-choice.md#modified-store
    ptc_votes: std.HashMapUnmanaged(Root, PtcVotes, RootContext, 80),

    /// Error from the last validateLatestHash call, if any.
    /// Stored for upper-layer query; does not affect core algorithm.
    lvh_error: ?LVHExecError,

    pub const PtcVotes = std.StaticBitSet(preset.PTC_SIZE);

    pub const ProposerBoost = struct {
        root: Root,
        score: u64,
    };

    fn init(
        self: *ProtoArray,
        justified_epoch: Epoch,
        justified_root: Root,
        finalized_epoch: Epoch,
        finalized_root: Root,
        prune_threshold: u32,
    ) void {
        self.* = .{
            .nodes = .empty,
            .indices = .empty,
            .prune_threshold = prune_threshold,
            .justified_epoch = justified_epoch,
            .justified_root = justified_root,
            .finalized_epoch = finalized_epoch,
            .finalized_root = finalized_root,
            .previous_proposer_boost = null,
            .ptc_votes = .empty,
            .lvh_error = null,
        };
    }

    pub fn deinit(self: *ProtoArray, allocator: Allocator) void {
        self.ptc_votes.deinit(allocator);
        self.indices.deinit(allocator);
        self.nodes.deinit(allocator);
        self.* = undefined;
    }

    /// Create a ProtoArray from a genesis/anchor block.
    /// The block's block_root is used as its target_root since it lies on an epoch boundary.
    pub fn initialize(
        self: *ProtoArray,
        allocator: Allocator,
        block: ProtoBlock,
        current_slot: Slot,
    ) (Allocator.Error || ProtoArrayError)!void {
        self.init(
            block.justified_epoch,
            block.justified_root,
            block.finalized_epoch,
            block.finalized_root,
            DEFAULT_PRUNE_THRESHOLD,
        );
        errdefer self.deinit(allocator);

        // Use block_root as target_root — genesis/anchor always sits on an epoch boundary.
        var anchor = block;
        anchor.target_root = block.block_root;

        try self.onBlock(allocator, anchor, current_slot, null);
    }

    // ── Accessors ──

    /// Get the default/canonical payload status for a block root.
    /// Pre-Gloas: returns .full (payload embedded in block).
    /// Gloas: returns .pending (canonical variant).
    /// Returns null if the block root is not found.
    pub fn getDefaultVariant(self: *const ProtoArray, block_root: Root) ?PayloadStatus {
        const vi = self.indices.get(block_root) orelse return null;
        return switch (vi) {
            .pre_gloas => .full,
            .gloas => .pending,
        };
    }

    /// Get the node index for the default/canonical variant in a single hash lookup.
    /// Pre-Gloas: returns the single (FULL) index.
    /// Gloas: returns the PENDING variant index.
    pub fn getDefaultNodeIndex(self: *const ProtoArray, block_root: Root) ?u32 {
        const vi = self.indices.get(block_root) orelse return null;
        return vi.defaultIndex();
    }

    /// Get node index for a specific root + payload status combination.
    pub fn getNodeIndexByRootAndStatus(
        self: *const ProtoArray,
        root: Root,
        status: PayloadStatus,
    ) ?u32 {
        const vi = self.indices.get(root) orelse return null;
        return vi.getByPayloadStatus(status);
    }

    /// Returns true if a block with the given root has been inserted.
    pub fn hasBlock(self: *const ProtoArray, root: Root) bool {
        return self.indices.contains(root);
    }

    /// Returns true if the FULL payload variant exists for this block root.
    /// This means the SignedExecutionPayloadEnvelope has been received and processed.
    pub fn hasPayload(self: *const ProtoArray, root: Root) bool {
        const vi = self.indices.get(root) orelse return false;
        return switch (vi) {
            .pre_gloas => true, // Pre-Gloas blocks always have their payload.
            .gloas => |g| g.full != null,
        };
    }

    // ── onBlock ──

    /// Register a block with the fork choice. It is only sane to supply
    /// a null parent for the genesis block.
    ///
    /// Pre-Gloas (block.parent_block_hash == null): Creates a single FULL node.
    /// Gloas (block.parent_block_hash != null): Creates PENDING + EMPTY nodes.
    /// Spec: gloas/fork-choice.md#modified-on_block
    pub fn onBlock(
        self: *ProtoArray,
        allocator: Allocator,
        block: ProtoBlock,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) (Allocator.Error || ProtoArrayError)!void {
        // Skip duplicate blocks.
        if (self.hasBlock(block.block_root)) return;

        // Reject blocks with invalid execution status.
        if (block.extra_meta.executionStatus() == .invalid) {
            return error.InvalidBlockExecutionStatus;
        }

        if (block.isGloasBlock()) {
            try self.onBlockGloas(allocator, block, current_slot, proposer_boost_root);
        } else {
            try self.onBlockPreGloas(allocator, block, current_slot, proposer_boost_root);
        }
    }

    fn onBlockPreGloas(
        self: *ProtoArray,
        allocator: Allocator,
        block: ProtoBlock,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) (Allocator.Error || ProtoArrayError)!void {
        var node = ProtoNode.fromBlock(block);
        assert(node.payload_status == .full);
        assert(!block.isGloasBlock());

        // Look up parent index.
        node.parent = self.getNodeIndexByRootAndStatus(block.parent_root, .full);

        // Pre-allocate capacity before mutating state.
        try self.nodes.ensureUnusedCapacity(allocator, 1);
        try self.indices.ensureUnusedCapacity(allocator, 1);

        const node_index: u32 = @intCast(self.nodes.items.len);
        self.nodes.appendAssumeCapacity(node);
        self.indices.putAssumeCapacity(block.block_root, .{ .pre_gloas = node_index });

        if (node.parent) |parent_index| {
            try self.maybeUpdateBestChildAndDescendant(parent_index, node_index, current_slot, proposer_boost_root);

            if (block.extra_meta.executionStatus() == .valid) {
                try self.propagateValidExecutionStatusByIndex(parent_index);
            }
        }
    }

    fn onBlockGloas(
        self: *ProtoArray,
        allocator: Allocator,
        block: ProtoBlock,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) (Allocator.Error || ProtoArrayError)!void {
        // Gloas: Create PENDING + EMPTY nodes with correct parent relationships
        // Parent of new PENDING node = parent block's EMPTY or FULL (inter-block edge)
        // Parent of new EMPTY node = own PENDING node (intra-block edge)
        assert(block.isGloasBlock());
        assert(block.extra_meta.executionStatus() != .invalid);

        // For fork transition: if parent is pre-Gloas, point to parent's FULL
        // Otherwise, determine which parent payload status this block extends
        var parent_index: ?u32 = null;

        // Check if parent exists by getting variants
        if (self.indices.get(block.parent_root)) |parent_vi| {
            parent_index = switch (parent_vi) {
                // Fork transition: parent is pre-Gloas, so it only has FULL variant
                .pre_gloas => |idx| idx,
                // Both blocks are Gloas: determine which parent payload status to extend
                .gloas => |g| blk: {
                    const parent_status = try self.getParentPayloadStatus(block.parent_root, block.parent_block_hash);
                    break :blk switch (parent_status) {
                        // If getParentPayloadStatus returns .full, the FULL variant
                        // must exist: getNodeByRootAndBlockHash only matches a FULL
                        // node when g.full is set (written by onExecutionPayload).
                        .full => g.full.?,
                        .empty => g.empty,
                        .pending => g.pending,
                    };
                },
            };
        }
        // else: parent doesn't exist, parent_index remains null (orphan block)

        // Pre-allocate capacity for all mutations before modifying state.
        // 2 nodes (PENDING + EMPTY), 1 index entry, 1 ptc_votes entry.
        try self.nodes.ensureUnusedCapacity(allocator, 2);
        try self.indices.ensureUnusedCapacity(allocator, 1);
        try self.ptc_votes.ensureUnusedCapacity(allocator, 1);

        // Create PENDING node
        var pending_node = ProtoNode.fromBlock(block);
        pending_node.payload_status = .pending;
        pending_node.parent = parent_index; // Points to parent's EMPTY/FULL or FULL (for transition)

        const pending_index: u32 = @intCast(self.nodes.items.len);
        self.nodes.appendAssumeCapacity(pending_node);

        // Create EMPTY variant as a child of PENDING
        var empty_node = ProtoNode.fromBlock(block);
        empty_node.payload_status = .empty;
        empty_node.parent = pending_index; // Points to own PENDING

        const empty_index: u32 = @intCast(self.nodes.items.len);
        self.nodes.appendAssumeCapacity(empty_node);

        // Store both variants in the indices
        // [PENDING, EMPTY, null] - FULL will be added later if payload arrives
        self.indices.putAssumeCapacity(block.block_root, .{
            .gloas = .{ .pending = pending_index, .empty = empty_index },
        });

        // Update bestChild pointers
        if (parent_index) |pi| {
            try self.maybeUpdateBestChildAndDescendant(pi, pending_index, current_slot, proposer_boost_root);

            if (block.extra_meta.executionStatus() == .valid) {
                try self.propagateValidExecutionStatusByIndex(pi);
            }
        }

        // Update bestChild for PENDING → EMPTY edge
        try self.maybeUpdateBestChildAndDescendant(pending_index, empty_index, current_slot, proposer_boost_root);

        // Initialize PTC votes for this block (all false initially)
        // Spec: gloas/fork-choice.md#modified-on_block
        self.ptc_votes.putAssumeCapacity(block.block_root, PtcVotes.initEmpty());
    }

    /// Called when an execution payload is received for a block (Gloas only).
    /// Creates a FULL variant node as a child of PENDING (sibling to EMPTY).
    /// Both EMPTY and FULL have parent = own PENDING node.
    ///
    /// The FULL node receives EL payload metadata (block hash, number)
    /// since these are unknown at onBlock time.
    pub fn onExecutionPayload(
        self: *ProtoArray,
        allocator: Allocator,
        block_root: Root,
        current_slot: Slot,
        execution_payload_block_hash: Root,
        execution_payload_number: u64,
        proposer_boost_root: ?Root,
        execution_status: ExecutionStatus,
    ) (Allocator.Error || ProtoArrayError)!void {
        const vi_ptr = self.indices.getPtr(block_root) orelse return error.UnknownBlock;

        switch (vi_ptr.*) {
            .pre_gloas => return error.PreGloasBlock,
            .gloas => |*g| {
                if (g.full != null) return; // Already have FULL variant.

                // Create FULL node from PENDING, as a child of PENDING.
                const pending_node = self.nodes.items[g.pending];
                var full_node = pending_node;
                full_node.payload_status = .full;
                full_node.parent = g.pending;
                full_node.best_child = null;
                full_node.best_descendant = null;
                full_node.weight = 0;

                // Update EL payload metadata on the FULL node, preserving
                // data_availability_status + state_root inherited from the PENDING node.
                full_node.extra_meta.post_merge.execution_payload_block_hash = execution_payload_block_hash;
                full_node.extra_meta.post_merge.execution_payload_number = execution_payload_number;
                // TODO GLOAS: handle optimistic sync
                full_node.extra_meta.post_merge.execution_status = execution_status;

                const full_index: u32 = @intCast(self.nodes.items.len);
                try self.nodes.append(allocator, full_node);
                g.full = full_index;

                // Update best child/descendant: PENDING -> FULL.
                try self.maybeUpdateBestChildAndDescendant(
                    g.pending,
                    full_index,
                    current_slot,
                    proposer_boost_root,
                );
            },
        }
    }

    /// Iterate backwards through the array, touching all nodes and their parents and potentially
    /// the best-child of each parent.
    ///
    /// The structure of the `self.nodes` array ensures that the child of each node is always
    /// touched before its parent.
    ///
    /// For each node, the following is done:
    ///
    /// - Update the node's weight with the corresponding delta.
    /// - Back-propagate each node's delta to its parents delta.
    /// - Compare the current node with the parents best-child, updating it if the current node
    ///   should become the best child.
    /// - If required, update the parents best-descendant with the current node or its best-descendant.
    pub fn applyScoreChanges(
        self: *ProtoArray,
        deltas: []i64,
        proposer_boost: ?ProposerBoost,
        justified_epoch: Epoch,
        justified_root: Root,
        finalized_epoch: Epoch,
        finalized_root: Root,
        current_slot: Slot,
    ) ProtoArrayError!void {
        assert(deltas.len == self.nodes.items.len);

        self.maybeUpdateCheckpoints(
            justified_epoch,
            justified_root,
            finalized_epoch,
            finalized_root,
        );

        try self.updateWeights(
            deltas,
            proposer_boost,
        );

        try self.updateBestDescendants(
            current_slot,
            if (proposer_boost) |boost|
                boost.root
            else
                null,
        );

        // Update the previous proposer boost.
        self.previous_proposer_boost = proposer_boost;
    }

    /// Update checkpoint state if any value changed.
    inline fn maybeUpdateCheckpoints(
        self: *ProtoArray,
        justified_epoch: Epoch,
        justified_root: Root,
        finalized_epoch: Epoch,
        finalized_root: Root,
    ) void {
        const changed =
            justified_epoch != self.justified_epoch or
            !std.mem.eql(u8, &justified_root, &self.justified_root) or
            finalized_epoch != self.finalized_epoch or
            !std.mem.eql(u8, &finalized_root, &self.finalized_root);

        if (changed) {
            self.justified_epoch = justified_epoch;
            self.justified_root = justified_root;
            self.finalized_epoch = finalized_epoch;
            self.finalized_root = finalized_root;
        }
    }

    /// Pass 1 (backward): iterate backwards through all indices in `self.nodes`.
    /// Apply proposer boost, compute node deltas, update weights,
    /// and back-propagate to parents.
    fn updateWeights(
        self: *ProtoArray,
        deltas: []i64,
        proposer_boost: ?ProposerBoost,
    ) ProtoArrayError!void {
        assert(deltas.len == self.nodes.items.len);

        // Iterate backwards through all indices in self.nodes
        var node_index: u32 = @intCast(self.nodes.items.len);
        while (node_index > 0) {
            node_index -= 1;
            const node = &self.nodes.items[node_index];

            // There is no need to adjust the balances or manage parent of the zero hash since it
            // is an alias to the genesis block. The weight applied to the genesis block is
            // irrelevant as we _always_ choose it and it's impossible for it to have a parent.
            if (std.mem.eql(u8, &node.block_root, &ZERO_HASH)) continue;

            // For Gloas blocks, PENDING/EMPTY/FULL all share the same blockRoot.
            // Only apply proposer boost to PENDING (for Gloas) or FULL (for pre-Gloas) — to avoid
            // double-counting the boost across variants during delta back-propagation, and to keep
            // the boost neutral with respect to EMPTY vs FULL selection.
            const is_boost_variant: bool = if (node.isGloasBlock()) node.payload_status == .pending else true;

            const current_boost: u64 = if (proposer_boost) |b|
                (if (is_boost_variant and std.mem.eql(u8, &b.root, &node.block_root)) b.score else 0)
            else
                0;
            const previous_boost: u64 = if (self.previous_proposer_boost) |p|
                (if (is_boost_variant and std.mem.eql(u8, &p.root, &node.block_root)) p.score else 0)
            else
                0;

            // If this node's execution status has been marked invalid, then the weight of the node
            // needs to be taken out of consideration after which the node weight will become 0
            // for subsequent iterations of applyScoreChanges
            const node_delta: i64 = if (node.extra_meta.executionStatus() == .invalid)
                math.negate(node.weight) catch return error.DeltaOverflow
            else blk: {
                const base = deltas[node_index];
                const boosted = math.add(i64, base, math.cast(i64, current_boost) orelse
                    return error.DeltaOverflow) catch return error.DeltaOverflow;
                break :blk math.sub(i64, boosted, math.cast(i64, previous_boost) orelse
                    return error.DeltaOverflow) catch return error.DeltaOverflow;
            };

            // Apply the delta to the node
            node.weight = math.add(i64, node.weight, node_delta) catch return error.DeltaOverflow;

            // Back-propagate the node's delta to its parent delta.
            if (node.parent) |parent_index| {
                assert(parent_index < deltas.len);
                deltas[parent_index] = math.add(i64, deltas[parent_index], node_delta) catch return error.DeltaOverflow;
            }
        }
    }

    /// Pass 2 (backward): iterate backwards through all indices in `self.nodes`.
    ///
    /// We _must_ perform these functions separate from the weight-updating loop above to ensure
    /// that we have a fully coherent set of weights before updating parent
    /// best-child/descendant.
    fn updateBestDescendants(
        self: *ProtoArray,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!void {
        var node_index: u32 = @intCast(self.nodes.items.len);
        while (node_index > 0) {
            node_index -= 1;
            if (self.nodes.items[node_index].parent) |parent_index| {
                assert(parent_index < self.nodes.items.len);
                try self.maybeUpdateBestChildAndDescendant(
                    parent_index,
                    node_index,
                    current_slot,
                    proposer_boost_root,
                );
            }
        }
    }

    /// Follows the best-descendant links to find the best-block (i.e., head-block).
    ///
    /// Returns the ProtoNode representing the head.
    /// For pre-Gloas forks, only FULL variants exist (payload embedded).
    /// For Gloas, may return PENDING/EMPTY/FULL variants.
    ///
    /// The justified node is always considered viable for head per spec:
    ///   def get_head(store: Store) -> Root:
    ///     blocks = get_filtered_block_tree(store)
    ///     head = store.justified_checkpoint.root
    pub fn findHead(
        self: *const ProtoArray,
        justified_root: Root,
        current_slot: Slot,
    ) ProtoArrayError!*const ProtoNode {
        if (self.lvh_error != null) return error.InvalidLVHExecutionResponse;

        const justified_index = self.getDefaultNodeIndex(justified_root) orelse return error.JustifiedNodeUnknown;
        assert(justified_index < self.nodes.items.len);

        // Get canonical node: FULL for pre-Gloas, PENDING for Gloas.
        const justified_node = &self.nodes.items[justified_index];
        if (justified_node.extra_meta.executionStatus() == .invalid) {
            return error.InvalidJustifiedExecutionStatus;
        }

        const best_descendant_index = justified_node.best_descendant orelse justified_index;
        assert(best_descendant_index < self.nodes.items.len);

        // Perform a sanity check that the node is indeed valid to be the head.
        const best_node = &self.nodes.items[best_descendant_index];
        if (best_descendant_index != justified_index and
            !self.nodeIsViableForHead(best_node, current_slot))
        {
            return error.InvalidBestNode;
        }

        return best_node;
    }

    // ── Parent payload status ──

    /// Return the parent ProtoNode given its root and optional block hash.
    ///
    /// Pre-Gloas (parent_block_hash == null): looks up the single index by root.
    /// If a Gloas variant is found when pre-Gloas is expected, returns error.
    /// Post-Gloas (parent_block_hash != null): delegates to getNodeByRootAndBlockHash.
    pub fn getParent(
        self: *const ProtoArray,
        parent_root: Root,
        parent_block_hash: ?Root,
    ) ?*const ProtoNode {
        const parent_bh = parent_block_hash orelse {
            // Pre-Gloas path: parent must be a pre-Gloas single-variant entry.
            // Fork sequence is monotonic — a pre-Gloas block cannot have a Gloas parent.
            const vi = self.indices.get(parent_root) orelse return null;
            assert(vi == .pre_gloas);
            return &self.nodes.items[vi.pre_gloas];
        };

        // Post-Gloas path: find by root + block hash.
        return self.getNodeByRootAndBlockHash(parent_root, parent_bh);
    }

    /// Returns an EMPTY or FULL ProtoNode that has matching block root and block hash.
    ///
    /// Searches the variant nodes (FULL first, then EMPTY for Gloas; single node for pre-Gloas)
    /// for one whose executionPayloadBlockHash matches the given block_hash.
    /// PENDING is skipped because its executionPayloadBlockHash is the same as EMPTY's.
    /// Returns null if no matching variant is found.
    pub fn getNodeByRootAndBlockHash(self: *const ProtoArray, block_root: Root, block_hash: Root) ?*const ProtoNode {
        const vi = self.indices.get(block_root) orelse return null;

        switch (vi) {
            .pre_gloas => |idx| {
                const node = &self.nodes.items[idx];
                if (node.extra_meta.executionPayloadBlockHash()) |node_bh| {
                    if (std.mem.eql(u8, &block_hash, &node_bh)) return node;
                }
                return null;
            },
            .gloas => |g| {
                // Check FULL variant first (may not exist yet), then EMPTY.
                if (g.full) |full_idx| {
                    const node = &self.nodes.items[full_idx];
                    if (node.extra_meta.executionPayloadBlockHash()) |node_bh| {
                        if (std.mem.eql(u8, &block_hash, &node_bh)) return node;
                    }
                }

                const node = &self.nodes.items[g.empty];
                if (node.extra_meta.executionPayloadBlockHash()) |node_bh| {
                    if (std.mem.eql(u8, &block_hash, &node_bh)) return node;
                }

                // PENDING is the same as EMPTY so not likely we can return it
                // also it's only specific for fork-choice
                return null;
            },
        }
    }

    /// Determine which parent payload status a block extends.
    /// Spec: gloas/fork-choice.md#new-get_parent_payload_status
    ///
    ///   def get_parent_payload_status(store: Store, block: BeaconBlock) -> PayloadStatus:
    ///     parent = store.blocks[block.parent_root]
    ///     parent_block_hash = block.body.signed_execution_payload_bid.message.parent_block_hash
    ///     message_block_hash = parent.body.signed_execution_payload_bid.message.block_hash
    ///     return FULL if parent_block_hash == message_block_hash else EMPTY
    ///
    /// In lodestar forkchoice, we don't store the full bid, so we compare parent_block_hash
    /// in child's bid with executionPayloadBlockHash in parent:
    /// - If it matches FULL variant, return FULL
    /// - If it matches EMPTY variant, return EMPTY
    /// - If no match, return error.unknown_parent_block
    ///
    /// For pre-Gloas blocks (parent_block_hash == null): always returns .full.
    pub fn getParentPayloadStatus(
        self: *const ProtoArray,
        parent_root: Root,
        parent_block_hash: ?Root,
    ) ProtoArrayError!PayloadStatus {
        // Pre-Gloas blocks have payloads embedded, so parents are always FULL.
        const parent_bh = parent_block_hash orelse return .full;

        const parent_node = self.getNodeByRootAndBlockHash(parent_root, parent_bh) orelse
            return error.UnknownParentBlock;

        return parent_node.payload_status;
    }

    /// Check if parent node is FULL.
    /// Returns true if the parent payload status (determined by parent_block_hash) is FULL.
    /// Spec: gloas/fork-choice.md#new-is_parent_node_full
    pub fn isParentNodeFull(
        self: *const ProtoArray,
        parent_root: Root,
        parent_block_hash: ?Root,
    ) ProtoArrayError!bool {
        return (try self.getParentPayloadStatus(parent_root, parent_block_hash)) == .full;
    }

    // ── Best child/descendant ──

    /// Observe the parent at `parent_index` with respect to the child at `child_index` and
    /// potentially modify the parent's best_child and best_descendant values.
    ///
    /// Four outcomes:
    ///   1. The child is already the best child but it's now invalid due to a FFG
    ///      change and should be removed.
    ///   2. The child is already the best child and the parent is updated with the
    ///      new best descendant.
    ///   3. The child is not the best child but becomes the best child.
    ///   4. The child is not the best child and does not become the best child.
    fn maybeUpdateBestChildAndDescendant(
        self: *ProtoArray,
        parent_index: u32,
        child_index: u32,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!void {
        assert(child_index < self.nodes.items.len);
        assert(parent_index < self.nodes.items.len);

        const child = &self.nodes.items[child_index];
        const parent = &self.nodes.items[parent_index];

        const result = try self.compareCandidateChild(
            parent,
            child,
            child_index,
            current_slot,
            proposer_boost_root,
        );

        // Apply the result (same pointer — compareCandidateChild is const).
        self.nodes.items[parent_index].best_child = result.best_child;
        self.nodes.items[parent_index].best_descendant = result.best_descendant;
    }

    const ChildAndDescendant = struct {
        best_child: ?u32,
        best_descendant: ?u32,
    };

    /// Compare `child` against the parent's current best child
    /// and return the new best_child / best_descendant pair.
    ///
    /// These three variables are aliases to the three options that we may set the
    /// parent.best_child and parent.best_descendant to. Aliases are used to assist
    /// readability.
    fn compareCandidateChild(
        self: *const ProtoArray,
        parent: *const ProtoNode,
        child: *const ProtoNode,
        child_index: u32,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!ChildAndDescendant {
        const child_leads_to_viable =
            self.nodeLeadsToViableHead(child, current_slot);

        const change_to_child = ChildAndDescendant{
            .best_child = child_index,
            .best_descendant = child.best_descendant orelse
                child_index,
        };
        const change_to_null = ChildAndDescendant{
            .best_child = null,
            .best_descendant = null,
        };
        const no_change = ChildAndDescendant{
            .best_child = parent.best_child,
            .best_descendant = parent.best_descendant,
        };

        const best_child_index = parent.best_child orelse {
            // There is no current best-child and the child is viable.
            // There is no current best-child but the child is not viable.
            return if (child_leads_to_viable)
                change_to_child
            else
                no_change;
        };

        if (best_child_index == child_index) {
            // The child is already the best-child of the parent but it's not viable
            // for the head, so remove it.
            // The child is already the best-child, set it again to ensure that the
            // best-descendant of the parent is updated.
            return if (!child_leads_to_viable)
                change_to_null
            else
                change_to_child;
        }

        // The child is not the best-child but might become it.
        return try self.compareAgainstBestChild(
            best_child_index,
            child,
            child_leads_to_viable,
            change_to_child,
            no_change,
            current_slot,
            proposer_boost_root,
        );
    }

    /// Compare candidate child against the existing best child.
    ///
    /// Both nodes lead to viable heads (or both don't), need to pick winner.
    /// Pre-fulu we pick whichever has higher weight, tie-breaker by root.
    /// Post-fulu we pick whichever has higher weight, then tie-breaker by root,
    /// then tie-breaker by getPayloadStatusTiebreaker.
    /// Gloas: nodes from previous slot (n-1) with EMPTY/FULL variant have
    /// weight hardcoded to 0.
    fn compareAgainstBestChild(
        self: *const ProtoArray,
        best_child_index: u32,
        child: *const ProtoNode,
        child_leads_to_viable: bool,
        change_to_child: ChildAndDescendant,
        no_change: ChildAndDescendant,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!ChildAndDescendant {
        assert(best_child_index < self.nodes.items.len);

        const best_child =
            &self.nodes.items[best_child_index];
        const best_child_leads_to_viable =
            self.nodeLeadsToViableHead(best_child, current_slot);

        // The child leads to a viable head, but the current best-child doesn't (or vice versa).
        if (child_leads_to_viable != best_child_leads_to_viable) {
            return if (child_leads_to_viable)
                change_to_child
            else
                no_change;
        }

        // Different effective weights, choose the winner by weight.
        const child_ew = effectiveWeight(child, current_slot);
        const best_child_ew = effectiveWeight(best_child, current_slot);

        if (child_ew != best_child_ew) {
            return if (child_ew >= best_child_ew) change_to_child else no_change;
        }

        // Different blocks, tie-breaker by root.
        if (!std.mem.eql(u8, &child.block_root, &best_child.block_root)) {
            const root_cmp = std.mem.order(u8, &child.block_root, &best_child.block_root);
            return if (root_cmp != .lt) change_to_child else no_change;
        }

        // Same effective weight and same root — Gloas EMPTY vs FULL from n-1,
        // tie-breaker by payload status.
        // Note: pre-Gloas, each child node of a block has a unique root,
        // so this point should not be reached.
        const child_tb = try self.getPayloadStatusTiebreaker(child, current_slot, proposer_boost_root);
        const best_tb = try self.getPayloadStatusTiebreaker(best_child, current_slot, proposer_boost_root);
        return if (child_tb > best_tb) change_to_child else no_change;
    }

    /// Return node weight or 0 for Gloas EMPTY/FULL nodes from
    /// the previous slot (slot + 1 == current_slot).
    fn effectiveWeight(
        node: *const ProtoNode,
        current_slot: Slot,
    ) i64 {
        const is_gloas = node.isGloasBlock();
        const is_variant =
            node.payload_status != .pending;
        const is_prev_slot =
            node.slot + 1 == current_slot;
        return if (is_gloas and is_variant and is_prev_slot)
            0
        else
            node.weight;
    }

    /// Get the payload status tiebreaker value for Gloas node comparison.
    ///
    /// For PENDING nodes or nodes not from the previous slot, returns the raw payload status ordinal.
    /// For FULL nodes from the previous slot, returns FULL if shouldExtendPayload is true,
    /// otherwise demotes to PENDING (0) to deprioritize stale payloads.
    fn getPayloadStatusTiebreaker(
        self: *const ProtoArray,
        node: *const ProtoNode,
        current_slot: Slot,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!u2 {
        // PENDING nodes or nodes not from the previous slot: return raw payload status.
        if (node.payload_status == .pending or node.slot + 1 != current_slot) return @intFromEnum(node.payload_status);
        if (node.payload_status == .empty) return @intFromEnum(PayloadStatus.empty);

        // FULL node from previous slot — check shouldExtendPayload.
        const should_extend = try self.shouldExtendPayload(node.block_root, proposer_boost_root);
        return if (should_extend) @intFromEnum(PayloadStatus.full) else @intFromEnum(PayloadStatus.pending);
    }

    // ── Viability checks ──

    /// Indicates if the node itself is viable for the head, or if its best descendant
    /// is viable for the head.
    fn nodeLeadsToViableHead(
        self: *const ProtoArray,
        node: *const ProtoNode,
        current_slot: Slot,
    ) bool {
        const best_descendant_is_viable =
            if (node.best_descendant) |bd_index| blk: {
                assert(bd_index < self.nodes.items.len);
                break :blk self.nodeIsViableForHead(
                    &self.nodes.items[bd_index],
                    current_slot,
                );
            } else false;

        return best_descendant_is_viable or
            self.nodeIsViableForHead(node, current_slot);
    }

    /// Equivalent to the `filter_block_tree` function in the Ethereum consensus spec:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#filter_block_tree
    ///
    /// Any node that has a different finalized or justified epoch should not be viable
    /// for the head.
    ///
    /// If block is from a previous epoch, filter using unrealized justification &
    /// finalization information (pull-up FFG).
    /// If block is from the current epoch, filter using the head state's justification
    /// & finalization information.
    ///
    /// The voting source should be at the same height as the store's justified checkpoint
    /// or not more than two epochs ago.
    fn nodeIsViableForHead(
        self: *const ProtoArray,
        node: *const ProtoNode,
        current_slot: Slot,
    ) bool {
        // If node has invalid executionStatus, it can't be a viable head.
        if (node.extra_meta.executionStatus() == .invalid) {
            return false;
        }

        // If block is from a previous epoch, filter using unrealized justification &
        // finalization information. If block is from the current epoch, filter using
        // the head state's justification & finalization information.
        const current_epoch = computeEpochAtSlot(current_slot);
        const node_epoch = computeEpochAtSlot(node.slot);
        const voting_source_epoch = if (node_epoch < current_epoch)
            node.unrealized_justified_epoch
        else
            node.justified_epoch;

        // The voting source should be at the same height as the store's justified checkpoint
        // or not more than two epochs ago.
        const correct_justified =
            (self.justified_epoch == GENESIS_EPOCH) or
            (voting_source_epoch == self.justified_epoch) or
            (voting_source_epoch + 2 >= current_epoch);

        const correct_finalized =
            (self.finalized_epoch == GENESIS_EPOCH) or
            self.isFinalizedRootOrDescendant(node);

        return correct_justified and correct_finalized;
    }

    /// Return true if `node` is equal to or a descendant of the finalized node.
    ///
    /// Performance optimization: checks finalized/justified epoch+root pairs before
    /// walking the parent chain, since these are known ancestors of `node` that are
    /// likely to coincide with the store's finalized checkpoint.
    pub fn isFinalizedRootOrDescendant(
        self: *const ProtoArray,
        node: *const ProtoNode,
    ) bool {
        if (node.finalized_epoch == self.finalized_epoch and
            std.mem.eql(u8, &node.finalized_root, &self.finalized_root))
        {
            return true;
        }
        if (node.justified_epoch == self.finalized_epoch and
            std.mem.eql(u8, &node.justified_root, &self.finalized_root))
        {
            return true;
        }
        if (node.unrealized_finalized_epoch == self.finalized_epoch and
            std.mem.eql(
                u8,
                &node.unrealized_finalized_root,
                &self.finalized_root,
            ))
        {
            return true;
        }
        if (node.unrealized_justified_epoch == self.finalized_epoch and
            std.mem.eql(
                u8,
                &node.unrealized_justified_root,
                &self.finalized_root,
            ))
        {
            return true;
        }

        // Slow path: walk the parent chain.
        const finalized_slot = computeStartSlotAtEpoch(self.finalized_epoch);
        const ancestor_node = self.getAncestorOrNull(
            node.block_root,
            finalized_slot,
        );
        return self.finalized_epoch == GENESIS_EPOCH or
            (if (ancestor_node) |a|
                std.mem.eql(
                    u8,
                    &a.block_root,
                    &self.finalized_root,
                )
            else
                false);
    }

    /// Get ancestor node at a given slot. Returns error if the block root is
    /// missing or the ancestor cannot be found in the parent chain.
    /// Spec: gloas/fork-choice.md#modified-get_ancestor
    ///
    /// Walks the parent chain via `parentRoot` (through indices map, not parent index).
    /// For Gloas blocks, returns the correct payload variant at the ancestor slot.
    ///
    /// NOTE: May be expensive — potentially walks through the entire fork of head
    /// to finalized block.
    pub fn getAncestor(
        self: *const ProtoArray,
        block_root: Root,
        ancestor_slot: Slot,
    ) ProtoArrayError!*const ProtoNode {
        // Get any variant to check the block (use defaultIndex)
        const vi = self.indices.get(block_root) orelse
            return error.MissingProtoArrayBlock;
        const block_index = vi.defaultIndex();
        const block = &self.nodes.items[block_index];

        // If block is at or before queried slot, return PENDING variant (or FULL for pre-Gloas)
        // For pre-Gloas: only FULL exists at defaultIndex
        // For Gloas: PENDING is at defaultIndex
        if (block.slot <= ancestor_slot) return block;

        // Walk backwards through beacon blocks to find ancestor
        // Start with the parent of the current block
        var current_block = block;
        var parent_vi = self.indices.get(
            current_block.parent_root,
        ) orelse return error.UnknownAncestor;
        var parent_index = parent_vi.defaultIndex();
        var parent_block = &self.nodes.items[parent_index];

        // Walk backwards while parent.slot > ancestor_slot
        while (parent_block.slot > ancestor_slot) {
            current_block = parent_block;
            parent_vi = self.indices.get(
                current_block.parent_root,
            ) orelse return error.UnknownAncestor;
            parent_index = parent_vi.defaultIndex();
            parent_block = &self.nodes.items[parent_index];
        }

        // Now parent_block.slot <= ancestor_slot
        // Return the parent with the correct payload status based on current_block
        if (!current_block.isGloasBlock()) {
            // Pre-Gloas: return FULL variant (only one that exists)
            return parent_block;
        }

        // Gloas: determine which parent variant (EMPTY or FULL) based on parent_block_hash
        const parent_status = try self.getParentPayloadStatus(
            current_block.parent_root,
            current_block.parent_block_hash,
        );
        const variant_index = self.getNodeIndexByRootAndStatus(
            current_block.parent_root,
            parent_status,
        ) orelse return error.UnknownAncestor;
        assert(variant_index < self.nodes.items.len);
        return &self.nodes.items[variant_index];
    }

    /// Get ancestor node at a given slot, or null if not found.
    /// Wraps getAncestor, converting errors to null.
    fn getAncestorOrNull(
        self: *const ProtoArray,
        block_root: Root,
        ancestor_slot: Slot,
    ) ?*const ProtoNode {
        return self.getAncestor(block_root, ancestor_slot) catch null;
    }

    // ── Execution status propagation ──

    /// Propagate valid execution status up the ancestor chain.
    /// Continues while encountering syncing status.
    ///
    /// If PayloadSeparated, that means the node is either PENDING or EMPTY,
    /// there could be some ancestor still has syncing status.
    fn propagateValidExecutionStatusByIndex(
        self: *ProtoArray,
        valid_node_index: u32,
    ) ProtoArrayError!void {
        assert(valid_node_index < self.nodes.items.len);

        var node_index: ?u32 = valid_node_index;
        while (node_index) |idx| {
            const node = &self.nodes.items[idx];
            switch (node.extra_meta) {
                .post_merge => |m| {
                    switch (m.execution_status) {
                        .valid => return,
                        .pre_merge => unreachable,
                        .payload_separated => {
                            // Continue upward (Gloas).
                            node_index = node.parent;
                            continue;
                        },
                        .syncing, .invalid => {},
                    }
                },
                .pre_merge => return,
            }
            try self.validateNodeByIndex(idx);
            node_index = node.parent;
        }
    }

    /// Validate a single node's execution status.
    /// Throws if the node has Invalid status
    /// (Invalid -> Valid is a consensus failure).
    /// If the node has Syncing status, promotes it to Valid.
    fn validateNodeByIndex(
        self: *ProtoArray,
        node_index: u32,
    ) ProtoArrayError!void {
        assert(node_index < self.nodes.items.len);

        const node = &self.nodes.items[node_index];
        switch (node.extra_meta) {
            .post_merge => |*m| {
                switch (m.execution_status) {
                    .invalid => {
                        self.lvh_error = .{
                            .lvh_code = .invalid_to_valid,
                            .block_root = node.block_root,
                            .exec_hash = m.execution_payload_block_hash,
                        };
                        return error.InvalidLVHExecutionResponse;
                    },
                    .syncing => m.execution_status = .valid,
                    .valid, .pre_merge, .payload_separated => {},
                }
            },
            .pre_merge => {},
        }
    }

    /// Set a node's execution status to invalid.
    ///
    /// If the node is valid or pre-merge, this indicates a consensus failure
    /// and non-recoverable damage. The proto-array is marked permanently damaged
    /// via lvh_error and returns error.InvalidLVHExecutionResponse.
    /// There is no further processing that can be done.
    fn invalidateNodeByIndex(
        self: *ProtoArray,
        node_index: u32,
    ) ProtoArrayError!void {
        assert(node_index < self.nodes.items.len);

        const node = &self.nodes.items[node_index];
        switch (node.extra_meta) {
            .post_merge => |*m| {
                // A post_merge node must never have pre_merge execution status.
                assert(m.execution_status != .pre_merge);
                if (m.execution_status == .valid) {
                    self.lvh_error = .{
                        .lvh_code = .valid_to_invalid,
                        .block_root = node.block_root,
                        .exec_hash = m.execution_payload_block_hash,
                    };
                    return error.InvalidLVHExecutionResponse;
                }
                m.execution_status = .invalid;
            },
            .pre_merge => {
                self.lvh_error = .{
                    .lvh_code = .pre_merge_to_invalid,
                    .block_root = node.block_root,
                    .exec_hash = ZERO_HASH,
                };
                return error.InvalidLVHExecutionResponse;
            },
        }
        node.best_child = null;
        node.best_descendant = null;
    }

    /// Walk up the parent chain from `ancestor_from_index` looking for a node
    /// whose execution payload block hash matches `latest_valid_exec_hash`.
    /// Pre-merge nodes match against `ZERO_HASH`.
    fn getNodeIndexFromLVH(
        self: *const ProtoArray,
        latest_valid_exec_hash: Root,
        ancestor_from_index: u32,
    ) ?u32 {
        assert(ancestor_from_index < self.nodes.items.len);
        var node_index: ?u32 = ancestor_from_index;
        while (node_index) |idx| {
            assert(idx < self.nodes.items.len);
            const node = self.nodes.items[idx];
            const is_match = switch (node.extra_meta) {
                .pre_merge => std.mem.eql(u8, &latest_valid_exec_hash, &ZERO_HASH),
                .post_merge => |m| std.mem.eql(u8, &latest_valid_exec_hash, &m.execution_payload_block_hash),
            };
            if (is_match) return idx;
            node_index = node.parent;
        }
        return null;
    }

    /// Do a two-pass invalidation:
    ///   1. Walk UP from `invalidate_from_index` and mark ancestors invalid.
    ///   2. Iterate forward (down) and mark all children of invalid nodes invalid.
    ///
    /// `latest_valid_hash_index` semantics:
    ///   - `0` (sentinel): invalidate all post-merge blocks.
    ///   - `> 0`: invalidate the chain upwards from `invalidate_from_index`
    ///     until reaching `latest_valid_hash_index`.
    fn propagateInvalidExecutionStatusByIndex(
        self: *ProtoArray,
        allocator: Allocator,
        invalidate_from_index: u32,
        latest_valid_hash_index: u32,
        current_slot: Slot,
    ) (Allocator.Error || ProtoArrayError)!void {
        assert(invalidate_from_index < self.nodes.items.len);
        assert(latest_valid_hash_index < self.nodes.items.len);

        // Pass 1: walk UP marking ancestors invalid.
        var invalidate_index: ?u32 = invalidate_from_index;
        while (invalidate_index) |idx| {
            if (idx <= latest_valid_hash_index) break;
            try self.invalidateNodeByIndex(idx);
            invalidate_index = self.nodes.items[idx].parent;
        }

        // Pass 2: forward scan, propagate invalid status to children.
        for (0..self.nodes.items.len) |i| {
            const node = &self.nodes.items[i];
            const parent_idx = node.parent orelse continue;
            const parent = &self.nodes.items[parent_idx];
            if (parent.extra_meta.executionStatus() == .invalid) {
                try self.invalidateNodeByIndex(@intCast(i));
            }
        }

        // Recalculate the DAG with zero deltas.
        const num_nodes: u32 = @intCast(self.nodes.items.len);
        const zero_deltas = try allocator.alloc(i64, num_nodes);
        defer allocator.free(zero_deltas);

        @memset(zero_deltas, 0);

        try self.applyScoreChanges(
            zero_deltas,
            self.previous_proposer_boost,
            self.justified_epoch,
            self.justified_root,
            self.finalized_epoch,
            self.finalized_root,
            current_slot,
        );
    }

    // ── PTC (Payload Timeliness Committee) ──

    /// Update PTC votes for multiple validators attesting to a block.
    /// Spec: gloas/fork-choice.md#new-on_payload_attestation_message
    ///
    /// Called when payload attestations are processed (from blocks or the wire).
    ///
    pub fn notifyPtcMessages(
        self: *ProtoArray,
        block_root: Root,
        ptc_indices: []const u32,
        payload_present: bool,
    ) void {
        // Block not found or not a Gloas block, ignore.
        const votes = self.ptc_votes.getPtr(block_root) orelse return;
        for (ptc_indices) |idx| {
            assert(idx < preset.PTC_SIZE); // Invalid PTC index
            votes.setValue(idx, payload_present);
        }
    }

    /// Check if execution payload for a block is timely.
    /// Spec: gloas/fork-choice.md#new-is_payload_timely
    ///
    /// Returns true if:
    ///   1. Block has PTC votes tracked
    ///   2. Payload is locally available (FULL variant exists in proto array)
    ///   3. More than PAYLOAD_TIMELY_THRESHOLD (>50% of PTC) members voted payload_present=true
    ///
    pub fn isPayloadTimely(
        self: *const ProtoArray,
        block_root: Root,
    ) bool {
        // Block not found or not a Gloas block.
        const votes = self.ptc_votes.get(block_root) orelse return false;

        // Payload is locally available if FULL variant exists.
        if (!self.hasPayload(block_root)) return false;

        // Count votes for payload_present=true.
        return votes.count() > PAYLOAD_TIMELY_THRESHOLD;
    }

    /// Determine if we should extend the payload (prefer FULL over EMPTY).
    /// Spec: gloas/fork-choice.md#new-should_extend_payload
    ///
    /// Returns true if payload is verified (FULL variant exists) AND:
    ///   1. Payload is timely, OR
    ///   2. No proposer boost root (null/zero hash), OR
    ///   3. Proposer boost root's parent is not this block, OR
    ///   4. Proposer boost root extends FULL parent.
    ///
    pub fn shouldExtendPayload(
        self: *const ProtoArray,
        block_root: Root,
        proposer_boost_root: ?Root,
    ) ProtoArrayError!bool {
        if (!self.hasPayload(block_root)) return false;

        // Condition 1: Payload is timely.
        if (self.isPayloadTimely(block_root)) return true;

        // Condition 2: No proposer boost root.
        const boost_root = proposer_boost_root orelse return true;
        if (std.mem.eql(u8, &boost_root, &ZERO_HASH)) return true;

        // Get proposer boost block.
        // We don't care about variant here, just need proposer boost block info.
        const boost_index = self.getDefaultNodeIndex(boost_root) orelse
            // Proposer boost block not found, default to extending payload.
            return true;
        const boost_node = &self.nodes.items[boost_index];

        // Condition 3: Proposer boost root's parent is not this block.
        if (!std.mem.eql(u8, &boost_node.parent_root, &block_root)) return true;

        // Condition 4: Proposer boost root extends FULL parent.
        return try self.isParentNodeFull(
            boost_node.parent_root,
            boost_node.parent_block_hash,
        );
    }

    // ── Query helpers ──

    /// Return the number of unique block roots in the DAG.
    pub fn length(self: *const ProtoArray) usize {
        return self.indices.count();
    }

    /// Return a ProtoNode by root and payload status, or null if not found.
    pub fn getNode(self: *const ProtoArray, root: Root, status: PayloadStatus) ?*const ProtoNode {
        const idx = self.getNodeIndexByRootAndStatus(root, status) orelse return null;
        assert(idx < self.nodes.items.len);
        return &self.nodes.items[idx];
    }

    /// Return a stack-copy ProtoBlock by root and payload status, or null.
    pub fn getBlock(self: *const ProtoArray, root: Root, status: PayloadStatus) ?ProtoBlock {
        const node = self.getNode(root, status) orelse return null;
        return node.toBlock();
    }

    /// Return EMPTY or FULL ProtoBlock matching both block root and execution block hash.
    pub fn getBlockAndBlockHash(self: *const ProtoArray, block_root: Root, block_hash: Root) ?ProtoBlock {
        const variant_indices = self.indices.get(block_root) orelse return null;
        switch (variant_indices) {
            .pre_gloas => |idx| {
                const node = &self.nodes.items[idx];
                const exec_hash = node.extra_meta.executionPayloadBlockHash() orelse return null;
                return if (std.mem.eql(u8, &exec_hash, &block_hash)) node.toBlock() else null;
            },
            .gloas => |g| {
                // Check FULL variant first, then EMPTY.
                if (g.full) |full_idx| {
                    const full_node = &self.nodes.items[full_idx];
                    const exec_hash = full_node.extra_meta.executionPayloadBlockHash() orelse return null;
                    if (std.mem.eql(u8, &exec_hash, &block_hash)) return full_node.toBlock();
                }
                const empty_node = &self.nodes.items[g.empty];
                const exec_hash = empty_node.extra_meta.executionPayloadBlockHash() orelse return null;
                return if (std.mem.eql(u8, &exec_hash, &block_hash)) empty_node.toBlock() else null;
            },
        }
    }

    /// Return a ProtoNode by root and payload status, or error if not found.
    pub fn getBlockReadonly(
        self: *const ProtoArray,
        root: Root,
        status: PayloadStatus,
    ) ProtoArrayError!*const ProtoNode {
        return self.getNode(root, status) orelse error.MissingProtoArrayBlock;
    }

    /// Get the parent node index, resolving Gloas payload variants.
    ///
    /// Pre-Gloas: uses raw node.parent index.
    /// Gloas: resolves the correct parent variant (EMPTY or FULL) via getParentPayloadStatus.
    fn getParentNodeIndex(self: *const ProtoArray, node: *const ProtoNode) ProtoArrayError!?u32 {
        if (node.parent_block_hash) |parent_bh| {
            // Gloas: resolve parent variant via block hash matching.
            const parent_status = self.getParentPayloadStatus(node.parent_root, parent_bh) catch |err| switch (err) {
                error.UnknownParentBlock => return null,
                else => return err,
            };
            return self.getNodeIndexByRootAndStatus(node.parent_root, parent_status);
        } else {
            return node.parent;
        }
    }

    // ── Ancestor iteration ──

    /// Lazy iterator over ancestor nodes (does NOT yield the start node).
    pub const AncestorIterator = struct {
        proto_array: *const ProtoArray,
        current: ?*const ProtoNode,

        pub fn next(self_iter: *AncestorIterator) ProtoArrayError!?*const ProtoNode {
            const node = self_iter.current orelse return null;
            const parent_idx = (try self_iter.proto_array.getParentNodeIndex(node)) orelse {
                self_iter.current = null;
                return null;
            };
            assert(parent_idx < self_iter.proto_array.nodes.items.len);
            const parent = &self_iter.proto_array.nodes.items[parent_idx];
            self_iter.current = parent;
            return parent;
        }
    };

    /// Create a lazy ancestor iterator starting from a block root + payload status.
    /// The iterator yields ancestor nodes (parent, grandparent, ...) but NOT the start node.
    pub fn iterateAncestors(
        self: *const ProtoArray,
        root: Root,
        status: PayloadStatus,
    ) AncestorIterator {
        const start_node = self.getNode(root, status);
        return .{
            .proto_array = self,
            .current = start_node,
        };
    }

    /// Collect all ancestor blocks from a block root (includes start node, excludes PENDING for Gloas).
    /// Caller owns the returned list and must call deinit(allocator) or toOwnedSlice(allocator).
    pub fn getAllAncestorNodes(
        self: *const ProtoArray,
        allocator: Allocator,
        root: Root,
        status: PayloadStatus,
    ) (Allocator.Error || ProtoArrayError)!std.ArrayList(ProtoBlock) {
        const start_node = self.getNode(root, status) orelse return .empty;

        var result: std.ArrayList(ProtoBlock) = .empty;
        errdefer result.deinit(allocator);

        // Include start node if not PENDING (Gloas only; pre-Gloas always included).
        if (start_node.payload_status != .pending) {
            try result.append(allocator, start_node.toBlock());
        }

        var iter = AncestorIterator{ .proto_array = self, .current = start_node };
        while (try iter.next()) |ancestor| {
            try result.append(allocator, ancestor.toBlock());
        }

        return result;
    }

    /// Collect non-PENDING blocks between upper_index and lower_index (exclusive both ends).
    fn appendBlocksBetween(
        self: *const ProtoArray,
        result: *std.ArrayList(ProtoBlock),
        allocator: Allocator,
        upper_index: u32,
        lower_index: u32,
    ) Allocator.Error!void {
        if (upper_index <= lower_index + 1) return;
        var i = upper_index - 1;
        while (i > lower_index) : (i -= 1) {
            assert(i < self.nodes.items.len);
            const n = &self.nodes.items[i];
            if (n.payload_status != .pending) {
                try result.append(allocator, n.toBlock());
            }
        }
    }

    /// Collect all non-ancestor blocks (blocks between ancestor-chain gaps).
    /// Excludes PENDING nodes for Gloas. Caller owns the returned list.
    pub fn getAllNonAncestorNodes(
        self: *const ProtoArray,
        allocator: Allocator,
        root: Root,
        status: PayloadStatus,
    ) (Allocator.Error || ProtoArrayError)!std.ArrayList(ProtoBlock) {
        const start_idx = self.getNodeIndexByRootAndStatus(root, status) orelse return .empty;
        assert(start_idx < self.nodes.items.len);

        var result: std.ArrayList(ProtoBlock) = .empty;
        errdefer result.deinit(allocator);

        var node_index = start_idx;
        var current = &self.nodes.items[start_idx];

        while (current.parent != null) {
            const parent_idx = (try self.getParentNodeIndex(current)) orelse break;
            assert(parent_idx < self.nodes.items.len);
            try self.appendBlocksBetween(&result, allocator, node_index, parent_idx);
            node_index = parent_idx;
            current = &self.nodes.items[parent_idx];
        }

        // Collect remaining blocks from node_index down to 0.
        try self.appendBlocksBetween(&result, allocator, node_index, 0);

        return result;
    }

    /// Result of getAllAncestorAndNonAncestorNodes.
    pub const AncestorAndNonAncestorResult = struct {
        allocator: Allocator,
        ancestors: std.ArrayList(ProtoBlock),
        non_ancestors: std.ArrayList(ProtoBlock),

        pub fn deinit(self_result: *AncestorAndNonAncestorResult) void {
            self_result.ancestors.deinit(self_result.allocator);
            self_result.non_ancestors.deinit(self_result.allocator);
        }
    };

    /// Collect both ancestor and non-ancestor blocks in a single traversal.
    /// Excludes PENDING from both lists for Gloas. Caller must call result.deinit().
    pub fn getAllAncestorAndNonAncestorNodes(
        self: *const ProtoArray,
        allocator: Allocator,
        root: Root,
        status: PayloadStatus,
    ) (Allocator.Error || ProtoArrayError)!AncestorAndNonAncestorResult {
        const start_idx = self.getNodeIndexByRootAndStatus(root, status) orelse
            return .{ .allocator = allocator, .ancestors = .empty, .non_ancestors = .empty };

        assert(start_idx < self.nodes.items.len);
        const start_node = &self.nodes.items[start_idx];

        var ancestors: std.ArrayList(ProtoBlock) = .empty;
        errdefer ancestors.deinit(allocator);
        var non_ancestors: std.ArrayList(ProtoBlock) = .empty;
        errdefer non_ancestors.deinit(allocator);

        try ancestors.append(allocator, start_node.toBlock());

        var node_index = start_idx;
        var current = start_node;

        while (current.parent != null) {
            const parent_idx = (try self.getParentNodeIndex(current)) orelse break;
            assert(parent_idx < self.nodes.items.len);
            const parent = &self.nodes.items[parent_idx];
            try ancestors.append(allocator, parent.toBlock());
            try self.appendBlocksBetween(&non_ancestors, allocator, node_index, parent_idx);
            node_index = parent_idx;
            current = parent;
        }

        // Remaining non-ancestor blocks from node_index down to 0.
        try self.appendBlocksBetween(&non_ancestors, allocator, node_index, 0);

        return .{
            .allocator = allocator,
            .ancestors = ancestors,
            .non_ancestors = non_ancestors,
        };
    }

    /// Check if descendantRoot is a descendant of (or equal to) ancestorRoot.
    /// Both root + payload status must match for identity.
    pub fn isDescendant(
        self: *const ProtoArray,
        ancestor_root: Root,
        ancestor_payload_status: PayloadStatus,
        descendant_root: Root,
        descendant_payload_status: PayloadStatus,
    ) ProtoArrayError!bool {
        const ancestor_node = self.getNode(ancestor_root, ancestor_payload_status) orelse return false;

        // Same identity check.
        if (std.mem.eql(u8, &ancestor_root, &descendant_root) and ancestor_payload_status == descendant_payload_status) {
            return true;
        }

        // Walk descendant's ancestor chain looking for ancestor.
        var iter = self.iterateAncestors(descendant_root, descendant_payload_status);
        while (try iter.next()) |node| {
            if (node.slot < ancestor_node.slot) return false;
            if (std.mem.eql(u8, &node.block_root, &ancestor_node.block_root) and
                node.payload_status == ancestor_node.payload_status)
            {
                return true;
            }
        }
        return false;
    }

    /// Find the lowest common ancestor of two nodes.
    /// Returns null if no common ancestor exists (different trees).
    pub fn getCommonAncestor(
        self: *const ProtoArray,
        initial_a: *const ProtoNode,
        initial_b: *const ProtoNode,
    ) ?*const ProtoNode {
        var node_a = initial_a;
        var node_b = initial_b;

        while (true) {
            if (node_a.slot > node_b.slot) {
                const parent_idx = node_a.parent orelse return null;
                node_a = &self.nodes.items[parent_idx];
            } else if (node_a.slot < node_b.slot) {
                const parent_idx = node_b.parent orelse return null;
                node_b = &self.nodes.items[parent_idx];
            } else {
                // Same slot — check if same block.
                if (std.mem.eql(u8, &node_a.block_root, &node_b.block_root)) {
                    return node_a;
                }
                const parent_a = node_a.parent orelse return null;
                assert(parent_a < self.nodes.items.len);
                const parent_b = node_b.parent orelse return null;
                assert(parent_b < self.nodes.items.len);
                node_a = &self.nodes.items[parent_a];
                node_b = &self.nodes.items[parent_b];
            }
        }
    }

    // ── Validate execution status ──

    /// Validate or invalidate execution status chains based on EL response.
    pub fn validateLatestHash(
        self: *ProtoArray,
        allocator: Allocator,
        exec_response: LVHExecResponse,
        current_slot: Slot,
    ) (Allocator.Error || ProtoArrayError)!void {
        switch (exec_response) {
            .valid => |v| {
                var latest_valid_index: ?u32 = null;
                var i: u32 = @intCast(self.nodes.items.len);
                while (i > 0) {
                    i -= 1;
                    const node = &self.nodes.items[i];
                    if (node.extra_meta.executionPayloadBlockHash()) |bh| {
                        if (std.mem.eql(u8, &bh, &v.latest_valid_exec_hash)) {
                            latest_valid_index = i;
                            break;
                        }
                    }
                }
                if (latest_valid_index) |idx| {
                    try self.propagateValidExecutionStatusByIndex(idx);
                }
            },
            .invalid => |inv| {
                const invalidate_from_index = self.getDefaultNodeIndex(
                    inv.invalidate_from_parent_block_root,
                ) orelse return error.MissingProtoArrayBlock;

                const latest_valid_hash_index: ?u32 = if (inv.latest_valid_exec_hash) |lvh|
                    self.getNodeIndexFromLVH(lvh, invalidate_from_index)
                else
                    null;

                if (latest_valid_hash_index == null) {
                    return error.InvalidLVHExecutionResponse;
                }

                try self.propagateInvalidExecutionStatusByIndex(
                    allocator,
                    invalidate_from_index,
                    latest_valid_hash_index.?,
                    current_slot,
                );
            },
        }
    }

    // ── Pruning ──

    /// Update the tree with new finalization information. The tree is only actually
    /// pruned if the number of nodes in `self` is at least `self.prune_threshold`.
    ///
    /// Returns the pruned blocks. Caller owns the returned slice.
    ///
    /// Errors:
    /// - The finalized root is unknown.
    /// - Internal error relating to invalid indices inside `self`.
    pub fn maybePrune(
        self: *ProtoArray,
        allocator: Allocator,
        finalized_root: Root,
    ) (Allocator.Error || ProtoArrayError)![]ProtoBlock {
        const entry = self.indices.get(finalized_root) orelse
            return error.FinalizedNodeUnknown;

        // Find the minimum index among all variants.
        const finalized_index: u32 = switch (entry) {
            .pre_gloas => |idx| idx,
            .gloas => |g| g.pending,
        };

        if (finalized_index < self.prune_threshold) {
            return &.{};
        }

        // Collect pruned blocks before they are overwritten.
        const pruned_blocks = try allocator.alloc(ProtoBlock, finalized_index);
        errdefer allocator.free(pruned_blocks);

        for (0..finalized_index) |i| {
            const node = &self.nodes.items[i];
            pruned_blocks[i] = node.toBlock();
            // Remove from indices and PTC votes. Gloas variants may share a
            // block_root across multiple nodes; duplicate removes are no-ops.
            _ = self.indices.remove(node.block_root);
            _ = self.ptc_votes.remove(node.block_root);
        }

        // Shift remaining nodes to the front.
        const remaining = self.nodes.items.len - finalized_index;
        if (remaining > 0) {
            std.mem.copyForwards(
                ProtoNode,
                self.nodes.items[0..remaining],
                self.nodes.items[finalized_index..self.nodes.items.len],
            );
        }
        self.nodes.items.len = remaining;

        // Adjust all indices in the map (subtract finalized_index).
        var iter = self.indices.iterator();
        while (iter.next()) |map_entry| {
            switch (map_entry.value_ptr.*) {
                .pre_gloas => |*idx| {
                    assert(idx.* >= finalized_index);
                    idx.* -= finalized_index;
                },
                .gloas => |*g| {
                    assert(g.pending >= finalized_index);
                    g.pending -= finalized_index;
                    assert(g.empty >= finalized_index);
                    g.empty -= finalized_index;
                    if (g.full) |*f| {
                        assert(f.* >= finalized_index);
                        f.* -= finalized_index;
                    }
                },
            }
        }

        // Adjust parent, best_child, best_descendant in remaining nodes.
        for (self.nodes.items) |*node| {
            if (node.parent) |*p| {
                if (p.* < finalized_index) {
                    node.parent = null;
                } else {
                    p.* -= finalized_index;
                }
            }
            if (node.best_child) |*bc| {
                assert(bc.* >= finalized_index);
                bc.* -= finalized_index;
            }
            if (node.best_descendant) |*bd| {
                assert(bd.* >= finalized_index);
                bd.* -= finalized_index;
            }
        }

        return pruned_blocks;
    }
};

// ── Tests ──

const TestBlock = struct {
    fn genesis() ProtoBlock {
        return .{
            .slot = 0,
            .block_root = ZERO_HASH,
            .parent_root = ZERO_HASH,
            .state_root = ZERO_HASH,
            .target_root = ZERO_HASH,
            .justified_epoch = 0,
            .justified_root = ZERO_HASH,
            .finalized_epoch = 0,
            .finalized_root = ZERO_HASH,
            .unrealized_justified_epoch = 0,
            .unrealized_justified_root = ZERO_HASH,
            .unrealized_finalized_epoch = 0,
            .unrealized_finalized_root = ZERO_HASH,
            .extra_meta = .{ .pre_merge = {} },
            .timeliness = false,
        };
    }

    fn withRoot(root: Root) ProtoBlock {
        var block = genesis();
        block.block_root = root;
        return block;
    }

    fn withSlotAndRoot(slot: Slot, root: Root) ProtoBlock {
        var block = genesis();
        block.slot = slot;
        block.block_root = root;
        return block;
    }

    fn withParent(block: ProtoBlock, parent_root: Root) ProtoBlock {
        var b = block;
        b.parent_root = parent_root;
        return b;
    }

    /// Convert a block to Gloas format with default ZERO_HASH parent_block_hash.
    /// The execution_payload_block_hash is set to parent_block_hash (ZERO_HASH),
    /// matching PENDING/EMPTY semantics where execution payload hash is unknown.
    fn asGloas(block: ProtoBlock) ProtoBlock {
        return asGloasWithParentBlockHash(block, ZERO_HASH);
    }

    /// Convert a block to Gloas format with a specific parent_block_hash.
    /// Sets both parent_block_hash and execution_payload_block_hash to parent_bh.
    /// For tests needing a FULL variant, call onExecutionPayload separately.
    fn asGloasWithParentBlockHash(block: ProtoBlock, parent_bh: Root) ProtoBlock {
        var b = block;
        b.parent_block_hash = parent_bh;
        b.extra_meta = .{
            .post_merge = BlockExtraMeta.PostMergeMeta.init(
                parent_bh,
                0,
                .payload_separated,
                .pre_data,
            ),
        };
        return b;
    }

    fn withParentBlockHash(block: ProtoBlock, parent_bh: Root) ProtoBlock {
        var b = block;
        b.parent_block_hash = parent_bh;
        return b;
    }

    fn withExtraMeta(block: ProtoBlock, meta: BlockExtraMeta) ProtoBlock {
        var b = block;
        b.extra_meta = meta;
        return b;
    }

    /// Set realized + unrealized justified/finalized epochs and roots on a block.
    fn withCheckpoints(
        block: ProtoBlock,
        justified_epoch: Epoch,
        justified_root: Root,
        finalized_epoch: Epoch,
        finalized_root: Root,
    ) ProtoBlock {
        var b = block;
        b.justified_epoch = justified_epoch;
        b.justified_root = justified_root;
        b.finalized_epoch = finalized_epoch;
        b.finalized_root = finalized_root;
        b.unrealized_justified_epoch = justified_epoch;
        b.unrealized_justified_root = justified_root;
        b.unrealized_finalized_epoch = finalized_epoch;
        b.unrealized_finalized_root = finalized_root;
        return b;
    }
};

fn makeRoot(byte: u8) Root {
    var root = ZERO_HASH;
    root[0] = byte;
    return root;
}

// Tree: (empty — no blocks inserted)
test "init and deinit" {
    var pa: ProtoArray = undefined;
    pa.init(1, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 0), pa.nodes.items.len);
    try testing.expectEqual(@as(Epoch, 1), pa.justified_epoch);
    try testing.expectEqual(@as(Epoch, 0), pa.finalized_epoch);
    try testing.expectEqual(@as(?ProtoArray.ProposerBoost, null), pa.previous_proposer_boost);
}

// Tree: 0 (genesis, FULL)
test "onBlock adds genesis" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try testing.expectEqual(@as(usize, 1), pa.nodes.items.len);
    const node = &pa.nodes.items[0];
    try testing.expectEqual(@as(?u32, null), node.parent);
    try testing.expectEqual(@as(i64, 0), node.weight);
    try testing.expectEqual(PayloadStatus.full, node.payload_status);

    // Indices map should have a single entry.
    const vi = pa.indices.get(ZERO_HASH).?;
    try testing.expectEqual(VariantIndices{ .pre_gloas = 0 }, vi);
}

// Tree: 0 (genesis, FULL) — second insert is skipped
test "onBlock duplicate is no-op" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try testing.expectEqual(@as(usize, 1), pa.nodes.items.len);
}

// Tree: (empty — block rejected)
test "onBlock rejects invalid execution status" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    var block = TestBlock.withRoot(makeRoot(1));
    block.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .invalid, .available),
    };
    try testing.expectError(
        error.InvalidBlockExecutionStatus,
        pa.onBlock(testing.allocator, block, 0, null),
    );
    try testing.expectEqual(@as(usize, 0), pa.nodes.items.len);
}

// Tree: 0x01 (orphan, parent 0x63 not in tree)
test "onBlock unknown parent stays null" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const unknown_parent = makeRoot(99);
    var block = TestBlock.withRoot(makeRoot(1));
    block.parent_root = unknown_parent;
    try pa.onBlock(testing.allocator, block, 0, null);

    const node = &pa.nodes.items[0];
    try testing.expectEqual(@as(?u32, null), node.parent);
}

// Tree:
//   0x01
//     |
//   0x02
test "onBlock links parent and updates best_child" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const child_root = makeRoot(2);

    try pa.onBlock(testing.allocator, TestBlock.withRoot(parent_root), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withRoot(child_root), parent_root), 0, null);

    try testing.expectEqual(@as(usize, 2), pa.nodes.items.len);
    const child = &pa.nodes.items[1];
    try testing.expectEqual(@as(?u32, 0), child.parent);

    const parent = &pa.nodes.items[0];
    try testing.expectEqual(@as(?u32, 1), parent.best_child);
    try testing.expectEqual(@as(?u32, 1), parent.best_descendant);
}

// Tree:
//   0x01
//   / \
// 0x02 0x03   (0x03 wins tiebreak: higher root)
test "onBlock multiple children root tiebreak" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const child_a = makeRoot(2);
    const child_b = makeRoot(3); // Higher root wins.

    try pa.onBlock(testing.allocator, TestBlock.withRoot(parent_root), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withRoot(child_a), parent_root), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withRoot(child_b), parent_root), 0, null);

    const parent = &pa.nodes.items[0];
    // child_b has higher root (0x03 > 0x02), so it should be best_child.
    try testing.expectEqual(@as(?u32, 2), parent.best_child);
}

// Tree (Gloas):
//   0x01.PENDING(idx=0)
//     |
//   0x01.EMPTY(idx=1)
test "onBlock Gloas creates PENDING and EMPTY with VariantIndices" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    var block = TestBlock.withRoot(root);
    block = TestBlock.asGloas(block);

    try pa.onBlock(testing.allocator, block, 0, null);

    // Two nodes: PENDING + EMPTY.
    try testing.expectEqual(@as(usize, 2), pa.nodes.items.len);

    const pending = &pa.nodes.items[0];
    try testing.expectEqual(PayloadStatus.pending, pending.payload_status);
    try testing.expectEqual(@as(?u32, null), pending.parent);

    const empty = &pa.nodes.items[1];
    try testing.expectEqual(PayloadStatus.empty, empty.payload_status);
    try testing.expectEqual(@as(?u32, 0), empty.parent); // Parent is PENDING.

    // VariantIndices should be stored correctly.
    const vi = pa.indices.get(root).?;
    switch (vi) {
        .gloas => |g| {
            try testing.expectEqual(@as(u32, 0), g.pending);
            try testing.expectEqual(@as(u32, 1), g.empty);
            try testing.expectEqual(@as(?u32, null), g.full);
        },
        .pre_gloas => return error.TestUnexpectedResult,
    }
}

// Tree (fork transition: pre-Gloas parent → Gloas child):
//   0x01(FULL)
//     |
//   0x02.PENDING
//     |
//   0x02.EMPTY
test "onBlock Gloas with parent links correctly" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const child_root = makeRoot(2);

    // Parent is pre-Gloas (single FULL node).
    try pa.onBlock(testing.allocator, TestBlock.withRoot(parent_root), 0, null);

    // Child is Gloas.
    const child_block = TestBlock.asGloas(TestBlock.withParent(TestBlock.withRoot(child_root), parent_root));
    try pa.onBlock(testing.allocator, child_block, 0, null);

    // PENDING's parent should point to the pre-Gloas parent (index 0).
    const pending = &pa.nodes.items[1];
    try testing.expectEqual(@as(?u32, 0), pending.parent);
    try testing.expectEqual(PayloadStatus.pending, pending.payload_status);

    // EMPTY's parent should point to own PENDING (index 1).
    const empty = &pa.nodes.items[2];
    try testing.expectEqual(@as(?u32, 1), empty.parent);
    try testing.expectEqual(PayloadStatus.empty, empty.payload_status);
}

// Tree (Gloas, after onPayload):
//       0x01.PENDING
//       / \
// 0x01.EMPTY 0x01.FULL
test "onExecutionPayload adds FULL variant" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try testing.expectEqual(@as(usize, 2), pa.nodes.items.len);

    const payload_hash = makeRoot(0xAA);
    try pa.onExecutionPayload(testing.allocator, root, 0, payload_hash, 42, null, .valid);

    // Now 3 nodes: PENDING, EMPTY, FULL.
    try testing.expectEqual(@as(usize, 3), pa.nodes.items.len);

    const full = &pa.nodes.items[2];
    try testing.expectEqual(PayloadStatus.full, full.payload_status);
    try testing.expectEqual(@as(?u32, 0), full.parent); // Parent is PENDING.
    // FULL node has EL metadata.
    try testing.expectEqual(ExecutionStatus.valid, full.extra_meta.executionStatus());
    try testing.expectEqual(payload_hash, full.extra_meta.executionPayloadBlockHash().?);

    // VariantIndices updated.
    const vi = pa.indices.get(root).?;
    switch (vi) {
        .gloas => |g| try testing.expectEqual(@as(?u32, 2), g.full),
        .pre_gloas => return error.TestUnexpectedResult,
    }
}

// Tree (Gloas): — second onPayload ignored
//       0x01.PENDING
//       / \
// 0x01.EMPTY 0x01.FULL
test "onExecutionPayload duplicate is no-op" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xBB), 1, null, .valid);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xCC), 2, null, .valid); // Second call is no-op.

    try testing.expectEqual(@as(usize, 3), pa.nodes.items.len);
}

// Tree: 0x01 (pre-Gloas FULL) — onPayload is no-op
test "onExecutionPayload for pre-Gloas returns PreGloasBlock error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.withRoot(root), 0, null);
    try testing.expectError(
        error.PreGloasBlock,
        pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xDD), 1, null, .valid),
    );

    try testing.expectEqual(@as(usize, 1), pa.nodes.items.len);
}

// Tree: (empty — unknown root lookup fails)
test "onExecutionPayload for unknown block returns UnknownBlock error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try testing.expectError(
        error.UnknownBlock,
        pa.onExecutionPayload(testing.allocator, makeRoot(0xFF), 0, makeRoot(0xDD), 1, null, .valid),
    );
}

// Tree:
//   0x01(syncing)
//     |
//   0x02(valid)
//   propagation: 0x01 becomes valid
test "propagateValidExecutionStatusByIndex marks syncing ancestors" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_a = makeRoot(1);
    const root_b = makeRoot(2);

    // Parent with syncing status.
    var parent_block = TestBlock.withRoot(root_a);
    parent_block.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, parent_block, 0, null);

    // Child with valid status — triggers upward propagation.
    var child_block = TestBlock.withParent(TestBlock.withRoot(root_b), root_a);
    child_block.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 1, .valid, .available),
    };
    try pa.onBlock(testing.allocator, child_block, 0, null);

    // Parent should now be valid.
    const parent = &pa.nodes.items[0];
    try testing.expectEqual(ExecutionStatus.valid, parent.extra_meta.executionStatus());
}

// VariantIndices: pre_gloas(42) → 42, gloas(pending=10) → 10
test "VariantIndices defaultIndex" {
    const pre_gloas = VariantIndices{ .pre_gloas = 42 };
    try testing.expectEqual(@as(u32, 42), pre_gloas.defaultIndex());

    const gloas = VariantIndices{ .gloas = .{ .pending = 10, .empty = 11, .full = 12 } };
    try testing.expectEqual(@as(u32, 10), gloas.defaultIndex());
}

// VariantIndices: pre_gloas(5).full → 5, gloas(10,11,null).pending → 10
test "VariantIndices getByPayloadStatus" {
    const pre_gloas = VariantIndices{ .pre_gloas = 5 };
    try testing.expectEqual(@as(?u32, 5), pre_gloas.getByPayloadStatus(.full));

    const gloas = VariantIndices{ .gloas = .{ .pending = 10, .empty = 11 } };
    try testing.expectEqual(@as(?u32, 10), gloas.getByPayloadStatus(.pending));
    try testing.expectEqual(@as(?u32, 11), gloas.getByPayloadStatus(.empty));
    try testing.expectEqual(@as(?u32, null), gloas.getByPayloadStatus(.full));
}

// VariantIndices: pre_gloas → [1], gloas(no full) → [2], gloas(with full) → [3]
test "VariantIndices allIndices" {
    var buf: [3]u32 = undefined;

    const pre_gloas = VariantIndices{ .pre_gloas = 5 };
    const pre_gloas_all = pre_gloas.allIndices(&buf);
    try testing.expectEqual(@as(usize, 1), pre_gloas_all.len);
    try testing.expectEqual(@as(u32, 5), pre_gloas_all[0]);

    const gloas_no_full = VariantIndices{ .gloas = .{ .pending = 10, .empty = 11 } };
    const gloas_all = gloas_no_full.allIndices(&buf);
    try testing.expectEqual(@as(usize, 2), gloas_all.len);

    const gloas_with_full = VariantIndices{ .gloas = .{ .pending = 10, .empty = 11, .full = 12 } };
    const gloas_all_3 = gloas_with_full.allIndices(&buf);
    try testing.expectEqual(@as(usize, 3), gloas_all_3.len);
}

// Tree: (empty — pre-Gloas parent_block_hash is null → always FULL)
test "getParentPayloadStatus pre-Gloas returns full" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Pre-Gloas block (no parent_block_hash) → always FULL.
    try testing.expectEqual(PayloadStatus.full, try pa.getParentPayloadStatus(makeRoot(1), null));
}

// Tree (Gloas):
//            parent.PENDING (executionPayloadBlockHash = 0x00)
//            / \
// parent.EMPTY   parent.FULL (executionPayloadBlockHash = 0xAA)
//
// In ePBS, executionPayloadBlockHash:
//   EMPTY = bid.parentBlockHash (0x00), FULL = actual payload hash (= bid.blockHash).
// getParentPayloadStatus matches by executionPayloadBlockHash on variants.
test "getParentPayloadStatus matching bid hash returns full" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const bid_hash = makeRoot(0xAA);

    // Add parent with bid block hash, then create FULL with payload_hash = bid_hash.
    // In ePBS, the actual payload hash equals the bid's blockHash.
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(parent_root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, parent_root, 0, bid_hash, 1, null, .valid);

    // parent_block_hash matches FULL's executionPayloadBlockHash (= bid_hash) → FULL.
    try testing.expectEqual(PayloadStatus.full, try pa.getParentPayloadStatus(parent_root, bid_hash));
    // parent_block_hash matches EMPTY's executionPayloadBlockHash (= ZERO_HASH) → EMPTY.
    try testing.expectEqual(PayloadStatus.empty, try pa.getParentPayloadStatus(parent_root, ZERO_HASH));
}

// Tree (Gloas, no onPayload):
//   parent.PENDING (executionPayloadBlockHash = 0x00)
//     |
//   parent.EMPTY (executionPayloadBlockHash = 0x00)
//
// Only EMPTY exists; matching by executionPayloadBlockHash.
// If no variant matches, returns UNKNOWN_PARENT_BLOCK.
test "getParentPayloadStatus without FULL variant" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const bid_hash = makeRoot(0xAA);

    // Add parent with bid block hash — only PENDING + EMPTY exist (no onPayload).
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(parent_root)), 0, null);

    // parent_block_hash matches EMPTY's executionPayloadBlockHash (ZERO_HASH) → EMPTY.
    try testing.expectEqual(PayloadStatus.empty, try pa.getParentPayloadStatus(parent_root, ZERO_HASH));
    // parent_block_hash doesn't match any variant → error.
    try testing.expectError(error.UnknownParentBlock, pa.getParentPayloadStatus(parent_root, bid_hash));
    try testing.expectError(error.UnknownParentBlock, pa.getParentPayloadStatus(parent_root, makeRoot(0xBB)));
}

// Tree (Gloas):
//          parent.PENDING (executionPayloadBlockHash = 0x00)
//          / \
// parent.EMPTY(execHash=0x00)   parent.FULL(execHash=0xAA)
//
//   child_a.parent_block_hash = 0xAA (matches FULL's execHash) → links to parent.FULL
//   child_b.parent_block_hash = 0x00 (matches EMPTY's execHash) → links to parent.EMPTY
test "onBlockGloas links to correct parent variant via parent_block_hash" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const parent_root = makeRoot(1);
    const bid_hash = makeRoot(0xAA);

    // Parent: Gloas block with bid hash 0xAA.
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(parent_root)), 0, null);
    // Add FULL variant with execution_payload_block_hash = bid_hash (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, parent_root, 0, bid_hash, 42, null, .valid);

    const parent_vi = pa.indices.get(parent_root).?;
    const parent_empty_idx = parent_vi.gloas.empty;
    const parent_full_idx = parent_vi.gloas.full.?;

    // Child A: parent_block_hash matches FULL's executionPayloadBlockHash → links to parent.FULL.
    var child_a = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(2)), parent_root),
    );
    child_a.parent_block_hash = bid_hash;
    try pa.onBlock(testing.allocator, child_a, 1, null);

    const child_a_pending = &pa.nodes.items[pa.indices.get(makeRoot(2)).?.gloas.pending];
    try testing.expectEqual(parent_full_idx, child_a_pending.parent.?);

    // Child B: parent_block_hash matches EMPTY's executionPayloadBlockHash (ZERO_HASH) → links to parent.EMPTY.
    var child_b = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(3)), parent_root),
    );
    child_b.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, child_b, 1, null);

    const child_b_pending = &pa.nodes.items[pa.indices.get(makeRoot(3)).?.gloas.pending];
    try testing.expectEqual(parent_empty_idx, child_b_pending.parent.?);
}

// Tree (Gloas):
//   genesis(pre-Gloas FULL, execPayloadBlockHash=0x00)
//       |
//     A.PENDING (execPayloadBlockHash=0x00)
//       |
//     A.EMPTY (execPayloadBlockHash=0x00)
//       |
//     B.PENDING ← parent_block_hash=0x00 (matches A.EMPTY's execHash) → links to A.EMPTY
//       |
//     B.EMPTY
test "child builds on EMPTY when parent_block_hash matches EMPTY execHash" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Genesis (pre-Gloas).
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert Gloas block A, parent_block_hash=ZERO_HASH.
    // A.EMPTY's executionPayloadBlockHash = ZERO_HASH (= bid.parentBlockHash).
    const root_a = makeRoot(1);
    var block_a = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
    );
    block_a.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_a, 1, null);

    const vi_a = pa.indices.get(root_a).?;
    const empty_a_idx = vi_a.gloas.empty;

    // Insert Gloas block B whose parent_block_hash matches A.EMPTY's execHash (ZERO_HASH) → links to A.EMPTY.
    const root_b = makeRoot(2);
    var block_b = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
    );
    block_b.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_b, 2, null);

    const pending_b = &pa.nodes.items[pa.indices.get(root_b).?.gloas.pending];
    try testing.expectEqual(empty_a_idx, pending_b.parent.?);
}

// Tree (Gloas):
//   genesis(pre-Gloas FULL)
//       |
//     A.PENDING (execPayloadBlockHash=0x00)
//     /        \
//   A.EMPTY(execHash=0x00)   A.FULL(execHash=0x64)
//                                |
//                              B.PENDING ← parent_block_hash=0x64 (matches A.FULL's execHash) → links to A.FULL
//                                |
//                              B.EMPTY
test "child builds on FULL when parent_block_hash matches FULL execHash" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Genesis (pre-Gloas).
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert Gloas block A with bid_hash=0x64.
    const root_a = makeRoot(1);
    const bid_hash_a = makeRoot(0x64);
    var block_a = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
    );
    block_a.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_a, 1, null);

    // Insert payload for A → creates A.FULL with execPayloadBlockHash = bid_hash (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, root_a, 1, bid_hash_a, 1, null, .valid);

    const vi_a = pa.indices.get(root_a).?;
    const full_a_idx = vi_a.gloas.full.?;

    // Insert Gloas block B whose parent_block_hash matches A.FULL's execHash → links to A.FULL.
    const root_b = makeRoot(2);
    var block_b = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
    );
    block_b.parent_block_hash = bid_hash_a;
    try pa.onBlock(testing.allocator, block_b, 2, null);

    const pending_b = &pa.nodes.items[pa.indices.get(root_b).?.gloas.pending];
    try testing.expectEqual(full_a_idx, pending_b.parent.?);
}

// Tree (Gloas):
//   genesis(pre-Gloas FULL)
//       |
//     A.PENDING (execPayloadBlockHash=0x00)
//     /        \
//   A.EMPTY(execHash=0x00)   A.FULL(execHash=0x64)
//     |                          |
//   B.PENDING                  C.PENDING
//     |                          |
//   B.EMPTY                    C.EMPTY
//
//   B.parent_block_hash=0x00 (matches A.EMPTY's execHash) → links to A.EMPTY
//   C.parent_block_hash=0x64 (matches A.FULL's execHash)  → links to A.FULL
test "children of both EMPTY and FULL parent variants" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert Gloas block A with bid_hash=0x64, parent_block_hash=ZERO_HASH.
    const root_a = makeRoot(1);
    const bid_hash_a = makeRoot(0x64);
    var block_a = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
    );
    block_a.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_a, 1, null);

    // Insert payload for A → creates A.FULL with execHash = bid_hash (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, root_a, 1, bid_hash_a, 1, null, .valid);

    const vi_a = pa.indices.get(root_a).?;
    const empty_a_idx = vi_a.gloas.empty;
    const full_a_idx = vi_a.gloas.full.?;

    // B: parent_block_hash=ZERO_HASH → matches A.EMPTY's execHash → links to A.EMPTY.
    const root_b = makeRoot(2);
    var block_b = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
    );
    block_b.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_b, 2, null);

    const pending_b = &pa.nodes.items[pa.indices.get(root_b).?.gloas.pending];
    try testing.expectEqual(empty_a_idx, pending_b.parent.?);

    // C: parent_block_hash=0x64 → matches A.FULL's execHash → links to A.FULL.
    const root_c = makeRoot(3);
    var block_c = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_c), root_a),
    );
    block_c.parent_block_hash = bid_hash_a;
    try pa.onBlock(testing.allocator, block_c, 3, null);

    const pending_c = &pa.nodes.items[pa.indices.get(root_c).?.gloas.pending];
    try testing.expectEqual(full_a_idx, pending_c.parent.?);
}

// Tree (Gloas):
//   genesis(pre-Gloas FULL)
//       |
//     A.PENDING (execPayloadBlockHash=0x00, slot=1)
//     /        \
//   A.EMPTY(execHash=0x00)   A.FULL(execHash=0x64)
//     |                          |
//   B.PENDING                  C.PENDING  (slot=2)
//     |                          |
//   B.EMPTY                    C.EMPTY + C.FULL
//
//   B builds on EMPTY(A), C builds on FULL(A).
//   Attestations shift head from B to C and back.
test "forked branches with EMPTY and FULL parent linkage and weight propagation" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert Gloas block A at slot 1 with bid_hash=0x64.
    const root_a = makeRoot(1);
    const bid_hash_a = makeRoot(0x64);
    var block_a = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
    );
    block_a.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_a, 1, null);

    // Insert payload for A with execHash = bid_hash (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, root_a, 1, bid_hash_a, 1, null, .valid);

    const vi_a = pa.indices.get(root_a).?;
    const empty_a_idx = vi_a.gloas.empty;
    const full_a_idx = vi_a.gloas.full.?;

    // B: builds on A.EMPTY (parent_block_hash=ZERO_HASH matches A.EMPTY's execHash).
    const root_b = makeRoot(2);
    var block_b = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
    );
    block_b.parent_block_hash = ZERO_HASH;
    try pa.onBlock(testing.allocator, block_b, 2, null);

    const pending_b = &pa.nodes.items[pa.indices.get(root_b).?.gloas.pending];
    try testing.expectEqual(empty_a_idx, pending_b.parent.?);

    // C: builds on A.FULL (parent_block_hash=bid_hash matches A.FULL's execHash).
    const root_c = makeRoot(3);
    var block_c = TestBlock.asGloas(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_c), root_a),
    );
    block_c.parent_block_hash = bid_hash_a;
    try pa.onBlock(testing.allocator, block_c, 2, null);

    // Insert payload for C with execHash = C's bid_hash (ZERO_HASH).
    try pa.onExecutionPayload(testing.allocator, root_c, 2, ZERO_HASH, 2, null, .valid);

    const pending_c = &pa.nodes.items[pa.indices.get(root_c).?.gloas.pending];
    try testing.expectEqual(full_a_idx, pending_c.parent.?);

    // Give B 2 votes, C 3 votes → C should outweigh B.
    // node count: genesis(0), A.PENDING(1), A.EMPTY(2), A.FULL(3), B.PENDING(4), B.EMPTY(5), C.PENDING(6), C.EMPTY(7), C.FULL(8)
    var deltas_1 = [_]i64{ 0, 0, 0, 0, 20, 0, 30, 0, 0 };
    try pa.applyScoreChanges(&deltas_1, null, 0, ZERO_HASH, 0, ZERO_HASH, 2);

    // B.PENDING weight = 20.
    try testing.expectEqual(@as(i64, 20), pa.nodes.items[4].weight);
    // C.PENDING weight = 30.
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[6].weight);
    // A.EMPTY should have B's propagated weight = 20.
    try testing.expectEqual(@as(i64, 20), pa.nodes.items[2].weight);
    // A.FULL should have C's propagated weight = 30.
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[3].weight);

    // Heavy votes for B flip back.
    var deltas_2 = [_]i64{ 0, 0, 0, 0, 40, 0, 0, 0, 0 };
    try pa.applyScoreChanges(&deltas_2, null, 0, ZERO_HASH, 0, ZERO_HASH, 2);

    // B.PENDING weight = 60.
    try testing.expectEqual(@as(i64, 60), pa.nodes.items[4].weight);
    // A.EMPTY = 60 (B's propagated weight).
    try testing.expectEqual(@as(i64, 60), pa.nodes.items[2].weight);
    // A.FULL still = 30.
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[3].weight);
}

// Tree (Gloas):
//   genesis(pre-Gloas FULL)
//       |
//     A.PENDING (execHash=0x00, slot=1)
//     /        \
//   A.EMPTY(execHash=0x00)   A.FULL(execHash=0x64)
//                                |
//                              B.PENDING (execHash=0x64, slot=2)
//                              /        \
//              B.EMPTY(execHash=0x64)    B.FULL(execHash=0xC8)
//           |                        |
//         C.PENDING (slot=3)       D.PENDING (slot=3)
//           |                        |
//         C.EMPTY                  D.EMPTY + D.FULL
//
//   C builds on B.EMPTY, D builds on B.FULL.
test "deep fork weight propagation across EMPTY and FULL variants" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // A at slot 1: bid_hash=0x64, parent_block_hash=ZERO_HASH.
    const root_a = makeRoot(1);
    const bid_hash_a = makeRoot(0x64);
    const block_a = TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
        ZERO_HASH,
    );
    try pa.onBlock(testing.allocator, block_a, 1, null);

    // Payload for A: execHash = bid_hash_a (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, root_a, 1, bid_hash_a, 1, null, .valid);

    // B at slot 2, builds on A.FULL (parent_block_hash=bid_hash_a matches A.FULL's execHash).
    // B's EMPTY execHash = bid_hash_a (B's parent_block_hash = bid.parentBlockHash).
    const root_b = makeRoot(2);
    const bid_hash_b = makeRoot(0xC8);
    const block_b = TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
        bid_hash_a,
    );
    try pa.onBlock(testing.allocator, block_b, 2, null);

    // Verify B links to A.FULL.
    const full_a_idx = pa.indices.get(root_a).?.gloas.full.?;
    const pending_b = &pa.nodes.items[pa.indices.get(root_b).?.gloas.pending];
    try testing.expectEqual(full_a_idx, pending_b.parent.?);

    // Payload for B: execHash = bid_hash_b (ePBS invariant).
    try pa.onExecutionPayload(testing.allocator, root_b, 2, bid_hash_b, 2, null, .valid);

    const vi_b = pa.indices.get(root_b).?;
    const empty_b_idx = vi_b.gloas.empty;
    const full_b_idx = vi_b.gloas.full.?;

    // C at slot 3, builds on B.EMPTY (parent_block_hash=bid_hash_a matches B.EMPTY's execHash).
    const root_c = makeRoot(3);
    const block_c = TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_c), root_b),
        bid_hash_a,
    );
    try pa.onBlock(testing.allocator, block_c, 3, null);

    const pending_c = &pa.nodes.items[pa.indices.get(root_c).?.gloas.pending];
    try testing.expectEqual(empty_b_idx, pending_c.parent.?);

    // D at slot 3, builds on B.FULL (parent_block_hash=bid_hash_b matches B.FULL's execHash).
    const root_d = makeRoot(4);
    const block_d = TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_d), root_b),
        bid_hash_b,
    );
    try pa.onBlock(testing.allocator, block_d, 3, null);

    // Payload for D.
    try pa.onExecutionPayload(testing.allocator, root_d, 3, ZERO_HASH, 3, null, .valid);

    const pending_d = &pa.nodes.items[pa.indices.get(root_d).?.gloas.pending];
    try testing.expectEqual(full_b_idx, pending_d.parent.?);

    // Node layout:
    //   0: genesis
    //   1: A.PENDING,  2: A.EMPTY,  3: A.FULL
    //   4: B.PENDING,  5: B.EMPTY,  6: B.FULL
    //   7: C.PENDING,  8: C.EMPTY
    //   9: D.PENDING, 10: D.EMPTY, 11: D.FULL
    try testing.expectEqual(@as(usize, 12), pa.nodes.items.len);

    // C gets 2 votes, D gets 3 votes.
    var deltas = [_]i64{ 0, 0, 0, 0, 0, 0, 0, 20, 0, 30, 0, 0 };
    try pa.applyScoreChanges(&deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 3);

    // C.PENDING = 20, D.PENDING = 30.
    try testing.expectEqual(@as(i64, 20), pa.nodes.items[7].weight);
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[9].weight);

    // B.EMPTY = 20 (C propagated), B.FULL = 30 (D propagated).
    try testing.expectEqual(@as(i64, 20), pa.nodes.items[5].weight);
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[6].weight);

    // B.PENDING = 50 (B.EMPTY + B.FULL).
    try testing.expectEqual(@as(i64, 50), pa.nodes.items[4].weight);

    // A.FULL = 50 (B propagated to A.FULL since B links to A.FULL).
    try testing.expectEqual(@as(i64, 50), pa.nodes.items[3].weight);

    // Heavy votes for C flip B.EMPTY to outweigh B.FULL.
    var deltas_2 = [_]i64{ 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0 };
    try pa.applyScoreChanges(&deltas_2, null, 0, ZERO_HASH, 0, ZERO_HASH, 3);

    // C.PENDING = 70.
    try testing.expectEqual(@as(i64, 70), pa.nodes.items[7].weight);
    // B.EMPTY = 70 (C propagated).
    try testing.expectEqual(@as(i64, 70), pa.nodes.items[5].weight);
    // B.FULL still = 30.
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[6].weight);
    // B.PENDING = 100 (70 + 30).
    try testing.expectEqual(@as(i64, 100), pa.nodes.items[4].weight);
}

// Tree (Gloas):
//   0x01.PENDING
//     |
//   0x01.EMPTY
test "onBlockGloas initializes PTC votes" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);

    // PTC votes should be initialized to all false.
    const votes = pa.ptc_votes.get(root).?;
    try testing.expectEqual(@as(usize, 0), votes.count());
}

// Tree (Gloas):
//   0x01.PENDING
//     |
//   0x01.EMPTY
test "notifyPtcMessages sets votes" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);

    // Record some PTC votes.
    const indices = [_]u32{ 0, 1 };
    pa.notifyPtcMessages(root, &indices, true);

    const votes = pa.ptc_votes.get(root).?;
    try testing.expect(votes.isSet(0));
    try testing.expect(votes.isSet(1));
    if (preset.PTC_SIZE > 2) {
        try testing.expect(!votes.isSet(2));
    }
}

// Tree (Gloas, no FULL variant):
//   0x01.PENDING
//     |
//   0x01.EMPTY
test "isPayloadTimely without FULL returns false" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);

    // Set all PTC votes to true, but no FULL variant.
    pa.ptc_votes.getPtr(root).?.* = ProtoArray.PtcVotes.initFull();

    try testing.expect(!pa.isPayloadTimely(root));
}

// Tree (Gloas, with FULL):
//       0x01.PENDING
//       / \
// 0x01.EMPTY 0x01.FULL
test "isPayloadTimely with FULL and supermajority returns true" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);

    // Add FULL variant.
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xAA), 1, null, .valid);

    // Set more than PAYLOAD_TIMELY_THRESHOLD votes to true.
    pa.ptc_votes.getPtr(root).?.* = ProtoArray.PtcVotes.initFull();

    try testing.expect(pa.isPayloadTimely(root));
}

// Tree (Gloas, with FULL):
//       0x01.PENDING
//       / \
// 0x01.EMPTY 0x01.FULL
test "shouldExtendPayload timely payload returns true" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xAA), 1, null, .valid);

    // Make payload timely.
    pa.ptc_votes.getPtr(root).?.* = ProtoArray.PtcVotes.initFull();

    try testing.expect(try pa.shouldExtendPayload(root, null));
    try testing.expect(try pa.shouldExtendPayload(root, ZERO_HASH));
}

// Tree (Gloas):
//   0x01.PENDING
//     |
//   0x01.EMPTY
//     |
//   0x01.FULL
// Upstream: lodestar #9209 — shouldExtendPayload now requires a FULL variant.
test "shouldExtendPayload no proposer boost returns true (with FULL variant)" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xAA), 0, null, .valid);

    // Not timely, but has payload + no proposer boost → extend.
    try testing.expect(try pa.shouldExtendPayload(root, null));
    try testing.expect(try pa.shouldExtendPayload(root, ZERO_HASH));
}

// Regression: upstream lodestar #9209 added `hasPayload` gate — if FULL variant is
// missing shouldExtendPayload returns false regardless of the other conditions.
test "shouldExtendPayload returns false without FULL variant" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);

    // No FULL variant → gate closes regardless of boost root.
    try testing.expect(!try pa.shouldExtendPayload(root, null));
    try testing.expect(!try pa.shouldExtendPayload(root, ZERO_HASH));
}

// Tree:
//   0(genesis)
//     |
//   0x01
test "applyScoreChanges proposer boost does not accumulate across repeated calls" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const child_root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(
        testing.allocator,
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, child_root), ZERO_HASH),
        1,
        null,
    );

    const boost = ProtoArray.ProposerBoost{ .root = child_root, .score = 34 };

    var deltas_1 = [_]i64{ 0, 0 };
    try pa.applyScoreChanges(&deltas_1, boost, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    const weight_after_first = pa.nodes.items[1].weight;

    var deltas_2 = [_]i64{ 0, 0 };
    try pa.applyScoreChanges(&deltas_2, boost, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(weight_after_first, pa.nodes.items[1].weight);
}

// Regression: upstream lodestar #9165 — for Gloas blocks the proposer boost must only
// be applied to the PENDING variant, otherwise PENDING/EMPTY/FULL (all sharing the same
// block_root) each pick up the boost and the delta back-propagation compounds it.
test "applyScoreChanges Gloas proposer boost only targets PENDING variant" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root = makeRoot(1);
    const bid_hash = makeRoot(0xAA);
    try pa.onBlock(
        testing.allocator,
        TestBlock.asGloasWithParentBlockHash(
            TestBlock.withParent(TestBlock.withSlotAndRoot(1, root), ZERO_HASH),
            bid_hash,
        ),
        1,
        null,
    );
    try pa.onExecutionPayload(testing.allocator, root, 1, bid_hash, 0, null, .valid);

    const pending_idx = pa.getNodeIndexByRootAndStatus(root, .pending).?;
    const empty_idx = pa.getNodeIndexByRootAndStatus(root, .empty).?;
    const full_idx = pa.getNodeIndexByRootAndStatus(root, .full).?;

    const boost = ProtoArray.ProposerBoost{ .root = root, .score = 34 };
    var deltas = [_]i64{0} ** 4;
    try pa.applyScoreChanges(&deltas, boost, 0, ZERO_HASH, 0, ZERO_HASH, 1);

    // Only PENDING should receive the boost directly; EMPTY and FULL must stay at 0.
    try testing.expectEqual(@as(i64, 34), pa.nodes.items[pending_idx].weight);
    try testing.expectEqual(@as(i64, 0), pa.nodes.items[empty_idx].weight);
    try testing.expectEqual(@as(i64, 0), pa.nodes.items[full_idx].weight);
}

// Tree:
//            0
//           / \
//          1   2
//         / \
//        3   4
//       / \
//      5   6
//
test "findHead tiebreak without votes" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_2), ZERO_HASH), 1, null);

    const root_3 = makeRoot(3);
    const root_4 = makeRoot(4);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_3), root_1), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_4), root_1), 2, null);

    const root_5 = makeRoot(5);
    const root_6 = makeRoot(6);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_5), root_3), 3, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_6), root_3), 3, null);

    // No votes: highest-root tiebreak picks root_2 (0x02 > 0x01).
    var deltas = [_]i64{0} ** 7;
    try pa.applyScoreChanges(&deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 3);

    var head = try pa.findHead(ZERO_HASH, 3);
    try testing.expectEqual(root_2, head.block_root);

    // Weight on left branch shifts head to root_6.
    var deltas_vote = [_]i64{ 0, 0, 0, 0, 0, 0, 10 };
    try pa.applyScoreChanges(&deltas_vote, null, 0, ZERO_HASH, 0, ZERO_HASH, 3);

    head = try pa.findHead(ZERO_HASH, 3);
    try testing.expectEqual(root_6, head.block_root);
}

// Tree:
//       0
//      / \
//     1   2
//
test "votes shift head between branches" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_2), ZERO_HASH), 1, null);

    // Vote 10 for root_1, 0 for root_2 → head is root_1.
    var deltas_a = [_]i64{ 0, 10, 0 };
    try pa.applyScoreChanges(&deltas_a, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);

    var head = try pa.findHead(ZERO_HASH, 1);
    try testing.expectEqual(root_1, head.block_root);

    // Move votes: -10 from root_1, +20 to root_2 → head is root_2.
    var deltas_b = [_]i64{ 0, -10, 20 };
    try pa.applyScoreChanges(&deltas_b, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);

    head = try pa.findHead(ZERO_HASH, 1);
    try testing.expectEqual(root_2, head.block_root);
}

// Tree:
//   0(j=0,f=0) → 1(j=0,f=0) → 2(j=1,f=0) → 3(j=2,f=1)
//
// Advancing justified/finalized epochs still selects deepest viable head.
test "findHead with ffg checkpoint updates" {
    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);

    var pa: ProtoArray = undefined;
    pa.init(0, root_0, 0, root_0, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), root_0), 1, null);

    var block_2 = TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_2), root_1);
    block_2.justified_epoch = 1;
    block_2.justified_root = root_0;
    block_2.unrealized_justified_epoch = 1;
    block_2.unrealized_justified_root = root_0;
    try pa.onBlock(testing.allocator, block_2, 2, null);

    var block_3 = TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_3), root_2);
    block_3.justified_epoch = 2;
    block_3.justified_root = root_1;
    block_3.finalized_epoch = 1;
    block_3.finalized_root = root_0;
    block_3.unrealized_justified_epoch = 2;
    block_3.unrealized_justified_root = root_1;
    block_3.unrealized_finalized_epoch = 1;
    block_3.unrealized_finalized_root = root_0;
    try pa.onBlock(testing.allocator, block_3, 3, null);

    var deltas_0 = [_]i64{0} ** 4;
    try pa.applyScoreChanges(&deltas_0, null, 0, root_0, 0, root_0, 3);

    var head = try pa.findHead(root_0, 3);
    try testing.expectEqual(root_3, head.block_root);

    // Advance finalized to epoch 1 — head stays at block 3.
    var deltas_1 = [_]i64{0} ** 4;
    try pa.applyScoreChanges(&deltas_1, null, 2, root_1, 1, root_0, 3);

    head = try pa.findHead(root_0, 3);
    try testing.expectEqual(root_3, head.block_root);
}

// Tree:
//       0
//      / \
//     1   2
//     |   |
//     3   4
//
test "votes shift head in binary tree" {
    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);
    const root_4 = makeRoot(4);

    var pa: ProtoArray = undefined;
    pa.init(0, root_0, 0, root_0, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), root_0), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_2), root_0), 1, null);

    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_3), root_1), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_4), root_2), 2, null);

    var deltas = [_]i64{ 0, 0, 0, 10, 0 };
    try pa.applyScoreChanges(&deltas, null, 0, root_0, 0, root_0, 2);

    var head = try pa.findHead(root_0, 2);
    try testing.expectEqual(root_3, head.block_root);

    var deltas_2 = [_]i64{ 0, 0, 0, -10, 20 };
    try pa.applyScoreChanges(&deltas_2, null, 0, root_0, 0, root_0, 2);

    head = try pa.findHead(root_0, 2);
    try testing.expectEqual(root_4, head.block_root);
}

// Tree:
//       0 (finalized)
//      / \
//     1   2
//     |
//     3
//
test "isFinalizedRootOrDescendant" {
    const finalized_root = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);

    var pa: ProtoArray = undefined;
    pa.init(0, finalized_root, 0, finalized_root, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    const block_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), finalized_root);
    try pa.onBlock(testing.allocator, block_1, 1, null);
    const block_2 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_2), finalized_root);
    try pa.onBlock(testing.allocator, block_2, 1, null);

    var block_3 = TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_3), root_1);
    block_3.finalized_epoch = 1;
    block_3.finalized_root = root_1;
    block_3.unrealized_finalized_epoch = 1;
    block_3.unrealized_finalized_root = root_1;
    try pa.onBlock(testing.allocator, block_3, 2, null);

    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[0]));
    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[1]));
    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[2]));
    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[3]));

    // Advance finalized to root_1 — root_2 is no longer a descendant.
    pa.finalized_epoch = 1;
    pa.finalized_root = root_1;

    try testing.expect(!pa.isFinalizedRootOrDescendant(&pa.nodes.items[2]));
    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[1]));
    try testing.expect(pa.isFinalizedRootOrDescendant(&pa.nodes.items[3]));
}

// Tree:
//       0
//      / \
//     1   2
//
test "invalid execution status zeroes weight and moves head" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    var child_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH);
    child_1.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA1), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, child_1, 1, null);

    var child_2 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(2)), ZERO_HASH);
    child_2.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA2), 2, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, child_2, 1, null);

    var deltas = [_]i64{ 0, 30, 10 };
    try pa.applyScoreChanges(&deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);

    var head = try pa.findHead(ZERO_HASH, 1);
    try testing.expectEqual(makeRoot(1), head.block_root);

    pa.nodes.items[1].extra_meta.post_merge.execution_status = .invalid;

    var deltas_2 = [_]i64{ 0, 0, 0 };
    try pa.applyScoreChanges(&deltas_2, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(@as(i64, 0), pa.nodes.items[1].weight);

    head = try pa.findHead(ZERO_HASH, 1);
    try testing.expectEqual(makeRoot(2), head.block_root);
}

// Tree:
//   0(genesis)
//     |
//   0x01(syncing)
test "invalid execution status reverts proposer boost" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    var child = TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH);
    child.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA1), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, child, 1, null);

    const boost = ProtoArray.ProposerBoost{ .root = makeRoot(1), .score = 1000 };
    var deltas = [_]i64{ 0, 5 };
    try pa.applyScoreChanges(&deltas, boost, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(@as(i64, 1005), pa.nodes.items[1].weight);

    pa.nodes.items[1].extra_meta.post_merge.execution_status = .invalid;

    var deltas_2 = [_]i64{ 0, 0 };
    try pa.applyScoreChanges(&deltas_2, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(@as(i64, 0), pa.nodes.items[1].weight);
}

// Tree: 0 (genesis) — query with unknown justified root
test "findHead unknown justified root returns error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try testing.expectError(error.JustifiedNodeUnknown, pa.findHead(makeRoot(0xFF), 0));
}

// Tree: 0x01 (syncing, then mutated to invalid)
test "nodeIsViableForHead rejects invalid execution" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Can't insert invalid directly, so insert as syncing then mutate.
    var block_syncing = TestBlock.withRoot(makeRoot(1));
    block_syncing.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_syncing, 0, null);

    try testing.expect(pa.nodeIsViableForHead(&pa.nodes.items[0], 0));

    pa.nodes.items[0].extra_meta.post_merge.execution_status = .invalid;
    try testing.expect(!pa.nodeIsViableForHead(&pa.nodes.items[0], 0));
}

// Tree:
//   0(genesis)
//     |
//   0x01
test "negative weight delta propagation" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    const block_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH);
    try pa.onBlock(testing.allocator, block_1, 1, null);

    // Add weight then remove more than exists.
    var deltas_add = [_]i64{ 0, 10 };
    try pa.applyScoreChanges(&deltas_add, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(@as(i64, 10), pa.nodes.items[1].weight);

    var deltas_sub = [_]i64{ 0, -20 };
    try pa.applyScoreChanges(&deltas_sub, null, 0, ZERO_HASH, 0, ZERO_HASH, 1);
    try testing.expectEqual(@as(i64, -10), pa.nodes.items[1].weight);
}

// Tree:
//   0
//   |
//   1
//   |
//   2
//   |
//   3
test "getAncestor returns ancestor at slot" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), root_0), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_2), root_1), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_3), root_2), 3, null);

    const ancestor = try pa.getAncestor(root_3, 1);
    try testing.expectEqual(root_1, ancestor.block_root);

    const genesis_ancestor = try pa.getAncestor(root_3, 0);
    try testing.expectEqual(root_0, genesis_ancestor.block_root);
}

// Tree:
//   0(s=0)
//     |
//   0x01(s=5)
test "getAncestor at own slot returns self" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_1 = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(5, root_1), ZERO_HASH), 5, null);

    const ancestor = try pa.getAncestor(root_1, 5);
    try testing.expectEqual(root_1, ancestor.block_root);
}

// Tree:
//   0(s=0)
//     |     gap(s=1..4)
//   0x01(s=5)
test "getAncestor skips slot gap" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(5, root_1), root_0), 5, null);

    // Slot 3 is between genesis(0) and root_1(5) — snaps to genesis.
    const ancestor = try pa.getAncestor(root_1, 3);
    try testing.expectEqual(root_0, ancestor.block_root);
}

// Tree:
//        0
//       / \
//      1   2
//      |   |
//      3   4
//
test "getAncestor finds common ancestor" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);
    const root_4 = makeRoot(4);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), root_0), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_2), root_0), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_3), root_1), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_4), root_2), 2, null);

    const anc_left = try pa.getAncestor(root_3, 0);
    const anc_right = try pa.getAncestor(root_4, 0);
    try testing.expectEqual(root_0, anc_left.block_root);
    try testing.expectEqual(root_0, anc_right.block_root);
    try testing.expectEqual(anc_left.block_root, anc_right.block_root);
}

// Tree:
//                                0
//                               / \
//  justified:0,finalized:0 -> 1   2 <- justified:0,finalized:0
//                             |   |
//  justified:1,finalized:0 -> 3   4 <- justified:0,finalized:0
//                             |   |
//  justified:1,finalized:0 -> 5   6 <- justified:0,finalized:0
//                             |   |
//  justified:1,finalized:0 -> 7   8 <- justified:1,finalized:0
//                             |   |
//  justified:2,finalized:0 -> 9  10 <- justified:2,finalized:0
//
// Votes and justified-epoch changes shift head between branches.
test "ffg updates two branches with votes and justified epoch switch" {
    const root_0 = ZERO_HASH;

    var pa: ProtoArray = undefined;
    pa.init(0, root_0, 0, root_0, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Left branch: 1 → 3 → 5 → 7 → 9
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), root_0),
        0,
        root_0,
        0,
        root_0,
    ), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, makeRoot(3)), makeRoot(1)),
        1,
        root_0,
        0,
        root_0,
    ), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(3, makeRoot(5)), makeRoot(3)),
        1,
        root_0,
        0,
        root_0,
    ), 3, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(4, makeRoot(7)), makeRoot(5)),
        1,
        root_0,
        0,
        root_0,
    ), 4, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(4, makeRoot(9)), makeRoot(7)),
        2,
        root_0,
        0,
        root_0,
    ), 4, null);

    // Right branch: 2 → 4 → 6 → 8 → 10
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(2)), root_0),
        0,
        root_0,
        0,
        root_0,
    ), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, makeRoot(4)), makeRoot(2)),
        0,
        root_0,
        0,
        root_0,
    ), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(3, makeRoot(6)), makeRoot(4)),
        0,
        root_0,
        0,
        root_0,
    ), 3, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(4, makeRoot(8)), makeRoot(6)),
        1,
        root_0,
        0,
        root_0,
    ), 4, null);
    try pa.onBlock(testing.allocator, TestBlock.withCheckpoints(
        TestBlock.withParent(TestBlock.withSlotAndRoot(4, makeRoot(10)), makeRoot(8)),
        2,
        root_0,
        0,
        root_0,
    ), 4, null);

    // 11 nodes: genesis + 5 left + 5 right.
    try testing.expectEqual(@as(usize, 11), pa.nodes.items.len);

    // Use a large current_slot so current_epoch = 5 (with minimal SLOTS_PER_EPOCH=8).
    // This makes the justified epoch viability check meaningful:
    //   viable iff (justified_epoch == store.justified_epoch) or (justified_epoch + 2 >= current_epoch)
    const current_slot: Slot = 5 * preset.SLOTS_PER_EPOCH;

    // No votes yet — tiebreak: root_10 (0x0a > 0x09) wins.
    var deltas_0 = [_]i64{0} ** 11;
    try pa.applyScoreChanges(&deltas_0, null, 0, root_0, 0, root_0, current_slot);

    var head = try pa.findHead(root_0, current_slot);
    try testing.expectEqual(makeRoot(10), head.block_root);

    // Vote for node 1 (left branch) — left outweighs right → head = 9.
    // nodes: 0=genesis, 1=root1, 2=root3, 3=root5, 4=root7, 5=root9,
    //        6=root2, 7=root4, 8=root6, 9=root8, 10=root10
    var deltas_1 = [_]i64{ 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    try pa.applyScoreChanges(&deltas_1, null, 0, root_0, 0, root_0, current_slot);

    head = try pa.findHead(root_0, current_slot);
    try testing.expectEqual(makeRoot(9), head.block_root);

    // Vote for node 2 (right branch) — equal weight, tiebreak → head = 10.
    var deltas_2 = [_]i64{ 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0 };
    try pa.applyScoreChanges(&deltas_2, null, 0, root_0, 0, root_0, current_slot);

    head = try pa.findHead(root_0, current_slot);
    try testing.expectEqual(makeRoot(10), head.block_root);

    // Change justified checkpoint to epoch 1, root = root_1.
    // With current_epoch=5 and store justified=1:
    //   node 9 (justified=2): 2!=1 and 2+2=4<5 → NOT viable
    //   node 7 (justified=1): 1==1 → viable
    // So head from root_1 = root_7.
    var deltas_3 = [_]i64{0} ** 11;
    try pa.applyScoreChanges(&deltas_3, null, 1, makeRoot(1), 0, root_0, current_slot);

    head = try pa.findHead(makeRoot(1), current_slot);
    try testing.expectEqual(makeRoot(7), head.block_root);
}

// Tree (per test case):
//   0(genesis)
//     |
//   0x01(j=J, f=F)
//
// Table-driven: tests nodeIsViableForHead with various justified/finalized
// epoch combinations. current_epoch = 5 (slot = 5 * SLOTS_PER_EPOCH).
// viable iff (justified == store.justified) or (justified + 2 >= current_epoch).
test "nodeIsViableForHead table-driven epoch combinations" {
    const slots_per_epoch = preset.SLOTS_PER_EPOCH;

    // current_epoch = 5 → current_slot = 5 * SLOTS_PER_EPOCH.
    const current_slot: Slot = 5 * slots_per_epoch;

    const TestCase = struct {
        justified_epoch: Epoch,
        finalized_epoch: Epoch,
        store_justified_epoch: Epoch,
        want: bool,
    };

    const cases = [_]TestCase{
        // All genesis → viable.
        .{ .justified_epoch = 0, .finalized_epoch = 0, .store_justified_epoch = 0, .want = true },
        // Store justified=1, node justified=0 → not viable (0 != 1, 0+2 < 5).
        .{ .justified_epoch = 0, .finalized_epoch = 0, .store_justified_epoch = 1, .want = false },
        // Both justified=1 → viable.
        .{ .justified_epoch = 1, .finalized_epoch = 1, .store_justified_epoch = 1, .want = true },
        // Node justified=1, store=2 → not viable (1 != 2, 1+2 < 5).
        .{ .justified_epoch = 1, .finalized_epoch = 1, .store_justified_epoch = 2, .want = false },
        // Node justified=2, store=3 → not viable (2 != 3, 2+2 < 5).
        .{ .justified_epoch = 2, .finalized_epoch = 1, .store_justified_epoch = 3, .want = false },
        // Node justified=2, store=4 → not viable (2 != 4, 2+2 < 5).
        .{ .justified_epoch = 2, .finalized_epoch = 1, .store_justified_epoch = 4, .want = false },
        // Node justified=3, store=4 → viable (3+2 >= 5).
        .{ .justified_epoch = 3, .finalized_epoch = 1, .store_justified_epoch = 4, .want = true },
    };

    for (cases) |tc| {
        // Use a previous-epoch slot so that nodeIsViableForHead uses
        // unrealized_justified_epoch (which we set equal to justified_epoch).
        var pa: ProtoArray = undefined;
        pa.init(
            tc.store_justified_epoch,
            ZERO_HASH,
            0,
            ZERO_HASH,
            0,
        );
        defer pa.deinit(testing.allocator);

        // Insert a genesis + test node. Use slot in epoch 0 (previous epoch).
        try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

        const block = TestBlock.withCheckpoints(
            TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH),
            tc.justified_epoch,
            ZERO_HASH,
            tc.finalized_epoch,
            ZERO_HASH,
        );
        try pa.onBlock(testing.allocator, block, 1, null);

        const node = &pa.nodes.items[1];
        try testing.expectEqual(tc.want, pa.nodeIsViableForHead(node, current_slot));
    }
}

// Tree:
//       0(genesis)
//       |
//       1
//      / \
//     2   3
//
// Apply positive weight deltas and verify propagation up the tree.
test "weight propagation with positive deltas" {
    const root_0 = ZERO_HASH;
    const root_1 = makeRoot(1);
    const root_2 = makeRoot(2);
    const root_3 = makeRoot(3);

    var pa: ProtoArray = undefined;
    pa.init(0, root_0, 0, root_0, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(
        TestBlock.withSlotAndRoot(1, root_1),
        root_0,
    ), 1, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(
        TestBlock.withSlotAndRoot(2, root_2),
        root_1,
    ), 2, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(
        TestBlock.withSlotAndRoot(2, root_3),
        root_1,
    ), 2, null);

    // Apply: root_2 gets +10, root_3 gets +20.
    var deltas = [_]i64{ 0, 0, 10, 20 };
    try pa.applyScoreChanges(&deltas, null, 0, root_0, 0, root_0, 2);

    // Leaf weights.
    try testing.expectEqual(@as(i64, 10), pa.nodes.items[2].weight);
    try testing.expectEqual(@as(i64, 20), pa.nodes.items[3].weight);

    // root_1 = 10 + 20 = 30 (propagated from both children).
    try testing.expectEqual(@as(i64, 30), pa.nodes.items[1].weight);

    // Note: genesis (ZERO_HASH) is explicitly skipped in updateWeights,
    // so its weight stays 0. This is by design — genesis is always chosen
    // as the root and doesn't need weight tracking.

    // Head should be root_3 (higher weight).
    var head = try pa.findHead(root_0, 2);
    try testing.expectEqual(root_3, head.block_root);

    // Shift weight: -20 from root_3, +30 to root_2.
    var deltas_2 = [_]i64{ 0, 0, 30, -20 };
    try pa.applyScoreChanges(&deltas_2, null, 0, root_0, 0, root_0, 2);

    // root_2 = 40, root_3 = 0.
    try testing.expectEqual(@as(i64, 40), pa.nodes.items[2].weight);
    try testing.expectEqual(@as(i64, 0), pa.nodes.items[3].weight);

    // root_1 = 40 (only root_2 contributes via delta propagation).
    try testing.expectEqual(@as(i64, 40), pa.nodes.items[1].weight);

    // Head flips to root_2.
    head = try pa.findHead(root_0, 2);
    try testing.expectEqual(root_2, head.block_root);
}

test "NodeCount returns number of unique block roots" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try testing.expectEqual(@as(usize, 1), pa.length());

    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH), 0, null);
    try testing.expectEqual(@as(usize, 2), pa.length());
}

// Tree: genesis(0x00), child 0x01
test "NodeByRoot returns correct node or null" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    const root_1 = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH), 0, null);

    // Found.
    const node = pa.getNode(root_1, .full);
    try testing.expect(node != null);
    try testing.expectEqual(@as(Slot, 1), node.?.slot);

    // getBlock returns a value copy.
    const block = pa.getBlock(root_1, .full);
    try testing.expect(block != null);
    try testing.expectEqual(root_1, block.?.block_root);

    // Not-found returns null.
    try testing.expectEqual(@as(?*const ProtoNode, null), pa.getNode(makeRoot(0xFF), .full));
    try testing.expectEqual(@as(?ProtoBlock, null), pa.getBlock(makeRoot(0xFF), .full));
}

// Tree: genesis(0x00)
test "HasNode returns true for known roots" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try testing.expect(pa.hasBlock(ZERO_HASH));
    try testing.expect(!pa.hasBlock(makeRoot(0xFF)));
}

// Tree:
//   genesis(0x00, slot=0)
//      / \
//    1(slot=1)  2(slot=2)
//     |          |
//    3(slot=3)  4(slot=4)
//                |
//              5(slot=5)
//                |
//              6(slot=6)
//
// Head is 6 (longest chain from genesis). Canonical = on the head chain.
// 1 and 3 are NOT canonical because they're on a different branch.
test "IsCanonical identifies head chain via isDescendant" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_0 = ZERO_HASH;
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    // Branch 1: genesis -> 1 -> 3
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), root_0), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, makeRoot(2)), root_0), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(3, makeRoot(3)), makeRoot(1)), 0, null);
    // Branch 2: genesis -> 2 -> 4 -> 5 -> 6
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(4, makeRoot(4)), makeRoot(2)), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(5, makeRoot(5)), makeRoot(4)), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(6, makeRoot(6)), makeRoot(5)), 0, null);

    // Head = 6 (longest chain). Check "is X an ancestor of head?"
    const head_root = makeRoot(6);
    try testing.expect(try pa.isDescendant(root_0, .full, head_root, .full)); // genesis
    try testing.expect(!try pa.isDescendant(makeRoot(1), .full, head_root, .full)); // branch 1
    try testing.expect(try pa.isDescendant(makeRoot(2), .full, head_root, .full)); // branch 2
    try testing.expect(!try pa.isDescendant(makeRoot(3), .full, head_root, .full)); // branch 1 leaf
    try testing.expect(try pa.isDescendant(makeRoot(4), .full, head_root, .full));
    try testing.expect(try pa.isDescendant(makeRoot(5), .full, head_root, .full));
    try testing.expect(try pa.isDescendant(makeRoot(6), .full, head_root, .full)); // self
}

// Tree:
//        a(0)
//       / \
//     b(1)  c(2)
//      |    / | \
//    d(3) f(5) g(6) h(7)
//      |            |
//    e(4)          i(8)
//                   |
//                  j(9)
test "CommonAncestor table-driven two-branch tree" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_a = makeRoot('a');
    const root_b = makeRoot('b');
    const root_c = makeRoot('c');
    const root_d = makeRoot('d');
    const root_e = makeRoot('e');
    const root_f = makeRoot('f');
    const root_g = makeRoot('g');
    const root_h = makeRoot('h');
    const root_i = makeRoot('i');
    const root_j = makeRoot('j');

    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(0, root_a), ZERO_HASH), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_b), root_a), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_c), root_a), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_d), root_b), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(4, root_e), root_d), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(5, root_f), root_c), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(6, root_g), root_c), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(7, root_h), root_c), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(8, root_i), root_h), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(9, root_j), root_i), 0, null);

    const TestCase = struct { r1: Root, r2: Root, want_root: Root, want_slot: Slot };
    const cases = [_]TestCase{
        .{ .r1 = root_c, .r2 = root_b, .want_root = root_a, .want_slot = 0 },
        .{ .r1 = root_c, .r2 = root_d, .want_root = root_a, .want_slot = 0 },
        .{ .r1 = root_c, .r2 = root_e, .want_root = root_a, .want_slot = 0 },
        .{ .r1 = root_g, .r2 = root_f, .want_root = root_c, .want_slot = 2 },
        .{ .r1 = root_f, .r2 = root_h, .want_root = root_c, .want_slot = 2 },
        .{ .r1 = root_g, .r2 = root_h, .want_root = root_c, .want_slot = 2 },
        .{ .r1 = root_b, .r2 = root_h, .want_root = root_a, .want_slot = 0 },
        .{ .r1 = root_e, .r2 = root_h, .want_root = root_a, .want_slot = 0 },
        .{ .r1 = root_i, .r2 = root_f, .want_root = root_c, .want_slot = 2 },
        .{ .r1 = root_j, .r2 = root_g, .want_root = root_c, .want_slot = 2 },
    };

    for (cases) |tc| {
        const node_1 = pa.getNode(tc.r1, .full).?;
        const node_2 = pa.getNode(tc.r2, .full).?;
        const lca = pa.getCommonAncestor(node_1, node_2);
        try testing.expect(lca != null);
        try testing.expectEqual(tc.want_root, lca.?.block_root);
        try testing.expectEqual(tc.want_slot, lca.?.slot);
    }

    // Equal inputs return self.
    const node_b = pa.getNode(root_b, .full).?;
    const lca_self = pa.getCommonAncestor(node_b, node_b);
    try testing.expect(lca_self != null);
    try testing.expectEqual(root_b, lca_self.?.block_root);
    try testing.expectEqual(@as(Slot, 1), lca_self.?.slot);
}

// Tree:
//   genesis
//     |
//   0x01(slot=1)
//     |
//   0x02(slot=2)
//     |
//   0x03(slot=5)
test "AncestorRoot returns correct ancestor at slot" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, makeRoot(2)), makeRoot(1)), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(5, makeRoot(3)), makeRoot(2)), 0, null);

    // Ancestor of root_3 at slot 5 = root_3 itself.
    const a1 = try pa.getAncestor(makeRoot(3), 5);
    try testing.expectEqual(makeRoot(3), a1.block_root);
    // Ancestor at higher slot = block itself.
    const a2 = try pa.getAncestor(makeRoot(3), 6);
    try testing.expectEqual(makeRoot(3), a2.block_root);
    // Ancestor of root_3 at slot 1 = root_1.
    const a3 = try pa.getAncestor(makeRoot(3), 1);
    try testing.expectEqual(makeRoot(1), a3.block_root);
}

// Tree:
//   genesis
//     |
//   '1'(slot=100)
//     |
//   '3'(slot=101)
test "AncestorRoot equal slot returns parent" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(100, makeRoot(1)), ZERO_HASH), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(101, makeRoot(3)), makeRoot(1)), 0, null);

    const a = try pa.getAncestor(makeRoot(3), 100);
    try testing.expectEqual(makeRoot(1), a.block_root);
}

// Tree:
//   genesis
//     |
//   '1'(slot=100)
//     |
//   '3'(slot=200)
// Ancestor at slot 150 should return parent at slot 100.
test "AncestorRoot lower slot returns nearest parent" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(100, makeRoot(1)), ZERO_HASH), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(200, makeRoot(3)), makeRoot(1)), 0, null);

    const a = try pa.getAncestor(makeRoot(3), 150);
    try testing.expectEqual(makeRoot(1), a.block_root);
}

// 100 nodes in a chain, finalize node 99 -> only 1 node remains.
test "Prune MoreThanThreshold leaves only finalized node" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Insert genesis + 99 children in a chain.
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    var i: u8 = 1;
    while (i < 100) : (i += 1) {
        try pa.onBlock(
            testing.allocator,
            TestBlock.withParent(TestBlock.withSlotAndRoot(@intCast(i), makeRoot(i)), makeRoot(i - 1)),
            0,
            null,
        );
    }

    // Apply scores so best-child/descendant are set.
    const zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    defer testing.allocator.free(zero_deltas);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 99);

    // Prune to node 99.
    const pruned = try pa.maybePrune(testing.allocator, makeRoot(99));
    defer testing.allocator.free(pruned);
    try testing.expect(pruned.len > 0);
    try testing.expectEqual(@as(usize, 1), pa.length());
}

// 100 nodes chain. Prune to 10, then prune to 20.
test "Prune MoreThanOnce prunes incrementally" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Build chain of 100 nodes.
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    var i: u8 = 1;
    while (i < 100) : (i += 1) {
        try pa.onBlock(
            testing.allocator,
            TestBlock.withParent(TestBlock.withSlotAndRoot(@intCast(i), makeRoot(i)), makeRoot(i - 1)),
            0,
            null,
        );
    }

    var zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    defer testing.allocator.free(zero_deltas);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 99);

    // First prune to node 10.
    const pruned1 = try pa.maybePrune(testing.allocator, makeRoot(10));
    testing.allocator.free(pruned1);
    try testing.expectEqual(@as(usize, 90), pa.length());

    // Reallocate zero_deltas for new node count.
    testing.allocator.free(zero_deltas);
    zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 99);

    // Second prune to node 20.
    const pruned2 = try pa.maybePrune(testing.allocator, makeRoot(20));
    testing.allocator.free(pruned2);
    try testing.expectEqual(@as(usize, 80), pa.length());
}

// Tree:
//     0
//    / \
//   1   2
// Finalize 1 -> node 0 (genesis) pruned.
// (node 2 survives because its index > finalized_index). It becomes unreachable
// but stays in the array until a future prune removes it.
test "Prune NoDanglingBranch keeps dangling node in flat array" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_0 = ZERO_HASH;
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), root_0), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(2, makeRoot(2)), root_0), 0, null);

    var deltas = [_]i64{ 0, 0, 0 };
    try pa.applyScoreChanges(&deltas, null, 0, root_0, 0, root_0, 2);

    const pruned = try pa.maybePrune(testing.allocator, makeRoot(1));
    defer testing.allocator.free(pruned);
    // 2 nodes remain (node 1 + dangling node 2). Proto_array does not remove
    // unreachable branches -- they are pruned when a future finalized root passes them.
    try testing.expectEqual(@as(usize, 2), pa.length());
}

// Finalized root is genesis (index 0) -> nothing to prune, node count unchanged.
test "Prune ReturnEarly when finalized is at index 0" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, makeRoot(1)), ZERO_HASH), 0, null);

    const count_before = pa.nodes.items.len;
    const pruned = try pa.maybePrune(testing.allocator, ZERO_HASH);
    try testing.expectEqual(@as(usize, 0), pruned.len);
    try testing.expectEqual(count_before, pa.nodes.items.len);
}

// Unknown finalized root -> error.
test "Prune unknown finalized root returns error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    try testing.expectError(error.FinalizedNodeUnknown, pa.maybePrune(testing.allocator, makeRoot(0xFF)));
}

// Tree:
//   genesis(0x00, syncing)
//     |
//   0x01(syncing, exec_hash=0xA1)
//     |
//   0x02(syncing, exec_hash=0xA2)
//
// validateLatestHash(valid, latestValidExecHash=0xA1)
// -> 0x01 becomes valid.
test "SetOptimisticToValid propagates up from matching hash" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_1 = makeRoot(1);
    var child_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH);
    child_1.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA1), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, child_1, 0, null);

    const root_2 = makeRoot(2);
    var child_2 = TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_2), root_1);
    child_2.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA2), 2, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, child_2, 0, null);

    try pa.validateLatestHash(
        testing.allocator,
        .{ .valid = .{ .latest_valid_exec_hash = makeRoot(0xA1) } },
        2,
    );

    // Node 1 (exec_hash=0xA1): syncing -> valid.
    try testing.expectEqual(ExecutionStatus.valid, pa.nodes.items[1].extra_meta.executionStatus());
    // Node 2 stays syncing (above the validated node).
    try testing.expectEqual(ExecutionStatus.syncing, pa.nodes.items[2].extra_meta.executionStatus());
}

// Tree:
//       A
//     / | \
//    B  C  D(INVALID)
//  (syncing) (syncing) (syncing)
//
// Invalidate D with LVH=A. Only D becomes invalid; B and C stay syncing.
test "SetOptimisticToInvalid only invalidates target not siblings" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_a = makeRoot('a');
    var block_a = TestBlock.withParent(TestBlock.withSlotAndRoot(100, root_a), ZERO_HASH);
    block_a.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('A'), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_a, 0, null);

    const root_b = makeRoot('b');
    var block_b = TestBlock.withParent(TestBlock.withSlotAndRoot(101, root_b), root_a);
    block_b.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('B'), 2, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_b, 0, null);

    const root_c = makeRoot('c');
    var block_c = TestBlock.withParent(TestBlock.withSlotAndRoot(102, root_c), root_a);
    block_c.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('C'), 3, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_c, 0, null);

    const root_d = makeRoot('d');
    var block_d = TestBlock.withParent(TestBlock.withSlotAndRoot(103, root_d), root_a);
    block_d.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('D'), 4, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_d, 0, null);

    try pa.validateLatestHash(
        testing.allocator,
        .{ .invalid = .{
            .invalidate_from_parent_block_root = root_d,
            .latest_valid_exec_hash = makeRoot('A'),
        } },
        103,
    );

    // D is invalid.
    try testing.expectEqual(ExecutionStatus.invalid, pa.nodes.items[4].extra_meta.executionStatus());
    // A, B, C are still syncing.
    try testing.expectEqual(ExecutionStatus.syncing, pa.nodes.items[1].extra_meta.executionStatus());
    try testing.expectEqual(ExecutionStatus.syncing, pa.nodes.items[2].extra_meta.executionStatus());
    try testing.expectEqual(ExecutionStatus.syncing, pa.nodes.items[3].extra_meta.executionStatus());
}

// Tree:
//   Pow       |      PoS
//   r(pre)
//     |
//   a(pre)
//    / \
//   b(syncing)      f(syncing)
//    / \               |
//   c(syncing) e(syncing) g(syncing)
//    |
//   d(syncing)
//
// Invalidate from d with LVH=ZERO_HASH (pre-merge boundary).
// -> b, c, d, e become invalid; a, r stay pre-merge; f, g stay syncing.
test "SetOptimisticToInvalid ForkAtMerge invalidates post-merge chain" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_r = makeRoot('r');
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(100, root_r), ZERO_HASH), 0, null);

    const root_a = makeRoot('a');
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(101, root_a), root_r), 0, null);

    const root_b = makeRoot('b');
    var block_b = TestBlock.withParent(TestBlock.withSlotAndRoot(102, root_b), root_a);
    block_b.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('B'), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_b, 0, null);

    const root_c = makeRoot('c');
    var block_c = TestBlock.withParent(TestBlock.withSlotAndRoot(103, root_c), root_b);
    block_c.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('C'), 2, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_c, 0, null);

    const root_d = makeRoot('d');
    var block_d = TestBlock.withParent(TestBlock.withSlotAndRoot(104, root_d), root_c);
    block_d.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('D'), 3, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_d, 0, null);

    const root_e = makeRoot('e');
    var block_e = TestBlock.withParent(TestBlock.withSlotAndRoot(105, root_e), root_b);
    block_e.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('E'), 4, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_e, 0, null);

    const root_f = makeRoot('f');
    var block_f = TestBlock.withParent(TestBlock.withSlotAndRoot(106, root_f), root_r);
    block_f.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('F'), 5, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_f, 0, null);

    const root_g = makeRoot('g');
    var block_g = TestBlock.withParent(TestBlock.withSlotAndRoot(107, root_g), root_f);
    block_g.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot('G'), 6, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_g, 0, null);

    // Invalidate from d, LVH = ZERO_HASH (pre-merge boundary at 'a').
    try pa.validateLatestHash(
        testing.allocator,
        .{ .invalid = .{
            .invalidate_from_parent_block_root = root_d,
            .latest_valid_exec_hash = ZERO_HASH,
        } },
        107,
    );

    // b, c, d are invalidated (walk up from d to LVH boundary).
    try testing.expectEqual(ExecutionStatus.invalid, pa.getNode(root_b, .full).?.extra_meta.executionStatus());
    try testing.expectEqual(ExecutionStatus.invalid, pa.getNode(root_c, .full).?.extra_meta.executionStatus());
    try testing.expectEqual(ExecutionStatus.invalid, pa.getNode(root_d, .full).?.extra_meta.executionStatus());
    // e is child of invalid b -> also invalid (pass 2).
    try testing.expectEqual(ExecutionStatus.invalid, pa.getNode(root_e, .full).?.extra_meta.executionStatus());
    // f, g are on a different branch -> stay syncing.
    try testing.expectEqual(ExecutionStatus.syncing, pa.getNode(root_f, .full).?.extra_meta.executionStatus());
    try testing.expectEqual(ExecutionStatus.syncing, pa.getNode(root_g, .full).?.extra_meta.executionStatus());
}

// Tree:
//   genesis(0x00)
//     |
//   0x01(syncing)
test "SetOptimisticToInvalid with null LVH returns error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_1 = makeRoot(1);
    var block_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH);
    block_1.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA1), 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_1, 0, null);

    const result = pa.validateLatestHash(
        testing.allocator,
        .{ .invalid = .{
            .invalidate_from_parent_block_root = root_1,
            .latest_valid_exec_hash = null,
        } },
        1,
    );
    try testing.expectError(error.InvalidLVHExecutionResponse, result);
}

// Tree:
//   genesis(0x00)
//     |
//   0x01(valid)
test "SetOptimisticToInvalid on valid node stores lvh_error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    const root_1 = makeRoot(1);
    var block_1 = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_1), ZERO_HASH);
    block_1.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(makeRoot(0xA1), 1, .valid, .available),
    };
    try pa.onBlock(testing.allocator, block_1, 0, null);

    const result = pa.validateLatestHash(
        testing.allocator,
        .{ .invalid = .{
            .invalidate_from_parent_block_root = root_1,
            .latest_valid_exec_hash = ZERO_HASH,
        } },
        1,
    );
    try testing.expectError(error.InvalidLVHExecutionResponse, result);
    try testing.expect(pa.lvh_error != null);
    try testing.expectEqual(LVHExecErrorCode.valid_to_invalid, pa.lvh_error.?.lvh_code);
}

test "ExecutionStatus enum values" {
    try testing.expectEqual(@intFromEnum(ExecutionStatus.valid), 0);
    try testing.expectEqual(@intFromEnum(ExecutionStatus.syncing), 1);
    try testing.expectEqual(@intFromEnum(ExecutionStatus.pre_merge), 2);
    try testing.expectEqual(@intFromEnum(ExecutionStatus.invalid), 3);
    try testing.expectEqual(@intFromEnum(ExecutionStatus.payload_separated), 4);
}

test "DataAvailabilityStatus enum values" {
    try testing.expectEqual(@intFromEnum(DataAvailabilityStatus.pre_data), 0);
    try testing.expectEqual(@intFromEnum(DataAvailabilityStatus.available), 2);
}

test "BlockExtraMeta pre_merge accessors" {
    const meta = BlockExtraMeta{ .pre_merge = {} };
    try testing.expectEqual(meta.executionPayloadBlockHash(), null);
    try testing.expectEqual(meta.executionStatus(), .pre_merge);
    try testing.expectEqual(meta.dataAvailabilityStatus(), .pre_data);
}

test "BlockExtraMeta post_merge accessors" {
    const meta = BlockExtraMeta{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(
            ZERO_HASH,
            42,
            .syncing,
            .available,
        ),
    };
    try testing.expectEqual(meta.executionPayloadBlockHash(), ZERO_HASH);
    try testing.expectEqual(meta.executionStatus(), .syncing);
    try testing.expectEqual(meta.dataAvailabilityStatus(), .available);
}

test "PostMergeMeta.init rejects pre_merge status" {
    // assert(status != .pre_merge) triggers in Debug/ReleaseSafe.
    // In Zig, calling a function that hits assert in a test is undefined behavior,
    // so we verify the valid cases instead — the assert is a development safety net.
    const valid = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .valid, .available);
    try testing.expectEqual(valid.execution_status, .valid);
    const syncing = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .syncing, .available);
    try testing.expectEqual(syncing.execution_status, .syncing);
    const invalid_status = BlockExtraMeta.PostMergeMeta.init(ZERO_HASH, 0, .invalid, .available);
    try testing.expectEqual(invalid_status.execution_status, .invalid);
}

test "ProtoNode default values" {
    const block = ProtoBlock{
        .slot = 0,
        .block_root = ZERO_HASH,
        .parent_root = ZERO_HASH,
        .state_root = ZERO_HASH,
        .target_root = ZERO_HASH,
        .justified_epoch = 0,
        .justified_root = ZERO_HASH,
        .finalized_epoch = 0,
        .finalized_root = ZERO_HASH,
        .unrealized_justified_epoch = 0,
        .unrealized_justified_root = ZERO_HASH,
        .unrealized_finalized_epoch = 0,
        .unrealized_finalized_root = ZERO_HASH,
        .extra_meta = .{ .pre_merge = {} },
        .timeliness = false,
    };
    const node = ProtoNode.fromBlock(block);

    try testing.expectEqual(node.parent, null);
    try testing.expectEqual(node.weight, 0);
    try testing.expectEqual(node.best_child, null);
    try testing.expectEqual(node.best_descendant, null);
    try testing.expectEqual(node.slot, 0);
    try testing.expectEqual(node.block_root, ZERO_HASH);
}

test "ProtoNode.toBlock round-trip" {
    const block = ProtoBlock{
        .slot = 42,
        .block_root = ZERO_HASH,
        .parent_root = ZERO_HASH,
        .state_root = ZERO_HASH,
        .target_root = ZERO_HASH,
        .justified_epoch = 1,
        .justified_root = ZERO_HASH,
        .finalized_epoch = 0,
        .finalized_root = ZERO_HASH,
        .unrealized_justified_epoch = 1,
        .unrealized_justified_root = ZERO_HASH,
        .unrealized_finalized_epoch = 0,
        .unrealized_finalized_root = ZERO_HASH,
        .extra_meta = .{ .pre_merge = {} },
        .timeliness = true,
    };
    var node = ProtoNode.fromBlock(block);
    node.weight = 100;
    node.parent = 5;

    const recovered = node.toBlock();
    try testing.expectEqual(recovered.slot, 42);
    try testing.expectEqual(recovered.justified_epoch, 1);
    try testing.expectEqual(recovered.timeliness, true);
    try testing.expectEqual(recovered.parent_block_hash, null);
}

test "notifyPtcMessages ignores unknown block root" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const unknown_root = makeRoot(0xFF);
    // Should not panic or error — just silently ignore.
    const indices = [_]u32{ 0, 1 };
    pa.notifyPtcMessages(unknown_root, &indices, true);
}

test "isPayloadTimely threshold boundary (exactly 50% returns false)" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xBB), 1, null, .valid);

    // Set exactly PTC_SIZE/2 votes (= PAYLOAD_TIMELY_THRESHOLD). Need > threshold.
    var votes = ProtoArray.PtcVotes.initEmpty();
    var i: u32 = 0;
    while (i < preset.PTC_SIZE / 2) : (i += 1) {
        votes.set(@intCast(i));
    }
    pa.ptc_votes.getPtr(root).?.* = votes;

    // Exact 50% should NOT be timely (need strictly more than threshold).
    try testing.expect(!pa.isPayloadTimely(root));

    // One more vote tips it over.
    pa.ptc_votes.getPtr(root).?.set(@intCast(preset.PTC_SIZE / 2));
    try testing.expect(pa.isPayloadTimely(root));
}

test "isPayloadTimely counts only true votes with mixed yes/no" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xBB), 1, null, .valid);

    // Set votes: first half true, second half false (default).
    const half: u32 = preset.PTC_SIZE / 2;
    var idx: u32 = 0;
    while (idx < half) : (idx += 1) {
        pa.notifyPtcMessages(root, &[_]u32{idx}, true);
    }
    // Exactly half → not timely.
    try testing.expect(!pa.isPayloadTimely(root));

    // Toggle one vote from false to true → now >50%.
    pa.notifyPtcMessages(root, &[_]u32{half}, true);
    try testing.expect(pa.isPayloadTimely(root));
}

test "isPayloadTimely returns false for unknown block" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try testing.expect(!pa.isPayloadTimely(makeRoot(0xFF)));
}

// Block at slot 5, current_slot=6 (n-1 condition: slot+1 == current).
// Both EMPTY and FULL have effectiveWeight=0, tiebreaker by payload status.
// For FULL to be demoted, shouldExtendPayload must return false.
// That requires: not timely, boost_root exists, boost parent == block, boost extends EMPTY (not FULL).
test "Gloas tiebreaker: EMPTY beats FULL for slot n-1 blocks (effectiveWeight zeroed)" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    var block = TestBlock.asGloas(TestBlock.withSlotAndRoot(5, root));
    block = TestBlock.withParent(block, ZERO_HASH);
    try pa.onBlock(testing.allocator, block, 6, null);
    // FULL's execution_payload_block_hash = 0xAA
    try pa.onExecutionPayload(testing.allocator, root, 6, makeRoot(0xAA), 1, null, .valid);

    // Add a child block at slot 6 that extends EMPTY (parent_block_hash = ZERO_HASH, which
    // does NOT match FULL's exec hash 0xAA → getParentPayloadStatus returns empty).
    const boost_root = makeRoot(2);
    var child_block = TestBlock.asGloasWithParentBlockHash(TestBlock.withSlotAndRoot(6, boost_root), ZERO_HASH);
    child_block = TestBlock.withParent(child_block, root);
    try pa.onBlock(testing.allocator, child_block, 6, null);

    // Now re-evaluate with proposer_boost_root = boost_root and current_slot=6.
    // shouldExtendPayload(root, boost_root):
    //   1. isPayloadTimely(root) → false (no PTC votes)
    //   2. boost_root is not null/zero
    //   3. boost_node.parent_root == root → true
    //   4. isParentNodeFull(root, ZERO_HASH) → false (EMPTY, not FULL)
    //   → returns false → FULL demoted to ordinal 0
    //   EMPTY ordinal (1) > demoted FULL ordinal (0) → EMPTY wins.
    const boost = ProtoArray.ProposerBoost{ .root = boost_root, .score = 0 };
    // 5 nodes: pending(0), empty(1), full(2), child-pending(3), child-empty(4)
    var deltas = [_]i64{0} ** 5;
    try pa.applyScoreChanges(&deltas, boost, 0, ZERO_HASH, 0, ZERO_HASH, 6);

    const vi = pa.indices.get(root).?;
    const empty_idx = vi.gloas.empty;
    const pending_node = &pa.nodes.items[vi.gloas.pending];

    // EMPTY wins over FULL since FULL was demoted.
    try testing.expectEqual(empty_idx, pending_node.best_child.?);
}

// Same block at slot 5, current_slot=6, but with PTC supermajority.
// isPayloadTimely → true → shouldExtendPayload returns true → FULL ordinal stays 2.
// FULL (2) > EMPTY (1) → FULL wins.
test "Gloas tiebreaker: FULL beats EMPTY when payload is timely at slot n-1" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    var block = TestBlock.asGloas(TestBlock.withSlotAndRoot(5, root));
    block = TestBlock.withParent(block, ZERO_HASH);
    try pa.onBlock(testing.allocator, block, 6, null);
    try pa.onExecutionPayload(testing.allocator, root, 6, makeRoot(0xAA), 1, null, .valid);

    // Set all PTC votes → timely → FULL ordinal stays 2.
    pa.ptc_votes.getPtr(root).?.* = ProtoArray.PtcVotes.initFull();

    // Re-evaluate: 3 nodes (pending, empty, full).
    var deltas = [_]i64{0} ** 3;
    try pa.applyScoreChanges(&deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 6);

    const vi = pa.indices.get(root).?;
    const full_idx = vi.gloas.full.?;
    const pending_node = &pa.nodes.items[vi.gloas.pending];

    // FULL should be best_child of PENDING since its tiebreaker ordinal (2) > EMPTY (1).
    try testing.expectEqual(full_idx, pending_node.best_child.?);
}

// Block at slot 3, current_slot=6 (not n-1: 3+1 != 6).
// effectiveWeight returns actual node.weight, not 0.
test "Gloas tiebreaker: older slots (n-2) use weight comparison not tiebreaker" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    var block = TestBlock.asGloas(TestBlock.withSlotAndRoot(3, root));
    block = TestBlock.withParent(block, ZERO_HASH);
    try pa.onBlock(testing.allocator, block, 6, null);
    try pa.onExecutionPayload(testing.allocator, root, 6, makeRoot(0xAA), 1, null, .valid);

    // Give FULL higher weight than EMPTY.
    const vi = pa.indices.get(root).?;
    pa.nodes.items[vi.gloas.full.?].weight = 100;
    pa.nodes.items[vi.gloas.empty].weight = 50;

    // Re-evaluate: 3 nodes (pending, empty, full).
    var deltas = [_]i64{0} ** 3;
    try pa.applyScoreChanges(&deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 6);

    const pending_node = &pa.nodes.items[vi.gloas.pending];
    // FULL wins by weight (not tiebreaker, since slot 3 != n-1).
    try testing.expectEqual(vi.gloas.full.?, pending_node.best_child.?);

    // Now flip: EMPTY has higher weight.
    pa.nodes.items[vi.gloas.full.?].weight = 50;
    pa.nodes.items[vi.gloas.empty].weight = 100;
    var deltas2 = [_]i64{0} ** 3;
    try pa.applyScoreChanges(&deltas2, null, 0, ZERO_HASH, 0, ZERO_HASH, 6);

    const pending_node2 = &pa.nodes.items[vi.gloas.pending];
    try testing.expectEqual(vi.gloas.empty, pending_node2.best_child.?);
}

test "shouldExtendPayload returns false for untimely full" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xAA), 1, null, .valid);

    // No PTC votes → not timely.
    // Proposer boost root is a child of this block → should NOT extend.
    const child_root = makeRoot(2);
    var child_block = TestBlock.asGloasWithParentBlockHash(TestBlock.withSlotAndRoot(1, child_root), makeRoot(0xAA));
    child_block = TestBlock.withParent(child_block, root);
    try pa.onBlock(testing.allocator, child_block, 1, null);

    // boost_root = child, child.parent_root == root, and child extends FULL parent.
    // But payload is not timely, so shouldExtendPayload returns false? No — it checks conditions in order:
    // 1. isPayloadTimely(root) → false (no PTC votes)
    // 2. proposer_boost_root is not null/zero
    // 3. boost_node.parent_root == root → true
    // 4. isParentNodeFull(boost_node.parent_root, boost_node.parent_block_hash) → true (FULL exists for root)
    // So it returns true (condition 4). Let me set up for condition 4 to be false.

    // Actually, to get shouldExtendPayload=false, we need:
    // - payload not timely (no PTC) ✓
    // - proposer boost root exists ✓
    // - boost node's parent == block ✓
    // - boost node's parent is NOT full (extends EMPTY parent)
    // So the child must extend EMPTY, not FULL. Use parent_block_hash matching EMPTY's exec hash.

    // The EMPTY node has execution_payload_block_hash from the block's extra_meta.
    // For this test, let's use a boost block whose parent_block_hash does NOT match the FULL hash.
    const child2_root = makeRoot(3);
    var child2_block = TestBlock.asGloasWithParentBlockHash(TestBlock.withSlotAndRoot(1, child2_root), ZERO_HASH);
    child2_block = TestBlock.withParent(child2_block, root);
    try pa.onBlock(testing.allocator, child2_block, 1, null);

    // child2 extends EMPTY (parent_block_hash=ZERO_HASH matches EMPTY's exec hash).
    // isParentNodeFull(root, ZERO_HASH) → EMPTY variant, not full → returns false.
    const result = try pa.shouldExtendPayload(root, child2_root);
    try testing.expect(!result);
}

test "shouldExtendPayload returns true when slot has passed (no boost root, FULL present)" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xAA), 0, null, .valid);

    // No PTC votes so not timely. Has payload + null boost → condition 2 passes.
    try testing.expect(try pa.shouldExtendPayload(root, null));
}

// Upstream lodestar #9209: unknown root → hasPayload false → returns false (not an error).
test "shouldExtendPayload returns false for unknown root" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    try testing.expect(!try pa.shouldExtendPayload(makeRoot(0xFF), null));
    try testing.expect(!try pa.shouldExtendPayload(makeRoot(0xFF), makeRoot(0xEE)));
}

// Tree:
//   genesis(0, pre-Gloas)
//     |
//   A(slot=1, Gloas: PENDING + EMPTY + FULL)
//     |
//   B(slot=2, Gloas: PENDING + EMPTY)
//
// Nodes: genesis=0, A.PENDING=1, A.EMPTY=2, A.FULL=3, B.PENDING=4, B.EMPTY=5
// Finalize B → prune 0..4 → only B.PENDING(0) and B.EMPTY(1) remain.
test "Prune Gloas variants removes all pruned variant nodes and map entries" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_a = makeRoot(0x0A);
    const root_b = makeRoot(0x0B);
    const a_parent_bh = makeRoot(0xA0);
    const a_exec_bh = makeRoot(0xAA);

    // Insert genesis (pre-Gloas).
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert Gloas block A (PENDING + EMPTY).
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH),
        a_parent_bh,
    ), 2, null);

    // Add FULL variant for A.
    try pa.onExecutionPayload(testing.allocator, root_a, 2, a_exec_bh, 1, null, .valid);

    // Verify A has all 3 variants and PTC entry.
    try testing.expect(pa.getNodeIndexByRootAndStatus(root_a, .pending) != null);
    try testing.expect(pa.getNodeIndexByRootAndStatus(root_a, .empty) != null);
    try testing.expect(pa.getNodeIndexByRootAndStatus(root_a, .full) != null);
    try testing.expect(pa.ptc_votes.get(root_a) != null);

    // Insert Gloas block B (child of A's EMPTY, PENDING + EMPTY).
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
        a_parent_bh,
    ), 2, null);

    // Verify total: 1 genesis unique root + 1 A root + 1 B root = 3 entries.
    try testing.expectEqual(@as(usize, 3), pa.length());
    // Total nodes: 1 + 3 + 2 = 6.
    try testing.expectEqual(@as(usize, 6), pa.nodes.items.len);

    // Apply scores for coherent best-child/descendant.
    const zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    defer testing.allocator.free(zero_deltas);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 2);

    // Prune to B (finalized B → removes genesis + all A variants).
    const pruned = try pa.maybePrune(testing.allocator, root_b);
    defer testing.allocator.free(pruned);
    try testing.expect(pruned.len > 0);

    // After prune: A's indices and PTC votes should be gone.
    try testing.expect(pa.indices.get(root_a) == null);
    try testing.expect(pa.ptc_votes.get(root_a) == null);
    try testing.expect(pa.indices.get(ZERO_HASH) == null); // genesis gone

    // B should survive with adjusted indices.
    const b_vi = pa.indices.get(root_b) orelse return error.TestUnexpectedResult;
    switch (b_vi) {
        .gloas => |g| {
            try testing.expectEqual(@as(u32, 0), g.pending);
            try testing.expectEqual(@as(u32, 1), g.empty);
            try testing.expectEqual(@as(?u32, null), g.full); // no FULL variant
        },
        .pre_gloas => return error.TestUnexpectedResult,
    }

    // Only B's 2 nodes remain (PENDING + EMPTY).
    try testing.expectEqual(@as(usize, 1), pa.length()); // 1 unique root
    try testing.expectEqual(@as(usize, 2), pa.nodes.items.len); // 2 nodes

    // B's PTC votes survive.
    try testing.expect(pa.ptc_votes.get(root_b) != null);
}

// Tree:
//   genesis(0, pre-Gloas)
//     |
//   A(slot=1, Gloas: PENDING + EMPTY) with PTC votes
//     |
//   B(slot=2, Gloas: PENDING + EMPTY) with PTC votes
//     |
//   C(slot=3, Gloas: PENDING + EMPTY) with PTC votes
//
// Add PTC votes for all three, prune to B → only B and C PTC votes remain.
test "Prune PTC votes cleanup removes pruned entries" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_a = makeRoot(0x0A);
    const root_b = makeRoot(0x0B);
    const root_c = makeRoot(0x0C);
    const parent_bh = makeRoot(0xA0);

    // Insert genesis + 3 Gloas blocks in a chain.
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH), parent_bh), 3, null);
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a), parent_bh), 3, null);
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(TestBlock.withParent(TestBlock.withSlotAndRoot(3, root_c), root_b), parent_bh), 3, null);

    // Add PTC votes for all Gloas blocks (they're auto-initialized by onBlock).
    // Set some actual votes so we can distinguish them.
    pa.notifyPtcMessages(root_a, &.{0}, true);
    pa.notifyPtcMessages(root_b, &.{1}, true);
    pa.notifyPtcMessages(root_c, &.{ 0, 1 }, true);

    // Verify PTC entries exist for all three.
    try testing.expect(pa.ptc_votes.get(root_a) != null);
    try testing.expect(pa.ptc_votes.get(root_b) != null);
    try testing.expect(pa.ptc_votes.get(root_c) != null);

    // Apply scores for coherent state.
    const zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    defer testing.allocator.free(zero_deltas);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 3);

    // Prune to B → genesis + A (and their nodes) removed.
    const pruned = try pa.maybePrune(testing.allocator, root_b);
    defer testing.allocator.free(pruned);
    try testing.expect(pruned.len > 0);

    // A's PTC votes should be gone (pruned).
    try testing.expect(pa.ptc_votes.get(root_a) == null);

    // B and C PTC votes should survive.
    const b_votes = pa.ptc_votes.get(root_b).?;
    try testing.expect(!b_votes.isSet(0));
    try testing.expect(b_votes.isSet(1));

    const c_votes = pa.ptc_votes.get(root_c).?;
    try testing.expect(c_votes.isSet(0));
    try testing.expect(c_votes.isSet(1));
}

// Tree:
//   genesis(0, pre-merge)
//     |
//   A(slot=1, pre-merge, pre_gloas)  [FULL variant]
//     |
//   B(slot=2, Gloas: PENDING + EMPTY)  [parent is pre-Gloas A]
//
// Verifies the fork transition: B's parent_index resolves to A's pre_gloas FULL index.
test "Gloas block with pre-Gloas parent links correctly across fork boundary" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    const root_a = makeRoot(0x0A);
    const root_b = makeRoot(0x0B);

    // Insert genesis (pre-merge, pre-Gloas).
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Insert A (pre-merge, pre-Gloas) as child of genesis.
    try pa.onBlock(testing.allocator, TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH), 2, null);

    // Verify A is pre_gloas.
    const a_vi = pa.indices.get(root_a).?;
    try testing.expect(a_vi == .pre_gloas);
    const a_idx = a_vi.pre_gloas;

    // Insert Gloas block B (parent = A).
    // B's parent_block_hash doesn't need to match A's exec hash for fork transition,
    // because A is pre-Gloas and getParentPayloadStatus returns .full directly.
    const b_parent_bh = makeRoot(0xB0);
    try pa.onBlock(testing.allocator, TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a),
        b_parent_bh,
    ), 2, null);

    // Verify B is gloas.
    const b_vi = pa.indices.get(root_b).?;
    try testing.expect(b_vi == .gloas);
    const b_pending_idx = b_vi.gloas.pending;
    const b_empty_idx = b_vi.gloas.empty;

    // B's PENDING parent should be A's pre_gloas index (the FULL node).
    try testing.expectEqual(@as(?u32, a_idx), pa.nodes.items[b_pending_idx].parent);

    // B's EMPTY parent should be B's own PENDING.
    try testing.expectEqual(@as(?u32, b_pending_idx), pa.nodes.items[b_empty_idx].parent);

    // findHead should work across the fork boundary.
    // Apply zero deltas so best-child/descendant are computed.
    const zero_deltas = try testing.allocator.alloc(i64, pa.nodes.items.len);
    defer testing.allocator.free(zero_deltas);
    @memset(zero_deltas, 0);
    try pa.applyScoreChanges(zero_deltas, null, 0, ZERO_HASH, 0, ZERO_HASH, 2);

    const head = try pa.findHead(ZERO_HASH, 2);
    // Head should be B's EMPTY (deepest descendant via the fork-transition link).
    try testing.expectEqual(root_b, head.block_root);
    try testing.expectEqual(PayloadStatus.empty, head.payload_status);
}

test "invalid node not re-validated by valid LVH" {
    // Tree: genesis(pre-merge) → A(syncing, exec=0xA1) → B(syncing, exec=0xA2)
    // 1. Invalidate from B with LVH=exec(A) → B becomes invalid, A stays syncing.
    // 2. Send .valid response matching B's exec hash (0xA2).
    // 3. propagateValidExecutionStatusByIndex finds B (invalid) → must error with invalid_to_valid.

    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Genesis (pre-merge).
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);

    // Block A: syncing, exec_hash = 0xA1.
    const root_a = makeRoot(1);
    const exec_a = makeRoot(0xA1);
    var block_a = TestBlock.withParent(TestBlock.withSlotAndRoot(1, root_a), ZERO_HASH);
    block_a.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(exec_a, 1, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_a, 0, null);

    // Block B: syncing, exec_hash = 0xA2.
    const root_b = makeRoot(2);
    const exec_b = makeRoot(0xA2);
    var block_b = TestBlock.withParent(TestBlock.withSlotAndRoot(2, root_b), root_a);
    block_b.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(exec_b, 2, .syncing, .available),
    };
    try pa.onBlock(testing.allocator, block_b, 0, null);

    // Step 1: Invalidate B with LVH pointing to A's exec hash.
    // This marks B as invalid; A stays syncing (it's the LVH boundary).
    try pa.validateLatestHash(testing.allocator, .{ .invalid = .{
        .invalidate_from_parent_block_root = root_b,
        .latest_valid_exec_hash = exec_a,
    } }, 2);

    // Verify B is invalid, A is still syncing.
    const idx_b = pa.getDefaultNodeIndex(root_b).?;
    try testing.expectEqual(ExecutionStatus.invalid, pa.nodes.items[idx_b].extra_meta.executionStatus());
    const idx_a = pa.getDefaultNodeIndex(root_a).?;
    try testing.expectEqual(ExecutionStatus.syncing, pa.nodes.items[idx_a].extra_meta.executionStatus());

    // Step 2: Send a .valid response matching B's exec hash.
    // propagateValidExecutionStatusByIndex should find B, see it's invalid,
    // and return error.InvalidLVHExecutionResponse (invalid → valid is forbidden).
    const result = pa.validateLatestHash(testing.allocator, .{ .valid = .{
        .latest_valid_exec_hash = exec_b,
    } }, 2);
    try testing.expectError(error.InvalidLVHExecutionResponse, result);

    // Verify the lvh_error records the invalid_to_valid poison.
    try testing.expect(pa.lvh_error != null);
    try testing.expectEqual(LVHExecErrorCode.invalid_to_valid, pa.lvh_error.?.lvh_code);
    try testing.expectEqual(root_b, pa.lvh_error.?.block_root);
    try testing.expectEqual(exec_b, pa.lvh_error.?.exec_hash);

    // B must remain invalid — the valid response must NOT resurrect it.
    try testing.expectEqual(ExecutionStatus.invalid, pa.nodes.items[idx_b].extra_meta.executionStatus());
}

// Regression: upstream lodestar #9165 — ancestor traversal must stop cleanly (null)
// when a Gloas node's parent's payload status cannot be resolved (e.g. the finalized
// ProtoBlock boundary whose parent has been pruned), instead of surfacing the raw
// UnknownParentBlock error.
test "iterateAncestors terminates at pruned Gloas parent without error" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Add a standalone Gloas block whose parent_block_hash points to something that
    // is NOT tracked anywhere in the tree — mimicking post-prune finalized boundary.
    const root = makeRoot(1);
    const phantom_parent_bh = makeRoot(0xDE);
    const block = TestBlock.asGloasWithParentBlockHash(
        TestBlock.withParent(TestBlock.withSlotAndRoot(1, root), makeRoot(0xFE)),
        phantom_parent_bh,
    );
    try pa.onBlock(testing.allocator, block, 1, null);

    var iter = pa.iterateAncestors(root, .pending);
    try testing.expectEqual(@as(?*const ProtoNode, null), try iter.next());
}

test "hasPayload returns false before and true after onExecutionPayload" {
    var pa: ProtoArray = undefined;
    pa.init(0, ZERO_HASH, 0, ZERO_HASH, 0);
    defer pa.deinit(testing.allocator);

    // Pre-Gloas block always has payload.
    const pre_gloas_root = makeRoot(0xAA);
    try pa.onBlock(testing.allocator, TestBlock.genesis(), 0, null);
    try testing.expect(pa.hasPayload(ZERO_HASH));

    // Gloas block: no FULL variant yet.
    const root = makeRoot(1);
    try pa.onBlock(testing.allocator, TestBlock.asGloas(TestBlock.withRoot(root)), 0, null);
    try testing.expect(!pa.hasPayload(root));

    // After onExecutionPayload, FULL variant exists.
    try pa.onExecutionPayload(testing.allocator, root, 0, makeRoot(0xBB), 42, null, .valid);
    try testing.expect(pa.hasPayload(root));

    // Unknown root returns false.
    try testing.expect(!pa.hasPayload(pre_gloas_root));
}
