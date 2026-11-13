//! Spec `Store` and handlers: https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/specs/phase0/fork-choice.md
//! with the Gloas (ePBS) and Heze (FOCIL) modifications.
//!
//! Blocks live in a struct-of-arrays list ordered by insertion. Because `onBlock`
//! requires a known parent, every block's parent has a smaller index; `head.zig`
//! relies on that to run bottom-up passes over the array instead of recursing.
//! Block indices are stable until `prune` compacts the array.
//!
//! Gloas fork choice nodes are `(block, payload_status)` pairs. Pre-Gloas blocks
//! only ever use `.pending`, which plays the role of the spec's one node per block.

const std = @import("std");
const Allocator = std.mem.Allocator;
const ct = @import("consensus_types");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const preset = @import("preset").preset;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const constants = @import("constants");
const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;
const fork_types = @import("fork_types");
const AnyBeaconBlock = fork_types.AnyBeaconBlock;
const AnyIndexedAttestation = fork_types.AnyIndexedAttestation;
const AnyAttesterSlashing = fork_types.AnyAttesterSlashing;
const ForkTypes = fork_types.ForkTypes;
const head_mod = @import("head.zig");
const vote_targets_mod = @import("vote_targets.zig");
const VoteTargets = vote_targets_mod.VoteTargets;
const TargetId = vote_targets_mod.TargetId;
const NO_TARGET = vote_targets_mod.NO_TARGET;

pub const Slot = ct.primitive.Slot.Type;
pub const Epoch = ct.primitive.Epoch.Type;
pub const Root = ct.primitive.Root.Type;
pub const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
pub const Checkpoint = ct.phase0.Checkpoint.Type;
pub const AttestationData = ct.phase0.AttestationData.Type;
pub const PayloadAttestationData = ct.gloas.PayloadAttestationData.Type;

pub const BlockIndex = u32;
pub const NO_BLOCK: BlockIndex = std.math.maxInt(BlockIndex);
pub const BASIS_POINTS: u64 = 10_000;
pub const PAYLOAD_TIMELY_THRESHOLD: u64 = preset.PTC_SIZE / 2;
pub const DATA_AVAILABILITY_TIMELY_THRESHOLD: u64 = preset.PTC_SIZE / 2;
pub const ATTESTATION_TIMELINESS_INDEX = 0;
pub const PTC_TIMELINESS_INDEX = 1;

pub const Error = error{
    AnchorStateRootMismatch,
    PreGenesisTime,
    TooManyBlocks,
    UnknownParent,
    ParentPayloadNotVerified,
    FutureBlock,
    BlockBeforeFinalizedSlot,
    NotFinalizedDescendant,
    AttestationTargetEpochNotCurrentOrPrevious,
    AttestationTargetEpochSlotMismatch,
    UnknownAttestationTarget,
    UnknownAttestationBlock,
    AttestationForFutureBlock,
    InvalidAttestationIndex,
    SameSlotFullVote,
    AttestationPayloadNotVerified,
    AttestationTargetNotInChain,
    AttestationNotYetPast,
    NotSlashableAttestationData,
    UnknownBlock,
    ValidatorNotInPtc,
    InvalidPtcPosition,
    PtcMessageNotCurrentSlot,
    ProposerBoostNotWornOff,
    PayloadNotFromPreviousSlot,
    ExecutionStatusMismatch,
    ParentPayloadInvalid,
    InvalidJustifiedPayload,
    UnknownPayload,
    UnknownLatestValidHash,
    PayloadInvalidToValid,
    PayloadValidToInvalid,
} || Allocator.Error;

/// Spec `PayloadStatus` values; the numeric values are what the spec test vectors report.
pub const PayloadStatus = enum(u8) {
    empty = 0,
    full = 1,
    pending = 2,
};

/// The execution engine's verdict on one payload (optimistic sync `NOT_VALIDATED` is
/// `.syncing`). Ordered so that the worse status has the higher value.
pub const ExecutionStatus = enum(u8) {
    pre_merge = 0,
    valid = 1,
    syncing = 2,
    invalid = 3,

    pub fn worst(a: ExecutionStatus, b: ExecutionStatus) ExecutionStatus {
        return @enumFromInt(@max(@intFromEnum(a), @intFromEnum(b)));
    }
};

/// Spec `ForkChoiceNode`. Pre-Gloas nodes always carry `.pending`.
pub const ForkChoiceNode = struct {
    block: BlockIndex,
    payload_status: PayloadStatus,

    pub fn eql(a: ForkChoiceNode, b: ForkChoiceNode) bool {
        return a.block == b.block and a.payload_status == b.payload_status;
    }
};

/// Spec `LatestMessage`. The attestation slot is kept for every fork; pre-Gloas
/// comparisons use its epoch, which `validateOnAttestation` ties to the target epoch.
/// `block` is `NO_BLOCK` once `prune` dropped the voted block; the slot still gates
/// replacement as the spec's entry would.
pub const LatestMessage = struct {
    slot: Slot,
    block: BlockIndex,
    payload_present: bool,

    pub const NO_SLOT: Slot = std.math.maxInt(Slot);
    pub const none: LatestMessage = .{ .slot = NO_SLOT, .block = NO_BLOCK, .payload_present = false };

    pub fn isNone(self: LatestMessage) bool {
        return self.slot == NO_SLOT;
    }
};

/// One PTC member's vote on a block. Spec: `payload_timeliness_vote[root][i]` and
/// `payload_data_availability_vote[root][i]`, `null` until the member votes.
pub const PtcVote = packed struct(u8) {
    voted: bool = false,
    payload_present: bool = false,
    blob_data_available: bool = false,
    _: u5 = 0,
};

pub const PtcVotes = [preset.PTC_SIZE]PtcVote;

pub const InclusionListSatisfaction = enum(u8) { unknown, unsatisfied, satisfied };

/// PTC positions held by one validator (spec `ptc_indices`).
pub const PtcPositions = struct {
    buffer: [preset.PTC_SIZE]u16 = undefined,
    len: usize = 0,

    pub fn slice(self: *const PtcPositions) []const u16 {
        return self.buffer[0..self.len];
    }
};

/// Columns of the block table. Hot columns for head computation are `parent`,
/// `slot`, `fork`, `parent_payload_status` and `payload_verified`; the rest is
/// read per block when handling a single message.
pub const Block = struct {
    root: Root,
    parent: BlockIndex,
    slot: Slot,
    proposer_index: ValidatorIndex,
    state_root: Root,
    fork: ForkSeq,
    /// Post-state `current_justified_checkpoint`.
    justified_checkpoint: Checkpoint,
    /// Post-state `finalized_checkpoint`.
    finalized_checkpoint: Checkpoint,
    /// Spec `store.unrealized_justifications[root]`.
    unrealized_justified_checkpoint: Checkpoint,
    /// Spec `store.block_timeliness[root]`, indexed by `*_TIMELINESS_INDEX`.
    timely: [2]bool,
    /// Spec `get_parent_payload_status(store, block)`, `.pending` for pre-Gloas blocks.
    parent_payload_status: PayloadStatus,
    /// The block's own payload: `body.execution_payload.block_hash` before Gloas, the bid's
    /// `block_hash` from Gloas on, zero before the merge.
    payload_block_hash: Root,
    bid_parent_block_hash: Root,
    /// The engine's verdict on the block's own payload. Node status is derived from the
    /// payloads on a node's chain (see `head.zig`), never stored.
    execution_status: ExecutionStatus,
    /// Spec `root in store.payloads`.
    payload_verified: bool,
    /// Spec `store.payload_inclusion_list_satisfaction[root]`.
    inclusion_list_satisfaction: InclusionListSatisfaction,
};

/// What `on_block` reads from a block and its post-state. Lets a caller that already
/// holds these facts (block import, restart from the database) skip the state.
pub const BlockSummary = struct {
    root: Root,
    parent_root: Root,
    slot: Slot,
    proposer_index: ValidatorIndex,
    state_root: Root,
    fork: ForkSeq,
    /// Post-state `current_justified_checkpoint`.
    justified_checkpoint: Checkpoint,
    /// Post-state `finalized_checkpoint`.
    finalized_checkpoint: Checkpoint,
    /// Spec `compute_pulled_up_tip`: the post-state after `process_justification_and_finalization`.
    unrealized_justified_checkpoint: Checkpoint,
    unrealized_finalized_checkpoint: Checkpoint,
    /// See `Block.payload_block_hash`.
    payload_block_hash: Root = constants.ZERO_HASH,
    /// Gloas `signed_execution_payload_bid.message.parent_block_hash`, zero before Gloas.
    bid_parent_block_hash: Root = constants.ZERO_HASH,
    /// The engine's verdict on the block's own payload: `.pre_merge` iff
    /// `payload_block_hash` is zero, and `.syncing` for Gloas blocks, whose payload only
    /// arrives with the envelope.
    execution_status: ExecutionStatus,
    /// Milliseconds into the block's slot at which the block arrived, the time
    /// `record_block_timeliness` judges. Null means the store's time, as in the spec; a
    /// client that imports a block later than it received it passes the arrival.
    arrival_ms_into_slot: ?u64 = null,

    /// `execution_status` is the engine's `newPayload` verdict; it is normalized to
    /// `.pre_merge` for blocks without a payload and `.syncing` for Gloas blocks.
    pub fn fromBlock(allocator: Allocator, block: AnyBeaconBlock, post_state: *CachedBeaconState, execution_status: ExecutionStatus) !BlockSummary {
        var root: Root = undefined;
        try block.hashTreeRoot(allocator, &root);
        const state = post_state.state;
        var justified: Checkpoint = undefined;
        try state.currentJustifiedCheckpoint(&justified);
        var finalized: Checkpoint = undefined;
        try state.finalizedCheckpoint(&finalized);
        const unrealized = try state_transition.computeUnrealizedCheckpoints(allocator, post_state);
        var summary: BlockSummary = .{
            .root = root,
            .parent_root = block.parentRoot().*,
            .slot = block.slot(),
            .proposer_index = block.proposerIndex(),
            .state_root = block.stateRoot().*,
            .fork = block.forkSeq(),
            .justified_checkpoint = justified,
            .finalized_checkpoint = finalized,
            .unrealized_justified_checkpoint = unrealized.justified_checkpoint,
            .unrealized_finalized_checkpoint = unrealized.finalized_checkpoint,
            .execution_status = execution_status,
        };
        if (block.forkSeq().gte(.gloas)) {
            const body = block.beaconBlockBody();
            summary.payload_block_hash = (try body.signedExecutionPayloadBidBlockHash()).*;
            summary.bid_parent_block_hash = (try body.signedExecutionPayloadBidParentBlockHash()).*;
            summary.execution_status = .syncing;
        } else if (block.forkSeq().gte(.bellatrix)) {
            summary.payload_block_hash = (try block.beaconBlockBody().executionPayload()).blockHash().*;
        }
        if (std.mem.eql(u8, &summary.payload_block_hash, &constants.ZERO_HASH)) summary.execution_status = .pre_merge;
        return summary;
    }
};

/// Balances of the justified checkpoint state (spec `store.checkpoint_states[store.justified_checkpoint]`).
/// Owned by the store once returned from `StateProvider`.
pub const JustifiedBalances = struct {
    /// `state.validators[i].effective_balance / EFFECTIVE_BALANCE_INCREMENT` for every validator.
    effective_balance_increments: []u16,
    /// Set for validators active in the state's current epoch and not slashed.
    active_unslashed: std.DynamicBitSetUnmanaged,

    pub const empty: JustifiedBalances = .{ .effective_balance_increments = &.{}, .active_unslashed = .{} };

    pub fn deinit(self: *JustifiedBalances, allocator: Allocator) void {
        allocator.free(self.effective_balance_increments);
        self.active_unslashed.deinit(allocator);
        self.* = .empty;
    }
};

/// What the fast confirmation rule reads from one beacon state (spec `balance_source`).
pub const BalanceSource = struct {
    /// `state.validators[i].effective_balance / EFFECTIVE_BALANCE_INCREMENT` for every validator.
    effective_balance_increments: []u16,
    /// Set for validators active in the state's current epoch.
    active: std.DynamicBitSetUnmanaged,
    slashed: std.DynamicBitSetUnmanaged,

    pub fn deinit(self: *BalanceSource, allocator: Allocator) void {
        allocator.free(self.effective_balance_increments);
        self.active.deinit(allocator);
        self.slashed.deinit(allocator);
        self.* = undefined;
    }
};

/// Everything the fork choice needs from beacon states it does not hold itself.
pub const StateProvider = struct {
    ctx: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        /// Balances of the state at `checkpoint`, allocated with `allocator`.
        justifiedBalances: *const fn (ctx: *anyopaque, allocator: Allocator, checkpoint: Checkpoint) anyerror!JustifiedBalances,
        /// Members of every beacon committee of `slot`, taken from the state of block `root`
        /// (spec `is_head_weak`). Appended to `out`.
        slotCommitteeMembers: *const fn (ctx: *anyopaque, allocator: Allocator, root: Root, slot: Slot, out: *std.ArrayList(ValidatorIndex)) anyerror!void,
        /// Fast confirmation only: the state at `checkpoint` (spec `store.checkpoint_states`).
        checkpointBalanceSource: ?*const fn (ctx: *anyopaque, allocator: Allocator, checkpoint: Checkpoint) anyerror!BalanceSource = null,
        /// Fast confirmation only: the state of block `root`, advanced to the start of `epoch`
        /// when it is older (spec `get_pulled_up_head_state`).
        pulledUpBalanceSource: ?*const fn (ctx: *anyopaque, allocator: Allocator, root: Root, epoch: Epoch) anyerror!BalanceSource = null,
    };

    pub fn justifiedBalances(self: StateProvider, allocator: Allocator, checkpoint: Checkpoint) !JustifiedBalances {
        return self.vtable.justifiedBalances(self.ctx, allocator, checkpoint);
    }

    pub fn slotCommitteeMembers(self: StateProvider, allocator: Allocator, root: Root, slot: Slot, out: *std.ArrayList(ValidatorIndex)) !void {
        return self.vtable.slotCommitteeMembers(self.ctx, allocator, root, slot, out);
    }

    pub fn checkpointBalanceSource(self: StateProvider, allocator: Allocator, checkpoint: Checkpoint) !BalanceSource {
        const get = self.vtable.checkpointBalanceSource orelse return error.FastConfirmationUnsupported;
        return get(self.ctx, allocator, checkpoint);
    }

    pub fn pulledUpBalanceSource(self: StateProvider, allocator: Allocator, root: Root, epoch: Epoch) !BalanceSource {
        const get = self.vtable.pulledUpBalanceSource orelse return error.FastConfirmationUnsupported;
        return get(self.ctx, allocator, root, epoch);
    }
};

pub const RootContext = struct {
    pub fn hash(_: RootContext, key: Root) u64 {
        return std.mem.readInt(u64, key[0..8], .little);
    }

    pub fn eql(_: RootContext, a: Root, b: Root) bool {
        return std.mem.eql(u8, &a, &b);
    }
};

pub const RootIndexMap = std.HashMapUnmanaged(Root, BlockIndex, RootContext, 80);

pub const Store = struct {
    allocator: Allocator,
    config: *const BeaconConfig,
    timing: SlotTiming,
    time_ms: u64,
    genesis_time_ms: u64,
    justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    unrealized_justified_checkpoint: Checkpoint,
    unrealized_finalized_checkpoint: Checkpoint,
    proposer_boost_root: Root,
    equivocating_indices: std.DynamicBitSetUnmanaged,
    blocks: std.MultiArrayList(Block),
    index_by_root: RootIndexMap,
    /// Parallel to `blocks`; only meaningful for Gloas blocks.
    ptc_votes: std.ArrayList(PtcVotes),
    /// Dense by validator index: each validator's latest message as an id into `vote_targets`.
    latest_votes: std.ArrayList(TargetId),
    /// Votes whose slot is not yet past, one per validator like `latest_votes`; applied
    /// by the tick that makes their slot past. The spec rejects such attestations and
    /// expects the caller to retry; gossip delivers them in their own slot.
    queued_votes: std.ArrayList(TargetId),
    vote_targets: VoteTargets,
    justified_balances: JustifiedBalances,
    /// `effective_balance_increments` with inactive and slashed validators zeroed:
    /// the per-validator weight `get_attestation_score` sums.
    justified_vote_increments: []u16,
    /// Sum of `justified_vote_increments` in Gwei (`get_total_balance` of the active unslashed set).
    justified_total_balance: u64,
    provider: StateProvider,
    head_cache: head_mod.Cache,
    /// The status of the node the root block hangs from. `.pre_merge` for an anchor,
    /// whose ancestors count as validated; `prune` carries the dropped ancestors'
    /// derived status here so a Gloas root's `pending` and `empty` nodes keep it.
    root_base_status: ExecutionStatus,

    /// Spec `get_forkchoice_store`. `execution_status` is the verdict on the anchor's own
    /// payload: `.valid` at genesis, `.syncing` for a checkpoint the engine has not seen.
    pub fn init(
        allocator: Allocator,
        config: *const BeaconConfig,
        anchor_state: *CachedBeaconState,
        anchor_block: AnyBeaconBlock,
        execution_status: ExecutionStatus,
        provider: StateProvider,
    ) !Store {
        const state = anchor_state.state;
        const state_root = try state.hashTreeRoot();
        if (!std.mem.eql(u8, state_root, anchor_block.stateRoot())) return error.AnchorStateRootMismatch;
        var summary = try BlockSummary.fromBlock(allocator, anchor_block, anchor_state, execution_status);
        summary.unrealized_justified_checkpoint = summary.justified_checkpoint;
        summary.unrealized_finalized_checkpoint = summary.finalized_checkpoint;
        return initFromSummary(allocator, config, try state.genesisTime(), summary, provider);
    }

    /// `get_forkchoice_store` from the anchor's facts alone. `anchor.slot` must be the
    /// anchor state's slot and the checkpoints the anchor state's realized ones.
    pub fn initFromSummary(
        allocator: Allocator,
        config: *const BeaconConfig,
        genesis_time: u64,
        anchor: BlockSummary,
        provider: StateProvider,
    ) !Store {
        const checkpoint: Checkpoint = .{ .epoch = computeEpochAtSlot(anchor.slot), .root = anchor.root };
        // Owned by `self` from here on: `self.deinit` is the only cleanup.
        const vote_targets = try VoteTargets.init(allocator);
        var self: Store = .{
            .allocator = allocator,
            .config = config,
            .timing = SlotTiming.init(config, secondsToMilliseconds(genesis_time)),
            .time_ms = 0,
            .genesis_time_ms = secondsToMilliseconds(genesis_time),
            .justified_checkpoint = checkpoint,
            .finalized_checkpoint = checkpoint,
            .unrealized_justified_checkpoint = checkpoint,
            .unrealized_finalized_checkpoint = checkpoint,
            .proposer_boost_root = constants.ZERO_HASH,
            .equivocating_indices = .{},
            .blocks = .empty,
            .index_by_root = .empty,
            .ptc_votes = .empty,
            .latest_votes = .empty,
            .queued_votes = .empty,
            .vote_targets = vote_targets,
            .justified_balances = .empty,
            .justified_vote_increments = &.{},
            .justified_total_balance = 0,
            .provider = provider,
            .head_cache = .empty,
            .root_base_status = .pre_merge,
        };
        errdefer self.deinit();
        self.time_ms = self.timing.timeAtSlotMs(anchor.slot);
        try checkExecutionStatus(&anchor);
        try self.appendBlock(.{
            .root = anchor.root,
            .parent = NO_BLOCK,
            .slot = anchor.slot,
            .proposer_index = anchor.proposer_index,
            .state_root = anchor.state_root,
            .fork = anchor.fork,
            .justified_checkpoint = anchor.justified_checkpoint,
            .finalized_checkpoint = anchor.finalized_checkpoint,
            .unrealized_justified_checkpoint = checkpoint,
            .timely = .{ true, true },
            .parent_payload_status = .pending,
            .payload_block_hash = anchor.payload_block_hash,
            .bid_parent_block_hash = anchor.bid_parent_block_hash,
            .execution_status = anchor.execution_status,
            .payload_verified = false,
            .inclusion_list_satisfaction = .unknown,
        });
        try self.refreshJustifiedBalances(self.justified_checkpoint);
        return self;
    }

    pub fn deinit(self: *Store) void {
        self.head_cache.deinit(self.allocator);
        self.allocator.free(self.justified_vote_increments);
        self.justified_balances.deinit(self.allocator);
        self.latest_votes.deinit(self.allocator);
        self.queued_votes.deinit(self.allocator);
        self.vote_targets.deinit(self.allocator);
        self.ptc_votes.deinit(self.allocator);
        self.index_by_root.deinit(self.allocator);
        self.blocks.deinit(self.allocator);
        self.equivocating_indices.deinit(self.allocator);
        self.* = undefined;
    }

    // --- time -------------------------------------------------------------------------

    /// Spec `get_current_slot`.
    pub fn currentSlot(self: *const Store) Slot {
        return self.timing.slotAtTimeMs(self.time_ms);
    }

    /// Spec `get_current_store_epoch`.
    pub fn currentEpoch(self: *const Store) Epoch {
        return computeEpochAtSlot(self.currentSlot());
    }

    /// Spec `get_time_into_slot_ms`.
    pub fn timeIntoSlotMs(self: *const Store) u64 {
        return self.time_ms - self.timing.timeAtSlotMs(self.currentSlot());
    }

    /// Spec `get_slot_component_duration_ms` for the fork of the current slot.
    pub fn slotComponentDurationMs(self: *const Store, basis_points: u64) u64 {
        const fork = self.config.forkSeq(self.currentSlot());
        return basis_points * self.config.getSlotDurationMs(fork) / BASIS_POINTS;
    }

    /// Spec `get_attestation_due_ms`.
    pub fn attestationDueMs(self: *const Store) u64 {
        const fork = self.config.forkSeq(self.currentSlot());
        const bps = if (fork.gte(.gloas)) self.config.chain.ATTESTATION_DUE_BPS_GLOAS else self.config.chain.ATTESTATION_DUE_BPS;
        return self.slotComponentDurationMs(bps);
    }

    /// Spec `get_payload_attestation_due_ms`.
    pub fn payloadAttestationDueMs(self: *const Store) u64 {
        return self.slotComponentDurationMs(self.config.chain.PAYLOAD_ATTESTATION_DUE_BPS);
    }

    /// Spec `get_proposer_reorg_cutoff_ms`.
    pub fn proposerReorgCutoffMs(self: *const Store) u64 {
        return self.slotComponentDurationMs(self.config.chain.PROPOSER_REORG_CUTOFF_BPS);
    }

    /// Whether the Gloas fork choice rules apply to the store right now.
    pub fn isGloas(self: *const Store) bool {
        return self.config.forkSeq(self.currentSlot()).gte(.gloas);
    }

    // --- block table ------------------------------------------------------------------

    pub fn blockIndex(self: *const Store, root: Root) ?BlockIndex {
        return self.index_by_root.get(root);
    }

    /// Spec `root in store.blocks`.
    pub fn hasBlock(self: *const Store, root: Root) bool {
        return self.index_by_root.contains(root);
    }

    pub fn blockCount(self: *const Store) usize {
        return self.blocks.len;
    }

    pub fn blockRoot(self: *const Store, index: BlockIndex) Root {
        return self.blocks.items(.root)[index];
    }

    pub fn blockSlot(self: *const Store, index: BlockIndex) Slot {
        return self.blocks.items(.slot)[index];
    }

    fn appendBlock(self: *Store, block: Block) !void {
        if (self.blocks.len >= NO_BLOCK) return error.TooManyBlocks;
        const index: BlockIndex = @intCast(self.blocks.len);
        try self.blocks.ensureUnusedCapacity(self.allocator, 1);
        try self.ptc_votes.ensureUnusedCapacity(self.allocator, 1);
        try self.index_by_root.putNoClobber(self.allocator, block.root, index);
        self.blocks.appendAssumeCapacity(block);
        self.ptc_votes.appendAssumeCapacity(@splat(.{}));
        self.head_cache.dirty = true;
    }

    /// The node a pre-Gloas caller means by "the block": `.pending` for every block.
    pub fn pendingNode(index: BlockIndex) ForkChoiceNode {
        return .{ .block = index, .payload_status = .pending };
    }

    /// Spec `get_ancestor`. Walks parent links until a block at or below `slot`; the
    /// walk stops at the anchor, which has no parent in the store.
    pub fn getAncestor(self: *const Store, node: ForkChoiceNode, slot: Slot) ForkChoiceNode {
        const slots = self.blocks.items(.slot);
        const parents = self.blocks.items(.parent);
        const parent_statuses = self.blocks.items(.parent_payload_status);
        var current = node;
        while (slots[current.block] > slot) {
            const parent = parents[current.block];
            if (parent == NO_BLOCK) break;
            const parent_status = parent_statuses[current.block];
            current = .{ .block = parent, .payload_status = parent_status };
        }
        return current;
    }

    /// Spec `is_ancestor`.
    pub fn isAncestor(self: *const Store, node: ForkChoiceNode, ancestor: ForkChoiceNode) bool {
        const node_ancestor = self.getAncestor(node, self.blockSlot(ancestor.block));
        if (node_ancestor.block != ancestor.block) return false;
        return node_ancestor.payload_status == ancestor.payload_status or ancestor.payload_status == .pending;
    }

    /// Spec `get_checkpoint_block`.
    pub fn getCheckpointBlock(self: *const Store, index: BlockIndex, epoch: Epoch) BlockIndex {
        return self.getAncestor(pendingNode(index), computeStartSlotAtEpoch(epoch)).block;
    }

    /// Spec `get_shuffling_dependent_root`.
    pub fn getShufflingDependentRoot(self: *const Store, index: BlockIndex, epoch: Epoch) Root {
        const dependent_slot = computeShufflingDependentSlot(epoch);
        return self.blockRoot(self.getAncestor(pendingNode(index), dependent_slot).block);
    }

    // --- checkpoints ------------------------------------------------------------------

    /// Spec `update_checkpoints`.
    pub fn updateCheckpoints(self: *Store, justified: Checkpoint, finalized: Checkpoint) !void {
        if (justified.epoch > self.justified_checkpoint.epoch) {
            try self.refreshJustifiedBalances(justified);
            self.justified_checkpoint = justified;
        }
        if (finalized.epoch > self.finalized_checkpoint.epoch) {
            self.finalized_checkpoint = finalized;
            self.head_cache.dirty = true;
        }
    }

    /// Spec `update_unrealized_checkpoints`.
    pub fn updateUnrealizedCheckpoints(self: *Store, justified: Checkpoint, finalized: Checkpoint) void {
        if (justified.epoch > self.unrealized_justified_checkpoint.epoch) {
            self.unrealized_justified_checkpoint = justified;
        }
        if (finalized.epoch > self.unrealized_finalized_checkpoint.epoch) {
            self.unrealized_finalized_checkpoint = finalized;
        }
    }

    fn refreshJustifiedBalances(self: *Store, checkpoint: Checkpoint) !void {
        var balances = try self.provider.justifiedBalances(self.allocator, checkpoint);
        errdefer balances.deinit(self.allocator);
        const increments = balances.effective_balance_increments;
        const vote_increments = try self.allocator.alloc(u16, increments.len);
        var total: u64 = 0;
        for (increments, vote_increments, 0..) |increment, *out, i| {
            const active = i < balances.active_unslashed.bit_length and balances.active_unslashed.isSet(i);
            out.* = if (active) increment else 0;
            total += out.*;
        }
        self.head_cache.applyBalanceChange(self.vote_targets.nodes.items, self.justified_vote_increments, vote_increments);
        self.justified_balances.deinit(self.allocator);
        self.allocator.free(self.justified_vote_increments);
        self.justified_balances = balances;
        self.justified_vote_increments = vote_increments;
        self.justified_total_balance = total * preset.EFFECTIVE_BALANCE_INCREMENT;
        self.head_cache.dirty = true;
    }

    /// Spec `calculate_committee_fraction` over the justified checkpoint state.
    pub fn committeeFraction(self: *const Store, committee_percent: u64) u64 {
        const committee_weight = self.justified_total_balance / preset.SLOTS_PER_EPOCH;
        return (committee_weight * committee_percent) / 100;
    }

    /// Spec `get_proposer_score`.
    pub fn proposerScore(self: *const Store) u64 {
        return self.committeeFraction(self.config.chain.PROPOSER_SCORE_BOOST);
    }

    // --- on_tick ----------------------------------------------------------------------

    /// Spec `on_tick`.
    pub fn onTick(self: *Store, time_ms: u64) !void {
        if (time_ms < self.genesis_time_ms) return error.PreGenesisTime;
        const tick_slot = self.timing.slotAtTimeMs(time_ms);
        while (self.currentSlot() < tick_slot) {
            const next_slot = self.currentSlot() + 1;
            try self.onTickPerSlot(self.timing.timeAtSlotMs(next_slot));
        }
        try self.onTickPerSlot(time_ms);
    }

    /// Spec `on_tick_per_slot`.
    fn onTickPerSlot(self: *Store, time_ms: u64) !void {
        const previous_slot = self.currentSlot();
        self.time_ms = time_ms;
        self.head_cache.dirty = true;
        const current_slot = self.currentSlot();
        if (current_slot > previous_slot) {
            self.proposer_boost_root = constants.ZERO_HASH;
        }
        if (current_slot > previous_slot and computeSlotsSinceEpochStart(current_slot) == 0) {
            try self.updateCheckpoints(self.unrealized_justified_checkpoint, self.unrealized_finalized_checkpoint);
        }
        if (current_slot > previous_slot) self.drainQueuedMessages(current_slot);
    }

    // --- on_block ---------------------------------------------------------------------

    /// The `on_block` assertions that precede `state_transition`. Callers run this before
    /// paying for the transition; `onBlock` repeats it.
    pub fn validateBlock(self: *const Store, block: AnyBeaconBlock, block_root: Root) Error!void {
        var summary: BlockSummary = .{
            .root = block_root,
            .parent_root = block.parentRoot().*,
            .slot = block.slot(),
            .proposer_index = block.proposerIndex(),
            .state_root = block.stateRoot().*,
            .fork = block.forkSeq(),
            .justified_checkpoint = undefined,
            .finalized_checkpoint = undefined,
            .unrealized_justified_checkpoint = undefined,
            .unrealized_finalized_checkpoint = undefined,
            .execution_status = undefined,
        };
        if (block.forkSeq().gte(.gloas)) {
            const body = block.beaconBlockBody();
            summary.bid_parent_block_hash = (body.signedExecutionPayloadBidParentBlockHash() catch return error.UnknownParent).*;
        }
        try self.validateSummary(&summary);
    }

    /// A zero payload hash means no payload, before the merge or a Gloas anchor with an
    /// empty bid; a Gloas block with a bid is `.syncing` until its envelope arrives.
    fn checkExecutionStatus(summary: *const BlockSummary) Error!void {
        const no_payload = std.mem.eql(u8, &summary.payload_block_hash, &constants.ZERO_HASH);
        if (no_payload != (summary.execution_status == .pre_merge)) return error.ExecutionStatusMismatch;
        if (summary.fork.gte(.gloas) and !no_payload and summary.execution_status != .syncing) return error.ExecutionStatusMismatch;
        if (summary.execution_status == .invalid) return error.ExecutionStatusMismatch;
    }

    fn validateSummary(self: *const Store, summary: *const BlockSummary) Error!void {
        if (self.hasBlock(summary.root)) return;
        const parent = self.blockIndex(summary.parent_root) orelse return error.UnknownParent;
        if (self.parentPayloadStatus(summary, parent) == .full and !self.blocks.items(.payload_verified)[parent]) {
            return error.ParentPayloadNotVerified;
        }
        if (self.currentSlot() < summary.slot) return error.FutureBlock;
        const finalized_slot = computeStartSlotAtEpoch(self.finalized_checkpoint.epoch);
        if (summary.slot <= finalized_slot) return error.BlockBeforeFinalizedSlot;
        const finalized_block = self.getCheckpointBlock(parent, self.finalized_checkpoint.epoch);
        if (!std.mem.eql(u8, &self.blockRoot(finalized_block), &self.finalized_checkpoint.root)) {
            return error.NotFinalizedDescendant;
        }
    }

    /// Spec `on_block` after `state_transition`: `post_state` is the block's post-state,
    /// already validated by the caller. The store reads it and does not keep it.
    /// `execution_status` is the engine's verdict on the block's payload, see
    /// `BlockSummary.fromBlock`; an `.invalid` payload never reaches the store
    /// (`onPayloadInvalid` takes its parent instead).
    pub fn onBlock(self: *Store, block: AnyBeaconBlock, block_root: Root, post_state: *CachedBeaconState, execution_status: ExecutionStatus) !void {
        if (self.hasBlock(block_root)) return;
        try self.validateBlock(block, block_root);
        var summary = try BlockSummary.fromBlock(self.allocator, block, post_state, execution_status);
        summary.root = block_root;
        try self.onBlockSummary(summary);
        if (block.forkSeq().gte(.gloas)) try self.notifyPtcMessages(block, post_state);
    }

    /// Spec `on_block` from the block's facts, without its payload attestations
    /// (feed those through `onPayloadAttestationMessage`). Optimistic sync: a block whose
    /// parent node stands on an invalidated payload is rejected, and a `.valid` payload
    /// validates every not yet validated payload below it.
    pub fn onBlockSummary(self: *Store, summary: BlockSummary) !void {
        if (self.hasBlock(summary.root)) return;
        try self.validateSummary(&summary);
        try checkExecutionStatus(&summary);
        const parent = self.blockIndex(summary.parent_root).?;

        const head = try self.getHead();
        const parent_node: ForkChoiceNode = .{ .block = parent, .payload_status = self.parentPayloadStatus(&summary, parent) };
        if (self.head_cache.execution.items[head_mod.nodeId(parent_node)] == .invalid) return error.ParentPayloadInvalid;

        const index: BlockIndex = @intCast(self.blocks.len);
        try self.appendBlock(.{
            .root = summary.root,
            .parent = parent,
            .slot = summary.slot,
            .proposer_index = summary.proposer_index,
            .state_root = summary.state_root,
            .fork = summary.fork,
            .justified_checkpoint = summary.justified_checkpoint,
            .finalized_checkpoint = summary.finalized_checkpoint,
            .unrealized_justified_checkpoint = summary.unrealized_justified_checkpoint,
            .timely = .{ false, false },
            .parent_payload_status = parent_node.payload_status,
            .payload_block_hash = summary.payload_block_hash,
            .bid_parent_block_hash = summary.bid_parent_block_hash,
            .execution_status = summary.execution_status,
            .payload_verified = false,
            .inclusion_list_satisfaction = .unknown,
        });
        if (summary.execution_status == .valid) try self.markChainValid(parent_node);

        self.recordBlockTimeliness(index, summary.arrival_ms_into_slot orelse self.timeIntoSlotMs());
        self.updateProposerBoostRoot(head.block, index);
        try self.updateCheckpoints(summary.justified_checkpoint, summary.finalized_checkpoint);

        // Spec `compute_pulled_up_tip`
        self.updateUnrealizedCheckpoints(summary.unrealized_justified_checkpoint, summary.unrealized_finalized_checkpoint);
        if (computeEpochAtSlot(summary.slot) < self.currentEpoch()) {
            try self.updateCheckpoints(summary.unrealized_justified_checkpoint, summary.unrealized_finalized_checkpoint);
        }
    }

    /// Spec `get_parent_payload_status`; `.pending` when either side predates Gloas.
    fn parentPayloadStatus(self: *const Store, summary: *const BlockSummary, parent: BlockIndex) PayloadStatus {
        if (summary.fork.lt(.gloas) or self.blocks.items(.fork)[parent].lt(.gloas)) return .pending;
        const parent_payload_block_hash = self.blocks.items(.payload_block_hash)[parent];
        return if (std.mem.eql(u8, &summary.bid_parent_block_hash, &parent_payload_block_hash)) .full else .empty;
    }

    /// Spec `record_block_timeliness`.
    fn recordBlockTimeliness(self: *Store, index: BlockIndex, time_into_slot_ms: u64) void {
        const is_current_slot = self.currentSlot() == self.blockSlot(index);
        self.blocks.items(.timely)[index] = .{
            is_current_slot and time_into_slot_ms < self.attestationDueMs(),
            is_current_slot and time_into_slot_ms < self.payloadAttestationDueMs(),
        };
    }

    /// Spec `update_proposer_boost_root`.
    fn updateProposerBoostRoot(self: *Store, head: BlockIndex, index: BlockIndex) void {
        const is_first_block = std.mem.eql(u8, &self.proposer_boost_root, &constants.ZERO_HASH);
        const is_timely = self.blocks.items(.timely)[index][ATTESTATION_TIMELINESS_INDEX];
        const epoch = self.currentEpoch();
        const head_dependent_root = self.getShufflingDependentRoot(head, epoch);
        const block_dependent_root = self.getShufflingDependentRoot(index, epoch);
        const is_same_dependent_root = std.mem.eql(u8, &head_dependent_root, &block_dependent_root);
        if (is_timely and is_first_block and is_same_dependent_root) {
            self.proposer_boost_root = self.blockRoot(index);
            self.head_cache.dirty = true;
        }
    }

    /// Spec `notify_ptc_messages`: the block's payload attestations, indexed with the
    /// block's post-state.
    fn notifyPtcMessages(self: *Store, block: AnyBeaconBlock, post_state: *CachedBeaconState) !void {
        if (try post_state.state.slot() == 0) return;
        switch (block.forkSeq()) {
            inline .gloas, .heze => |fork| {
                const typed = block.castToFork(.full, fork);
                const state = post_state.state.castToFork(fork);
                for (typed.body().inner.payload_attestations.items) |*payload_attestation| {
                    const data = &payload_attestation.data;
                    var ptc: ForkTypes(fork).PayloadTimelinessCommittee.Type = undefined;
                    try state_transition.getPayloadTimelinessCommittee(fork, self.config, state, data.slot, &ptc);
                    for (ptc, 0..) |validator_index, i| {
                        if (!try payload_attestation.aggregation_bits.get(i)) continue;
                        try self.onPayloadAttestationMessage(data, validator_index, &ptc, true);
                    }
                }
            },
            else => unreachable,
        }
    }

    // --- on_attestation ---------------------------------------------------------------

    /// Spec `validate_on_attestation`.
    pub fn validateOnAttestation(self: *const Store, data: *const AttestationData, is_from_block: bool) Error!void {
        try self.checkAttestationData(data, is_from_block);
        if (self.currentSlot() < data.slot + 1) return error.AttestationNotYetPast;
    }

    /// `validate_on_attestation` without its last assertion, the one `onAttestation`
    /// answers by queueing.
    fn checkAttestationData(self: *const Store, data: *const AttestationData, is_from_block: bool) Error!void {
        const target = data.target;
        if (!is_from_block) {
            const current_epoch = self.currentEpoch();
            const previous_epoch = current_epoch -| 1;
            if (target.epoch != current_epoch and target.epoch != previous_epoch) {
                return error.AttestationTargetEpochNotCurrentOrPrevious;
            }
        }
        if (target.epoch != computeEpochAtSlot(data.slot)) return error.AttestationTargetEpochSlotMismatch;
        if (!self.hasBlock(target.root)) return error.UnknownAttestationTarget;
        const block = self.blockIndex(data.beacon_block_root) orelse return error.UnknownAttestationBlock;
        const block_slot = self.blockSlot(block);
        if (block_slot > data.slot) return error.AttestationForFutureBlock;
        if (self.config.forkSeq(data.slot).gte(.gloas)) {
            if (data.index != 0 and data.index != 1) return error.InvalidAttestationIndex;
            if (block_slot == data.slot and data.index != 0) return error.SameSlotFullVote;
            if (data.index == 1 and !self.blocks.items(.payload_verified)[block]) return error.AttestationPayloadNotVerified;
        }
        const checkpoint_block = self.getCheckpointBlock(block, target.epoch);
        if (!std.mem.eql(u8, &self.blockRoot(checkpoint_block), &target.root)) return error.AttestationTargetNotInChain;
    }

    /// Spec `on_attestation` for an attestation the caller already indexed and verified
    /// against the target checkpoint state. A vote whose slot is not yet past is queued
    /// and applied by the tick that makes it past; `validateOnAttestation` keeps the
    /// spec's rejection for callers that want it.
    pub fn onAttestation(self: *Store, attestation: AnyIndexedAttestation, is_from_block: bool) !void {
        const data = attestation.attestationData();
        return self.onAttestationData(&data, attestation.attestingIndices(), is_from_block);
    }

    /// `onAttestation` from the attestation's data and its attesting indices.
    pub fn onAttestationData(self: *Store, data: *const AttestationData, indices: []const ValidatorIndex, is_from_block: bool) !void {
        try self.checkAttestationData(data, is_from_block);
        const block = self.blockIndex(data.beacon_block_root).?;
        const message: LatestMessage = .{
            .slot = data.slot,
            .block = block,
            .payload_present = self.config.forkSeq(data.slot).gte(.gloas) and data.index == 1,
        };
        const queue = self.currentSlot() < data.slot + 1;
        try self.ensureValidatorSlots(&self.latest_votes, indices);
        if (queue) try self.ensureValidatorSlots(&self.queued_votes, indices);
        const id = try self.internVoteTarget(message);
        if (queue) return self.queueVotes(indices, id, message);
        for (indices) |index| self.applyVote(index, id, message);
    }

    fn ensureValidatorSlots(self: *Store, list: *std.ArrayList(TargetId), attesting_indices: []const ValidatorIndex) !void {
        var max_index: usize = 0;
        for (attesting_indices) |index| max_index = @max(max_index, index);
        if (max_index >= list.items.len) {
            try list.appendNTimes(self.allocator, NO_TARGET, max_index + 1 - list.items.len);
        }
    }

    /// The id of `message` in `vote_targets`, compacting the table first when it has grown.
    fn internVoteTarget(self: *Store, message: LatestMessage) !TargetId {
        if (self.vote_targets.needsCompaction()) {
            try self.vote_targets.compact(self.allocator, &.{ self.latest_votes.items, self.queued_votes.items, self.head_cache.applied_votes.items });
        }
        return self.vote_targets.getOrInsert(self.allocator, message, head_mod.nodeId(head_mod.supportedNode(self, message)));
    }

    /// The replacement rule of spec `update_latest_messages` for one validator: a later
    /// target epoch before Gloas, a later slot from Gloas on. `message.slot` is in the
    /// target epoch, which `checkAttestationData` asserted.
    fn applyVote(self: *Store, index: ValidatorIndex, id: TargetId, message: LatestMessage) void {
        if (self.isEquivocating(index)) return;
        const current_id = &self.latest_votes.items[index];
        const current = self.vote_targets.messages.items[current_id.*];
        const newer = current_id.* == NO_TARGET or
            (if (self.config.forkSeq(message.slot).gte(.gloas)) message.slot > current.slot else computeEpochAtSlot(message.slot) > computeEpochAtSlot(current.slot));
        if (newer) {
            current_id.* = id;
            self.head_cache.markVoteChanged(index);
        }
    }

    /// Holds a vote until its slot is past. The first vote of a slot wins, as applying
    /// them in order would, and a vote for a later slot replaces an earlier one.
    fn queueVotes(self: *Store, attesting_indices: []const ValidatorIndex, id: TargetId, message: LatestMessage) void {
        const messages = self.vote_targets.messages.items;
        for (attesting_indices) |index| {
            if (self.isEquivocating(index)) continue;
            const queued = &self.queued_votes.items[index];
            if (queued.* == NO_TARGET or message.slot > messages[queued.*].slot) queued.* = id;
        }
    }

    /// Applies the queued votes whose slot is now past.
    fn drainQueuedMessages(self: *Store, current_slot: Slot) void {
        const queued = self.queued_votes.items;
        std.debug.assert(queued.len <= self.latest_votes.items.len);
        for (queued, 0..) |*id, index| {
            if (id.* == NO_TARGET) continue;
            const message = self.vote_targets.messages.items[id.*];
            if (message.slot >= current_slot) continue;
            self.applyVote(index, id.*, message);
            id.* = NO_TARGET;
        }
    }

    /// Validators with a vote waiting for its slot to pass.
    pub fn queuedVoteCount(self: *const Store) usize {
        var count: usize = 0;
        for (self.queued_votes.items) |id| count += @intFromBool(id != NO_TARGET);
        return count;
    }

    pub fn latestMessage(self: *const Store, validator_index: ValidatorIndex) ?LatestMessage {
        if (validator_index >= self.latest_votes.items.len) return null;
        const id = self.latest_votes.items[validator_index];
        return if (id == NO_TARGET) null else self.vote_targets.messages.items[id];
    }

    // --- on_attester_slashing ---------------------------------------------------------

    /// Spec `on_attester_slashing` for a slashing whose indexed attestations the caller
    /// verified against the justified checkpoint state.
    pub fn onAttesterSlashing(self: *Store, slashing: AnyAttesterSlashing) !void {
        const data_1, const data_2 = switch (slashing) {
            inline else => |s| .{ &s.attestation_1.data, &s.attestation_2.data },
        };
        return self.onAttesterSlashingData(data_1, slashing.attestingIndices1(), data_2, slashing.attestingIndices2());
    }

    /// `onAttesterSlashing` from the two attestations' data and their attesting indices,
    /// each sorted ascending as `is_valid_indexed_attestation` requires.
    pub fn onAttesterSlashingData(
        self: *Store,
        data_1: *const AttestationData,
        indices_1: []const ValidatorIndex,
        data_2: *const AttestationData,
        indices_2: []const ValidatorIndex,
    ) !void {
        if (!isSlashableAttestationData(data_1, data_2)) return error.NotSlashableAttestationData;
        var max_index: usize = 0;
        for (indices_1) |index| max_index = @max(max_index, index);
        if (max_index >= self.equivocating_indices.bit_length) {
            try self.equivocating_indices.resize(self.allocator, max_index + 1, false);
        }
        var i: usize = 0;
        var j: usize = 0;
        while (i < indices_1.len and j < indices_2.len) {
            if (indices_1[i] == indices_2[j]) {
                self.equivocating_indices.set(indices_1[i]);
                self.head_cache.markVoteChanged(indices_1[i]);
                i += 1;
                j += 1;
            } else if (indices_1[i] < indices_2[j]) {
                i += 1;
            } else {
                j += 1;
            }
        }
        self.head_cache.dirty = true;
    }

    pub fn isEquivocating(self: *const Store, validator_index: ValidatorIndex) bool {
        return validator_index < self.equivocating_indices.bit_length and self.equivocating_indices.isSet(validator_index);
    }

    // --- Gloas payload handlers -------------------------------------------------------

    /// Spec `on_payload_attestation_message` up to the vote update: `ptc` is the
    /// committee of the attested block's state at `data.slot`. Returns the PTC positions
    /// of the validator, empty when the message is for another slot than the block's.
    pub fn validatePayloadAttestationMessage(
        self: *const Store,
        data: *const PayloadAttestationData,
        validator_index: ValidatorIndex,
        ptc: []const ValidatorIndex,
        is_from_block: bool,
        positions: *PtcPositions,
    ) Error!void {
        positions.len = 0;
        const block = self.blockIndex(data.beacon_block_root) orelse return error.UnknownBlock;
        if (data.slot != self.blockSlot(block)) return;
        for (ptc, 0..) |member, i| {
            if (member == validator_index) {
                positions.buffer[positions.len] = @intCast(i);
                positions.len += 1;
            }
        }
        if (positions.len == 0) return error.ValidatorNotInPtc;
        if (!is_from_block and data.slot != self.currentSlot()) return error.PtcMessageNotCurrentSlot;
    }

    /// Spec `on_payload_attestation_message`. The signature of a message from the wire
    /// is the caller's job.
    pub fn onPayloadAttestationMessage(
        self: *Store,
        data: *const PayloadAttestationData,
        validator_index: ValidatorIndex,
        ptc: []const ValidatorIndex,
        is_from_block: bool,
    ) Error!void {
        var positions: PtcPositions = .{};
        try self.validatePayloadAttestationMessage(data, validator_index, ptc, is_from_block, &positions);
        if (positions.len == 0) return;
        const block = self.blockIndex(data.beacon_block_root).?;
        self.setPtcVotes(block, positions.slice(), data.payload_present, data.blob_data_available);
    }

    /// Spec `notify_ptc_messages` for one payload attestation the caller already indexed:
    /// `positions` are the PTC positions of its set aggregation bits. Does nothing when
    /// the attestation is for another slot than the block's.
    pub fn onPtcVotes(
        self: *Store,
        beacon_block_root: Root,
        slot: Slot,
        positions: []const u16,
        payload_present: bool,
        blob_data_available: bool,
    ) Error!void {
        const block = self.blockIndex(beacon_block_root) orelse return error.UnknownBlock;
        if (slot != self.blockSlot(block)) return;
        for (positions) |position| {
            if (position >= preset.PTC_SIZE) return error.InvalidPtcPosition;
        }
        self.setPtcVotes(block, positions, payload_present, blob_data_available);
    }

    fn setPtcVotes(self: *Store, block: BlockIndex, positions: []const u16, payload_present: bool, blob_data_available: bool) void {
        const votes = &self.ptc_votes.items[block];
        for (positions) |position| {
            votes[position] = .{ .voted = true, .payload_present = payload_present, .blob_data_available = blob_data_available };
        }
        self.head_cache.dirty = true;
    }

    /// Records the engine's inclusion list verdict on the payload of `block` outside
    /// `onExecutionPayloadEnvelope`, for an engine that reports it separately. Returns
    /// whether the verdict changed.
    pub fn recordInclusionListSatisfaction(self: *Store, block: BlockIndex, satisfied: bool) bool {
        const verdict: InclusionListSatisfaction = if (satisfied) .satisfied else .unsatisfied;
        const current = &self.blocks.items(.inclusion_list_satisfaction)[block];
        if (current.* == verdict) return false;
        current.* = verdict;
        self.head_cache.dirty = true;
        return true;
    }

    /// Spec `on_execution_payload_envelope` after the caller verified the envelope and
    /// data availability. `execution_status` is the engine's verdict on the payload,
    /// `.valid` or `.syncing`; `inclusion_list_satisfied` carries the Heze engine verdict.
    pub fn onExecutionPayloadEnvelope(self: *Store, beacon_block_root: Root, execution_status: ExecutionStatus, inclusion_list_satisfied: ?bool) Error!void {
        const block = self.blockIndex(beacon_block_root) orelse return error.UnknownBlock;
        if (execution_status != .valid and execution_status != .syncing) return error.ExecutionStatusMismatch;
        const statuses = self.blocks.items(.execution_status);
        switch (statuses[block]) {
            .invalid => return error.PayloadInvalidToValid,
            .valid => {},
            .syncing, .pre_merge => statuses[block] = execution_status,
        }
        if (inclusion_list_satisfied) |satisfied| {
            self.blocks.items(.inclusion_list_satisfaction)[block] = if (satisfied) .satisfied else .unsatisfied;
        }
        self.blocks.items(.payload_verified)[block] = true;
        self.head_cache.dirty = true;
        const parent = self.blocks.items(.parent)[block];
        if (execution_status == .valid and parent != NO_BLOCK) {
            try self.markChainValid(.{ .block = parent, .payload_status = self.blocks.items(.parent_payload_status)[block] });
        }
    }

    // --- optimistic sync --------------------------------------------------------------

    /// The payloads a node stands on, nearest first. A block's own payload is on the
    /// chain before Gloas and for its `.full` node; `.pending` and `.empty` Gloas nodes
    /// stand on the parent payload the bid names, reached through `parent_payload_status`.
    const PayloadChain = struct {
        store: *const Store,
        node: ?ForkChoiceNode,

        fn next(self: *PayloadChain) ?BlockIndex {
            while (self.node) |node| {
                const blocks = self.store.blocks;
                const own_on_chain = blocks.items(.fork)[node.block].lt(.gloas) or node.payload_status == .full;
                const parent = blocks.items(.parent)[node.block];
                self.node = if (parent == NO_BLOCK) null else .{ .block = parent, .payload_status = blocks.items(.parent_payload_status)[node.block] };
                if (own_on_chain) return node.block;
            }
            return null;
        }
    };

    fn payloadChain(self: *const Store, node: ForkChoiceNode) PayloadChain {
        return .{ .store = self, .node = node };
    }

    /// Optimistic sync `NOT_VALIDATED -> VALID` for the payload with `block_hash`, in every
    /// block carrying it, and, as the spec requires, every not yet validated payload below it.
    pub fn onPayloadValid(self: *Store, block_hash: Root) Error!void {
        const hashes = self.blocks.items(.payload_block_hash);
        var found = false;
        for (hashes, 0..) |*hash, i| {
            if (!std.mem.eql(u8, hash, &block_hash)) continue;
            found = true;
            const index: BlockIndex = @intCast(i);
            const node: ForkChoiceNode = if (self.blocks.items(.fork)[i].gte(.gloas)) .{ .block = index, .payload_status = .full } else pendingNode(index);
            try self.markChainValid(node);
        }
        if (!found) return error.UnknownPayload;
    }

    /// Marks the `.syncing` payloads from `node` down `.valid`, stopping at the first payload
    /// already `.valid` or `.pre_merge`. Writes nothing when an `.invalid` payload comes first.
    /// A payload just marked `.valid` passes the node it hangs from, not its own.
    fn markChainValid(self: *Store, node: ForkChoiceNode) Error!void {
        const statuses = self.blocks.items(.execution_status);
        var count: usize = 0;
        var chain = self.payloadChain(node);
        var reached_root = true;
        while (chain.next()) |block| {
            switch (statuses[block]) {
                .invalid => return error.PayloadInvalidToValid,
                .valid, .pre_merge => {
                    reached_root = false;
                    break;
                },
                .syncing => count += 1,
            }
        }
        if (reached_root and self.root_base_status == .invalid) return error.PayloadInvalidToValid;
        const validates_root_base = reached_root and self.root_base_status == .syncing;
        if (count == 0 and !validates_root_base) return;
        chain = self.payloadChain(node);
        while (count > 0) : (count -= 1) statuses[chain.next().?] = .valid;
        if (validates_root_base) self.root_base_status = .valid;
        self.head_cache.dirty = true;
    }

    /// Optimistic sync `NOT_VALIDATED -> INVALIDATED` from an engine `INVALID` verdict on
    /// a block that is not in the store: `parent_root` and `parent_block_hash` are the
    /// rejected block's parent and its payload's `parent_hash`. Every payload from the
    /// parent down to `latest_valid_hash` (exclusive) is invalidated in every block carrying
    /// it, as equivocating blocks can share a payload; a zero hash
    /// invalidates through the merge block. A null or unknown hash names the rejected
    /// block itself, so nothing changes. Descendants of an invalidated payload are
    /// derived invalid by `getHead`.
    pub fn onPayloadInvalid(self: *Store, parent_root: Root, parent_block_hash: Root, latest_valid_hash: ?Root) Error!void {
        const parent = self.blockIndex(parent_root) orelse return error.UnknownParent;
        const lvh = latest_valid_hash orelse return;
        const hashes = self.blocks.items(.payload_block_hash);
        const statuses = self.blocks.items(.execution_status);
        const start: ForkChoiceNode = if (self.blocks.items(.fork)[parent].lt(.gloas))
            pendingNode(parent)
        else
            .{ .block = parent, .payload_status = if (std.mem.eql(u8, &hashes[parent], &parent_block_hash)) .full else .empty };
        var count: usize = 0;
        var found = false;
        var chain = self.payloadChain(start);
        while (chain.next()) |block| {
            if (std.mem.eql(u8, &hashes[block], &lvh)) {
                found = true;
                break;
            }
            count += 1;
        }
        if (!found) return error.UnknownLatestValidHash;
        var invalid_hashes: std.AutoHashMapUnmanaged(Root, void) = .empty;
        defer invalid_hashes.deinit(self.allocator);
        chain = self.payloadChain(start);
        for (0..count) |_| try invalid_hashes.put(self.allocator, hashes[chain.next().?], {});
        if (invalid_hashes.count() == 0) return;
        for (hashes, statuses) |*hash, status| {
            if (!invalid_hashes.contains(hash.*)) continue;
            switch (status) {
                .valid, .pre_merge => return error.PayloadValidToInvalid,
                .syncing, .invalid => {},
            }
        }
        for (hashes, statuses) |*hash, *status| {
            if (invalid_hashes.contains(hash.*)) status.* = .invalid;
        }
        self.head_cache.dirty = true;
    }

    /// The worst engine verdict on the payloads `node` stands on, valid after `getHead`.
    pub fn executionStatus(self: *Store, node: ForkChoiceNode) !ExecutionStatus {
        try head_mod.ensureComputed(self);
        return self.head_cache.execution.items[head_mod.nodeId(node)];
    }

    /// Spec `is_optimistic`: some payload below `node` is still `NOT_VALIDATED`.
    pub fn isOptimistic(self: *Store, node: ForkChoiceNode) !bool {
        return try self.executionStatus(node) == .syncing;
    }

    /// Spec `is_payload_verified`.
    pub fn isPayloadVerified(self: *const Store, block: BlockIndex) bool {
        return self.blocks.items(.payload_verified)[block];
    }

    /// Spec `payload_timeliness`.
    pub fn payloadTimeliness(self: *const Store, block: BlockIndex, timely: bool) bool {
        if (!self.isPayloadVerified(block)) return !timely;
        var matching: u64 = 0;
        for (self.ptc_votes.items[block]) |vote| {
            if (vote.voted and vote.payload_present == timely) matching += 1;
        }
        return matching > PAYLOAD_TIMELY_THRESHOLD;
    }

    /// Spec `payload_data_availability`.
    pub fn payloadDataAvailability(self: *const Store, block: BlockIndex, available: bool) bool {
        if (!self.isPayloadVerified(block)) return !available;
        var matching: u64 = 0;
        for (self.ptc_votes.items[block]) |vote| {
            if (vote.voted and vote.blob_data_available == available) matching += 1;
        }
        return matching > DATA_AVAILABILITY_TIMELY_THRESHOLD;
    }

    /// Spec `is_payload_inclusion_list_satisfied`; a payload from before Heze has no
    /// inclusion list to satisfy.
    pub fn isPayloadInclusionListSatisfied(self: *const Store, block: BlockIndex) bool {
        if (!self.isPayloadVerified(block)) return false;
        if (self.blocks.items(.fork)[block].lt(.heze)) return true;
        return self.blocks.items(.inclusion_list_satisfaction)[block] == .satisfied;
    }

    /// Spec `is_previous_slot_payload_decision`.
    pub fn isPreviousSlotPayloadDecision(self: *const Store, node: ForkChoiceNode) bool {
        const is_previous_slot = self.blockSlot(node.block) + 1 == self.currentSlot();
        return is_previous_slot and node.payload_status != .pending;
    }

    /// Spec `should_extend_payload`.
    pub fn shouldExtendPayload(self: *const Store, block: BlockIndex) Error!bool {
        if (self.blockSlot(block) + 1 != self.currentSlot()) return error.PayloadNotFromPreviousSlot;
        if (!self.isPayloadVerified(block)) return false;
        if (self.blocks.items(.fork)[block].gte(.heze) and !self.isPayloadInclusionListSatisfied(block)) return false;
        const payload_is_timely = self.payloadTimeliness(block, true);
        const payload_data_is_available = self.payloadDataAvailability(block, true);
        if (payload_is_timely and payload_data_is_available) return true;
        const proposer_block = self.blockIndex(self.proposer_boost_root) orelse return true;
        if (self.blocks.items(.parent)[proposer_block] != block) return true;
        return self.blocks.items(.parent_payload_status)[proposer_block] == .full;
    }

    /// Spec `should_build_on_full`; a pre-Gloas head carries its own payload.
    pub fn shouldBuildOnFull(self: *const Store, head: ForkChoiceNode, slot: Slot) bool {
        if (self.blocks.items(.fork)[head.block].lt(.gloas)) return true;
        std.debug.assert(head.payload_status != .pending);
        if (self.blockSlot(head.block) + 1 != slot) return head.payload_status == .full;
        if (head.payload_status == .empty) return false;
        if (self.payloadTimeliness(head.block, false)) return false;
        if (self.payloadDataAvailability(head.block, false)) return false;
        return true;
    }

    // --- prune ------------------------------------------------------------------------

    /// Drops every block that is neither the finalized block nor one of its descendants
    /// and compacts the table. Block indices held by callers are invalid afterwards;
    /// latest messages for dropped blocks keep their slot and lose their block.
    /// The spec never prunes; this keeps the store bounded by finality.
    pub fn prune(self: *Store) !usize {
        const finalized = self.blockIndex(self.finalized_checkpoint.root) orelse return error.UnknownBlock;
        if (finalized == 0) return 0;
        try head_mod.ensureComputed(self);
        const n = self.blocks.len;
        const remap = try self.allocator.alloc(BlockIndex, n);
        defer self.allocator.free(remap);
        const parents = self.blocks.items(.parent);
        var kept: BlockIndex = 0;
        for (0..n) |i| {
            const parent = parents[i];
            const keep = i == finalized or (parent != NO_BLOCK and i > finalized and remap[parent] != NO_BLOCK);
            remap[i] = if (keep) kept else NO_BLOCK;
            if (keep) kept += 1;
        }
        // Votes hold target ids, so renumbering the target table carries every vote over.
        self.vote_targets.remap(remap);
        self.head_cache.remapVoteWeight(remap, kept);
        if (parents[finalized] != NO_BLOCK) {
            const hung_from: ForkChoiceNode = .{ .block = parents[finalized], .payload_status = self.blocks.items(.parent_payload_status)[finalized] };
            self.root_base_status = self.head_cache.execution.items[head_mod.nodeId(hung_from)];
        }
        for (0..n) |i| {
            const target = remap[i];
            if (target == NO_BLOCK) continue;
            var block = self.blocks.get(i);
            block.parent = if (block.parent == NO_BLOCK or remap[block.parent] == NO_BLOCK) NO_BLOCK else remap[block.parent];
            self.blocks.set(target, block);
            self.ptc_votes.items[target] = self.ptc_votes.items[i];
        }
        self.blocks.shrinkRetainingCapacity(kept);
        self.ptc_votes.shrinkRetainingCapacity(kept);
        self.index_by_root.clearRetainingCapacity();
        for (self.blocks.items(.root), 0..) |root, i| {
            self.index_by_root.putAssumeCapacityNoClobber(root, @intCast(i));
        }
        self.head_cache.dirty = true;
        return n - kept;
    }

    // --- head -------------------------------------------------------------------------

    /// Spec `get_head`. Results are cached until the next store mutation.
    pub fn getHead(self: *Store) !ForkChoiceNode {
        try head_mod.ensureComputed(self);
        return self.head_cache.head;
    }

    /// Spec `get_weight` for a node, valid after `getHead`.
    pub fn getWeight(self: *Store, node: ForkChoiceNode) !u64 {
        try head_mod.ensureComputed(self);
        return head_mod.weight(self, node);
    }

    /// Leaves of the filtered node tree with their weights (spec test `viable_for_head_roots_and_weights`).
    pub fn viableHeads(self: *Store, allocator: Allocator) ![]head_mod.ViableHead {
        try head_mod.ensureComputed(self);
        return head_mod.viableHeads(self, allocator);
    }
};

pub fn secondsToMilliseconds(seconds: u64) u64 {
    if (seconds > std.math.maxInt(u64) / 1000) return std.math.maxInt(u64);
    return seconds * 1000;
}

pub fn computeEpochAtSlot(slot: Slot) Epoch {
    return slot / preset.SLOTS_PER_EPOCH;
}

pub fn computeStartSlotAtEpoch(epoch: Epoch) Slot {
    return epoch * preset.SLOTS_PER_EPOCH;
}

pub fn computeSlotsSinceEpochStart(slot: Slot) Slot {
    return slot - computeStartSlotAtEpoch(computeEpochAtSlot(slot));
}

/// Spec `compute_shuffling_dependent_slot`.
pub fn computeShufflingDependentSlot(epoch: Epoch) Slot {
    const lookahead_epoch = epoch -| preset.MIN_SEED_LOOKAHEAD;
    return computeStartSlotAtEpoch(lookahead_epoch) -| 1;
}

pub fn checkpointEql(a: Checkpoint, b: Checkpoint) bool {
    return a.epoch == b.epoch and std.mem.eql(u8, &a.root, &b.root);
}

fn isSlashableAttestationData(data_1: *const AttestationData, data_2: *const AttestationData) bool {
    const same = data_1.slot == data_2.slot and data_1.index == data_2.index and
        std.mem.eql(u8, &data_1.beacon_block_root, &data_2.beacon_block_root) and
        checkpointEql(data_1.source, data_2.source) and checkpointEql(data_1.target, data_2.target);
    const double_vote = !same and data_1.target.epoch == data_2.target.epoch;
    const surround_vote = data_1.source.epoch < data_2.source.epoch and data_2.target.epoch < data_1.target.epoch;
    return double_vote or surround_vote;
}

/// Spec `compute_time_at_slot_ms` / `compute_slot_at_time_ms`, with the Lodestar
/// config's optional slot duration change at the Heze fork.
pub const SlotTiming = struct {
    genesis_time_ms: u64,
    duration_ms: u64,
    transition_slot: ?Slot,
    transition_duration_ms: u64,

    pub fn init(config: *const BeaconConfig, genesis_time_ms: u64) SlotTiming {
        const chain = config.chain;
        const heze_active = chain.HEZE_FORK_EPOCH != constants.FAR_FUTURE_EPOCH;
        const changes = heze_active and chain.SLOT_DURATION_MS_HEZE != chain.SLOT_DURATION_MS;
        return .{
            .genesis_time_ms = genesis_time_ms,
            .duration_ms = if (changes and chain.HEZE_FORK_EPOCH == 0) chain.SLOT_DURATION_MS_HEZE else chain.SLOT_DURATION_MS,
            .transition_slot = if (changes and chain.HEZE_FORK_EPOCH != 0) computeStartSlotAtEpoch(chain.HEZE_FORK_EPOCH) else null,
            .transition_duration_ms = chain.SLOT_DURATION_MS_HEZE,
        };
    }

    pub fn timeAtSlotMs(self: SlotTiming, slot: Slot) u64 {
        if (self.transition_slot) |transition| {
            if (slot >= transition) {
                return self.genesis_time_ms + transition * self.duration_ms + (slot - transition) * self.transition_duration_ms;
            }
        }
        return self.genesis_time_ms + slot * self.duration_ms;
    }

    /// Precondition: `time_ms >= genesis_time_ms`.
    pub fn slotAtTimeMs(self: SlotTiming, time_ms: u64) Slot {
        const since_genesis = time_ms - self.genesis_time_ms;
        if (self.transition_slot) |transition| {
            const transition_ms = transition * self.duration_ms;
            if (since_genesis >= transition_ms) {
                return transition + (since_genesis - transition_ms) / self.transition_duration_ms;
            }
        }
        return since_genesis / self.duration_ms;
    }
};

test {
    _ = @import("store_test.zig");
}
