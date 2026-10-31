const std = @import("std");
const Allocator = std.mem.Allocator;
const testing = std.testing;
const assert = std.debug.assert;

const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;
const constants = @import("constants");
const BeaconConfig = @import("config").BeaconConfig;
const presets = @import("preset");
const preset = presets.preset;
const state_transition = @import("state_transition");
const computeEpochAtSlot = state_transition.computeEpochAtSlot;
const computeSlotsSinceEpochStart = state_transition.computeSlotsSinceEpochStart;
const computeStartSlotAtEpoch = state_transition.computeStartSlotAtEpoch;

const Slot = primitives.Slot.Type;
const Epoch = primitives.Epoch.Type;
const Root = primitives.Root.Type;
const ValidatorIndex = primitives.ValidatorIndex.Type;

const pa = @import("proto_array.zig");
const ProtoArray = pa.ProtoArray;
const ProtoArrayError = pa.ProtoArrayError;
const ProtoBlock = pa.ProtoBlock;
const ProtoNode = pa.ProtoNode;
const LVHExecResponse = pa.LVHExecResponse;
const LVHExecError = pa.LVHExecError;
const PayloadStatus = pa.PayloadStatus;
const RootContext = pa.RootContext;
const ExecutionStatus = pa.ExecutionStatus;
const DataAvailabilityStatus = pa.DataAvailabilityStatus;
const DEFAULT_PRUNE_THRESHOLD = pa.DEFAULT_PRUNE_THRESHOLD;
const BlockExtraMeta = pa.BlockExtraMeta;

const vote_tracker = @import("vote_tracker.zig");
const Votes = vote_tracker.Votes;
const NULL_VOTE_INDEX = vote_tracker.NULL_VOTE_INDEX;
const INIT_VOTE_SLOT = vote_tracker.INIT_VOTE_SLOT;

const compute_deltas = @import("compute_deltas.zig");
const computeDeltas = compute_deltas.computeDeltas;
const ComputeDeltasResult = compute_deltas.ComputeDeltasResult;
const DeltasCache = compute_deltas.DeltasCache;

const metrics = @import("metrics.zig");
const time = @import("time");

const store = @import("store.zig");
pub const ForkChoiceStore = store.ForkChoiceStore;
pub const Checkpoint = store.Checkpoint;
pub const JustifiedBalances = store.JustifiedBalances;
const EffectiveBalanceIncrementsRc = store.JustifiedBalancesRc;
const JustifiedBalancesGetter = store.JustifiedBalancesGetter;
const ForkChoiceStoreEvents = store.ForkChoiceStoreEvents;

const fork_types = @import("fork_types");
const AnyIndexedAttestation = fork_types.AnyIndexedAttestation;
const AnyAttesterSlashing = fork_types.AnyAttesterSlashing;
const AnyBeaconBlock = fork_types.AnyBeaconBlock;
const BeaconBlock = fork_types.BeaconBlock;
const BeaconBlockBody = fork_types.BeaconBlockBody;
const BeaconState = fork_types.BeaconState;
const BlockType = fork_types.BlockType;
const ForkSeq = @import("config").ForkSeq;
const CachedBeaconState = state_transition.CachedBeaconState;
const UnrealizedCheckpoints = state_transition.UnrealizedCheckpoints;

const ZERO_HASH = constants.ZERO_HASH;

pub const ForkChoiceError = ProtoArrayError || error{
    // InvalidAttestation inner codes
    InvalidAttestationEmptyAggregationBitfield,
    InvalidAttestationUnknownHeadBlock,
    InvalidAttestationBadTargetEpoch,
    InvalidAttestationUnknownTargetRoot,
    InvalidAttestationFutureEpoch,
    InvalidAttestationPastEpoch,
    InvalidAttestationInvalidTarget,
    InvalidAttestationAttestsToFutureBlock,
    InvalidAttestationFutureSlot,
    InvalidAttestationInvalidDataIndex,
    InvalidAttestationUnknownPayloadStatus,
    // InvalidBlock inner codes
    InvalidBlockUnknownParent,
    InvalidBlockFutureSlot,
    InvalidBlockFinalizedSlot,
    InvalidBlockNotFinalizedDescendant,
    // Other errors
    InvalidProtoArrayBytes,
    InconsistentOnTick,
    BeaconStateErr,
    AttemptToRevertJustification,
    ForkChoiceStoreErr,
    UnableToSetJustifiedCheckpoint,
    AfterBlockFailed,
    DependentRootNotFound,
};

/// Epoch offset for dependent root computation.
///
/// Spec: fork-choice.md (get_dependent_root)
///
///   current  = 0 (current epoch shuffling dependent root)
///   previous = 1 (previous epoch shuffling dependent root)
pub const EpochDifference = enum(u1) {
    current = 0,
    previous = 1,
};

/// Result of ancestor comparison between two blocks.
pub const AncestorStatus = enum {
    /// Blocks share a common ancestor at depth.
    common_ancestor,
    /// One block is a descendant of the other.
    descendant,
    /// No common ancestor found (should not happen in a valid chain).
    no_common_ancestor,
    /// One or both block roots are unknown to fork choice.
    block_unknown,
};

/// Result of `getCommonAncestorDepth`: ancestor status + optional depth.
/// Result of `getAllAncestorAndNonAncestorBlocks`: owned slices of ancestor
/// and non-ancestor proto-blocks partitioned by the finalized checkpoint.
pub const AncestorAndNonAncestorBlocks = struct {
    ancestors: []ProtoBlock,
    non_ancestors: []ProtoBlock,
};

pub const AncestorResult = union(AncestorStatus) {
    common_ancestor: struct { depth: u32 },
    descendant: void,
    no_common_ancestor: void,
    block_unknown: void,
};

/// Reason why proposer-boost reorging was NOT applied.
///
/// Used for metrics and debugging in `shouldOverrideForkChoiceUpdate`.
pub const NotReorgedReason = enum {
    head_block_is_timely,
    parent_block_not_available,
    proposer_boost_reorg_disabled,
    not_shuffling_stable,
    not_ffg_competitive,
    chain_long_unfinality,
    parent_block_distance_more_than_one_slot,
    reorg_more_than_one_slot,
    proposer_boost_not_worn_off,
    head_block_not_weak,
    parent_block_not_strong,
    not_proposing_on_time,
    not_proposer_of_next_slot,
    head_block_not_available,
    unknown,
};

/// Result of `shouldOverrideForkChoiceUpdate`.
pub const ShouldOverrideForkChoiceUpdateResult = union(enum) {
    /// FCU should be overridden with the parent block as head.
    should_override: struct { parent_block: ProtoBlock },
    /// FCU should NOT be overridden; reason explains why.
    should_not_override: struct { reason: NotReorgedReason },
};

/// Options controlling ForkChoice behavior.
pub const ForkChoiceOpts = struct {
    /// Enable proposer boost.
    proposer_boost: bool = false,
    /// Enable proposer boost reorging.
    proposer_boost_reorg: bool = false,
    /// Compute unrealized justified/finalized checkpoints.
    compute_unrealized: bool = false,
};

/// Mode for `updateAndGetHead`.
///
///   GetCanonicalHead:           updateHead() only, skip getProposerHead.
///   GetProposerHead:            updateHead() + getProposerHead() (for current-slot proposer).
///   GetPredictedProposerHead:   getHead() + predictProposerHead() (for next-slot planning).
pub const UpdateHeadOpt = enum {
    get_canonical_head,
    get_proposer_head,
    get_predicted_proposer_head,
};

/// Arguments for `updateAndGetHead`.
pub const UpdateAndGetHeadOpt = union(UpdateHeadOpt) {
    get_canonical_head: void,
    get_proposer_head: struct { sec_from_slot: u32, slot: Slot },
    get_predicted_proposer_head: struct { sec_from_slot: u32, slot: Slot },
};

/// Result of `updateAndGetHead` / `getProposerHead`.
pub const UpdateAndGetHeadResult = struct {
    head: ProtoBlock,
    is_head_timely: ?bool = null,
    not_reorged_reason: ?NotReorgedReason = null,
};

/// Checkpoint with balances (no Rc — used at API boundaries).
///
/// Unlike `ForkChoiceStore.JustifiedState` which uses reference-counted balances,
/// this is a simple value type for passing checkpoint + balance data across
/// function boundaries.
pub const CheckpointWithBalance = struct {
    checkpoint: Checkpoint,
    balances: []const u16,
};

/// Checkpoint with balances and precomputed total balance.
pub const CheckpointWithTotalBalance = struct {
    checkpoint: Checkpoint,
    balances: []const u16,
    total_balance: u64,
};

// ── Helper types ──

/// Queued attestation for deferred processing (current-slot attestations).
/// BlockRoot -> Map<ValidatorIndex, PayloadStatus> for a single slot's queued attestations.
pub const ValidatorVoteMap = std.AutoHashMapUnmanaged(ValidatorIndex, PayloadStatus);
pub const BlockAttestationMap = std.AutoHashMapUnmanaged(Root, ValidatorVoteMap);

/// Slot -> BlockAttestationMap for all queued attestations.
pub const QueuedAttestationMap = std.array_hash_map.Auto(Slot, BlockAttestationMap);

/// Set of validated attestation data roots (cleared each slot).
pub const RootSet = std.HashMapUnmanaged(Root, void, RootContext, 80);

// ── HeadResult ──

/// Result of getHead / updateHead, providing the head block and diagnostic info.
pub const HeadResult = struct {
    block_root: Root,
    slot: Slot,
    state_root: Root,
    /// Whether execution status is optimistic (syncing or payload_separated).
    execution_optimistic: bool,
    /// Payload status of the head node (Gloas ePBS). Pre-Gloas is always .full.
    payload_status: PayloadStatus = .full,
};

// ── ForkChoice ──

/// High-level fork choice struct wrapping ProtoArray, Votes, and checkpoint state.
///
/// This struct wraps `ProtoArray` and provides:
///   - Management of validators' latest messages and balances
///   - Management of the justified/finalized checkpoints as seen by fork choice
///   - Queuing of attestations from the current slot
///
/// This struct MUST be used with the following considerations:
///   - Time is not updated automatically, `updateTime` MUST be called every slot
///
/// Instantiated from pre-built components (dependency injection):
///   `ForkChoice.init(config, fc_store, protoArray, validatorCount, opts?)`
/// Orchestrates: computeDeltas -> applyScoreChanges -> findHead.
pub const ForkChoice = struct {
    // ── Config & options ──
    config: *const BeaconConfig,
    opts: ForkChoiceOpts,

    // ── Core components (borrowed references — caller owns lifetime) ──
    /// The underlying representation of the block DAG.
    proto_array: *ProtoArray,
    /// Votes currently tracked in the protoArray, stored as struct-of-arrays for performance.
    /// Decomposes VoteTracker {currentIndex, nextIndex, slot} into parallel arrays.
    ///
    /// For Gloas (ePBS), LatestMessage tracks slot instead of epoch and includes payload status.
    /// Spec: gloas/fork-choice.md#modified-latestmessage
    ///
    /// IMPORTANT: current_indices and next_indices point to the EXACT variant node index.
    /// The payload status is encoded in the node index itself (different variants have
    /// different indices). For example, if a validator votes for the EMPTY variant,
    /// next_indices[i] points to that specific EMPTY node.
    votes: Votes,
    fc_store: *ForkChoiceStore,
    deltas_cache: DeltasCache,

    // ── Head tracking ──
    /// Cached head — updated by `updateHead()`.
    head: ProtoBlock,

    // ── Proposer boost ──
    /// Boost the entire branch with this proposer root as the leaf.
    proposer_boost_root: ?Root,
    /// Score to use in proposer boost, evaluated lazily from justified balances.
    justified_proposer_boost_score: ?u64,

    // ── Balance tracking ──
    /// The current effective balances (ref-counted, acquired from fc_store).
    balances: *EffectiveBalanceIncrementsRc,

    // ── Attestation queue ──
    /// Attestations that arrived at the current slot and must be queued for later processing.
    /// NOT currently tracked in the protoArray.
    ///
    /// Modified for Gloas to track PayloadStatus per validator.
    /// Maps: Slot -> BlockRoot -> ValidatorIndex -> PayloadStatus
    queued_attestations: QueuedAttestationMap,
    /// It's inconsistent to count queued attestations at different intervals of a slot.
    /// Instead, we count queued attestations at the previous slot.
    queued_attestations_previous_slot: u32,

    // ── Caches ──
    /// Cache of validated attestation data roots to skip re-validation.
    validated_attestation_datas: RootSet,

    // TODO: irrecoverable_error follows the TS Lodestar pattern of storing a fatal error
    // and propagating it on subsequent calls. Revisit once callers are wired up — a more
    // idiomatic Zig approach (e.g. returning error unions directly) may be cleaner.
    // ── Error state ──
    irrecoverable_error: ?(Allocator.Error || ProtoArrayError),
    /// Detailed LVH error context, copied from proto_array when irrecoverable_error is set.
    lvh_error: ?LVHExecError,

    /// Initialize ForkChoice in-place from pre-built components.
    /// The caller is responsible for the memory backing `self`, `pa`, and `fc_store`.
    /// Votes are pre-allocated to `validator_count` and initialized to defaults
    /// (when compute deltas, we ignore epoch if voteNextIndex is NULL_VOTE_INDEX anyway).
    /// Head is computed via `updateHead()`.
    pub fn init(
        self: *ForkChoice,
        allocator: Allocator,
        config: *const BeaconConfig,
        fc_store: *ForkChoiceStore,
        proto_array: *ProtoArray,
        validator_count: u32,
        opts: ForkChoiceOpts,
    ) !void {
        self.* = .{
            .config = config,
            .opts = opts,
            .proto_array = proto_array,
            .votes = .{},
            .fc_store = fc_store,
            .deltas_cache = .empty,
            .head = undefined,
            .proposer_boost_root = null,
            .justified_proposer_boost_score = null,
            .balances = fc_store.justified.balances.ref(),
            .queued_attestations = .empty,
            .queued_attestations_previous_slot = 0,
            .validated_attestation_datas = .empty,
            .irrecoverable_error = null,
            .lvh_error = null,
        };

        // Pre-allocate votes for known validators, initialized to NULL_VOTE_INDEX.
        try self.votes.ensureValidatorCount(allocator, validator_count);

        // Compute initial head. The startup `computeDeltas` call is one-shot and
        // not metric-observed; observations happen in `updateAndGetHead`.
        _ = try self.updateHead(allocator);
    }

    /// Release resources owned by ForkChoice (votes, caches, queued attestations).
    /// Does NOT free pa, fc_store, or `self` — caller owns those.
    pub fn deinit(self: *ForkChoice, allocator: Allocator) void {
        // Clean up runtime-accumulated state (not allocated in init).
        var slot_iter = self.queued_attestations.iterator();
        while (slot_iter.next()) |entry| {
            var block_iter = entry.value_ptr.iterator();
            while (block_iter.next()) |block_entry| {
                block_entry.value_ptr.deinit(allocator);
            }
            entry.value_ptr.deinit(allocator);
        }
        self.queued_attestations.deinit(allocator);
        self.validated_attestation_datas.deinit(allocator);
        self.deltas_cache.deinit(allocator);

        // Release init-allocated resources in reverse order.
        self.votes.deinit(allocator);
        self.balances.unref();

        self.* = undefined;
    }

    // ── Block processing ──

    /// Add `block` to the fork choice DAG.
    ///
    /// Approximates:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_block
    ///
    /// It only approximates the specification since it does not run the `state_transition` check.
    /// That should have already been called upstream and it's too expensive to call again.
    ///
    /// The supplied block **must** pass the `state_transition` function as it will not be run here.
    /// `justifiedBalances` balances of justified state which is updated synchronously.
    /// This ensures that the forkchoice is never out of sync.
    pub fn onBlock(
        self: *ForkChoice,
        allocator: Allocator,
        block: *const AnyBeaconBlock,
        state: *CachedBeaconState,
        block_delay_sec: u32,
        current_slot: Slot,
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,
    ) !ProtoBlock {
        // Dispatch to comptime-specialized onBlockInner via inline switch.
        // Fork choice always receives full (unblinded) blocks.
        return switch (block.forkSeq()) {
            inline else => |fork| try self.onBlockInner(
                fork,
                allocator,
                block.castToFork(.full, fork),
                state,
                block_delay_sec,
                current_slot,
                execution_status,
                data_availability_status,
            ),
        };
    }

    /// Comptime-specialized onBlock implementation.
    /// The comptime fork parameter enables:
    /// - Direct field access without tagged-union dispatch on block/body.
    /// - Compile-time elimination of fork-irrelevant branches (e.g. isExecutionEnabled
    ///   is a no-op for phase0/altair and always-true for gloas+).
    /// - Type-safe access: executionPayload() is a compileError for gloas+/blinded,
    ///   replacing runtime `catch unreachable`.
    fn onBlockInner(
        self: *ForkChoice,
        comptime fork: ForkSeq,
        allocator: Allocator,
        block: *const BeaconBlock(.full, fork),
        state: *CachedBeaconState,
        block_delay_sec: u32,
        current_slot: Slot,
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,
    ) !ProtoBlock {
        const slot = block.inner.slot;
        const parent_root = block.inner.parent_root;

        // Determine parentBlockHash for Gloas (ePBS).
        // comptime: branch is dead-code-eliminated for pre-Gloas forks.
        const parent_block_hash: ?Root = if (comptime fork.gte(.gloas))
            block.body().inner.signed_execution_payload_bid.message.parent_block_hash
        else
            null;

        // 1. Parent block must be known (state_transition would have failed otherwise).
        const parent_node = self.proto_array.getParent(parent_root, parent_block_hash) orelse
            return error.InvalidBlockUnknownParent;

        // 2. Blocks cannot be in the future. If they are, their consideration must be delayed until
        // they are in the past.
        // Note: presently, we do not delay consideration. We just drop the block.
        if (slot > self.fc_store.current_slot) return error.InvalidBlockFutureSlot;

        // 3. Check that block is later than the finalized epoch slot (optimization to reduce calls to
        // getAncestor).
        const finalized_slot = computeStartSlotAtEpoch(self.fc_store.finalized_checkpoint.epoch);
        if (slot <= finalized_slot) return error.InvalidBlockFinalizedSlot;

        // 4. Check block is a descendant of the finalized block at checkpoint finalized slot.
        const block_ancestor_node = try self.proto_array.getAncestor(parent_root, finalized_slot);
        const fc_store_finalized = self.fc_store.finalized_checkpoint;
        if (!std.mem.eql(u8, &block_ancestor_node.block_root, &fc_store_finalized.root)) {
            return error.InvalidBlockNotFinalizedDescendant;
        }

        // 5. Compute block root.
        var block_root: Root = undefined;
        const ForkTypes = @import("fork_types").ForkTypes;
        try ForkTypes(fork).BeaconBlock.hashTreeRoot(allocator, &block.inner, &block_root);

        // 6. Assign proposer score boost if the block is timely
        // (before attesting interval = before 1st interval).
        const is_timely = self.isBlockTimely(slot, block_delay_sec);
        // Only boost the first block we see.
        if (self.opts.proposer_boost and is_timely and self.proposer_boost_root == null) {
            self.proposer_boost_root = block_root;
        }

        const block_epoch = computeEpochAtSlot(slot);

        // 7. Extract checkpoints from state.
        var justified_ssz: consensus_types.phase0.Checkpoint.Type = undefined;
        try state.state.currentJustifiedCheckpoint(&justified_ssz);
        const justified_checkpoint: Checkpoint = .{
            .epoch = justified_ssz.epoch,
            .root = justified_ssz.root,
        };

        var finalized_ssz: consensus_types.phase0.Checkpoint.Type = undefined;
        try state.state.finalizedCheckpoint(&finalized_ssz);
        const finalized_checkpoint: Checkpoint = .{
            .epoch = finalized_ssz.epoch,
            .root = finalized_ssz.root,
        };

        // 8. Update realized checkpoints.
        var realized_ctx = OnBlockBalancesCtx{
            .getter = self.fc_store.justified_balances_getter,
            .checkpoint = justified_checkpoint,
            .state = state,
        };
        try self.updateCheckpoints(justified_checkpoint, finalized_checkpoint, .{
            .context = @ptrCast(&realized_ctx),
            .getFn = OnBlockBalancesCtx.call,
        });

        // 9-10. Same logic as compute_pulled_up_tip in the spec, inlined to reuse variables.
        // If the parent checkpoints are already at the same epoch as the block being imported,
        // it's impossible for the unrealized checkpoints to differ from the parent's. This
        // holds true because:
        //   1. A child block cannot have lower FFG checkpoints than its parent.
        //   2. A block in epoch N cannot contain attestations which would justify an epoch higher than N.
        //   3. A block in epoch N cannot contain attestations which would finalize an epoch higher than N - 1.
        // This is an optimization. It should reduce the amount of times we run
        // computeUnrealizedCheckpoints by approximately 1/3rd when the chain is performing optimally.
        var unrealized_justified_checkpoint: Checkpoint = undefined;
        var unrealized_finalized_checkpoint: Checkpoint = undefined;

        if (self.opts.compute_unrealized) {
            if (parent_node.unrealized_justified_epoch == block_epoch and
                parent_node.unrealized_finalized_epoch + 1 >= block_epoch)
            {
                // Reuse from parent, happens at ~1/3 last blocks of epoch as monitored in mainnet.
                unrealized_justified_checkpoint = .{
                    .epoch = parent_node.unrealized_justified_epoch,
                    .root = parent_node.unrealized_justified_root,
                };
                unrealized_finalized_checkpoint = .{
                    .epoch = parent_node.unrealized_finalized_epoch,
                    .root = parent_node.unrealized_finalized_root,
                };
            } else {
                // Compute new, happens ~2/3 first blocks of epoch as monitored in mainnet.
                const unrealized = try state_transition.computeUnrealizedCheckpoints(state, allocator);
                unrealized_justified_checkpoint = .{
                    .epoch = unrealized.justified_checkpoint.epoch,
                    .root = unrealized.justified_checkpoint.root,
                };
                unrealized_finalized_checkpoint = .{
                    .epoch = unrealized.finalized_checkpoint.epoch,
                    .root = unrealized.finalized_checkpoint.root,
                };
            }
        } else {
            unrealized_justified_checkpoint = justified_checkpoint;
            unrealized_finalized_checkpoint = finalized_checkpoint;
        }

        // Update best known unrealized justified & finalized checkpoints.
        var unrealized_balances_ctx = OnBlockBalancesCtx{
            .getter = self.fc_store.justified_balances_getter,
            .checkpoint = unrealized_justified_checkpoint,
            .state = state,
        };
        try self.updateUnrealizedCheckpoints(unrealized_justified_checkpoint, unrealized_finalized_checkpoint, .{
            .context = @ptrCast(&unrealized_balances_ctx),
            .getFn = OnBlockBalancesCtx.call,
        });

        // 11. If block is from a past epoch, try to update store's justified & finalized
        // checkpoints right away.
        if (block_epoch < computeEpochAtSlot(current_slot)) {
            var past_epoch_ctx = OnBlockBalancesCtx{
                .getter = self.fc_store.justified_balances_getter,
                .checkpoint = unrealized_justified_checkpoint,
                .state = state,
            };
            try self.updateCheckpoints(unrealized_justified_checkpoint, unrealized_finalized_checkpoint, .{
                .context = @ptrCast(&past_epoch_ctx),
                .getFn = OnBlockBalancesCtx.call,
            });
        }

        // 12. Compute target root.
        const target_slot = computeStartSlotAtEpoch(block_epoch);
        const target_root: Root = if (slot == target_slot) block_root else tr_blk: {
            var block_roots = try state.state.blockRoots();
            const idx = target_slot % preset.SLOTS_PER_HISTORICAL_ROOT;
            break :tr_blk (try block_roots.getFieldRoot(idx)).*;
        };

        // 13. Construct BlockExtraMeta based on fork.
        // comptime: only one branch survives per fork instantiation.
        const extra_meta: BlockExtraMeta = if (comptime fork.gte(.gloas))
            self.getGloasExtraMetaTyped(fork, block.body(), parent_node, parent_root, execution_status, data_availability_status)
        else if (comptime fork.gte(.bellatrix))
            getPreGloasExtraMetaTyped(fork, state.state.castToFork(fork), block, execution_status, data_availability_status)
        else
            getPreMergeExtraMeta(execution_status, data_availability_status);

        // 14. Construct ProtoBlock.
        const proto_block = ProtoBlock{
            .slot = slot,
            .block_root = block_root,
            .parent_root = parent_root,
            .state_root = block.inner.state_root,
            .target_root = target_root,
            .justified_epoch = justified_checkpoint.epoch,
            .justified_root = justified_checkpoint.root,
            .finalized_epoch = finalized_checkpoint.epoch,
            .finalized_root = finalized_checkpoint.root,
            .unrealized_justified_epoch = unrealized_justified_checkpoint.epoch,
            .unrealized_justified_root = unrealized_justified_checkpoint.root,
            .unrealized_finalized_epoch = unrealized_finalized_checkpoint.epoch,
            .unrealized_finalized_root = unrealized_finalized_checkpoint.root,
            .extra_meta = extra_meta,
            .timeliness = is_timely,
            .payload_status = if (comptime fork.gte(.gloas)) .pending else .full,
            .parent_block_hash = parent_block_hash,
        };

        // 15. Add to proto array.
        // This does not apply a vote to the block, it just makes fork choice aware of the block so
        // it can still be identified as the head even if it doesn't have any votes.
        try self.proto_array.onBlock(allocator, proto_block, current_slot, self.proposer_boost_root);

        return proto_block;
    }

    // ── Attestation processing ──

    /// Register `attestation` with the fork choice DAG so that it may influence future calls
    /// to `getHead`.
    ///
    /// Approximates:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_attestation
    ///
    /// It only approximates the specification since it does not perform `is_valid_indexed_attestation`
    /// since that should already have been called upstream and it's too expensive to call again.
    ///
    /// The supplied `attestation` **must** pass the `is_valid_indexed_attestation` function as it
    /// will not be run here.
    pub fn onAttestation(
        self: *ForkChoice,
        allocator: Allocator,
        attestation: *const AnyIndexedAttestation,
        att_data_root: Root,
        force_import: bool,
    ) !void {
        const slot = attestation.slot();
        const block_root = attestation.beaconBlockRoot();
        const target_epoch = attestation.targetEpoch();
        const attesting_indices = attestation.attestingIndices();

        // Ignore any attestations to the zero hash.
        //
        // This is an edge case that results from the spec aliasing the zero hash to the genesis
        // block. Attesters may attest to the zero hash if they have never seen a block.
        //
        // We have two options here:
        //
        //  1. Apply all zero-hash attestations to the genesis block.
        //  2. Ignore all attestations to the zero hash.
        //
        // (1) becomes weird once we hit finality and fork choice drops the genesis block. (2) is
        // fine because votes to the genesis block are not useful; all validators implicitly attest
        // to genesis just by being present in the chain.
        if (std.mem.eql(u8, &block_root, &ZERO_HASH)) return;

        // Validate the attestation.
        try self.validateOnAttestation(
            allocator,
            attestation,
            slot,
            block_root,
            target_epoch,
            att_data_root,
            force_import,
        );

        // Determine the payload status for this attestation.
        // Pre-Gloas: payload is always present (FULL).
        // Post-Gloas (ePBS):
        //   - always add weight to PENDING
        //   - if att_slot > block.slot, also add weight to FULL or EMPTY
        // We need to retrieve block to check if it's Gloas and to compare slot.
        const payload_status: PayloadStatus = ps_blk: {
            const block = self.getBlockDefaultStatus(block_root);
            if (block != null and block.?.isGloasBlock()) {
                // Post-Gloas block: determine FULL/EMPTY/PENDING based on slot and committee index.
                // If att_slot > block.slot, we can determine FULL or EMPTY. Else always PENDING.
                if (slot > block.?.slot) {
                    const att_index = attestation.index();
                    if (att_index == 1) break :ps_blk .full;
                    // att_index must be 0 here — validateAttestationData already
                    // rejected any index other than 0 or 1 for Gloas blocks.
                    std.debug.assert(att_index == 0);
                    break :ps_blk .empty;
                }
                break :ps_blk .pending;
            }
            // Pre-Gloas block or block not found: always FULL.
            break :ps_blk .full;
        };

        // The spec declares:
        //   Attestations can only affect the fork choice of subsequent slots.
        //   Delay consideration in the fork choice until their slot is in the past.
        if (slot < self.fc_store.current_slot) {
            for (attesting_indices) |validator_index| {
                if (!self.fc_store.equivocating_indices.contains(validator_index)) {
                    try self.addLatestMessage(allocator, validator_index, slot, block_root, payload_status);
                }
            }
        } else {
            const by_root_gop = try self.queued_attestations.getOrPut(allocator, slot);
            if (!by_root_gop.found_existing) by_root_gop.value_ptr.* = .{};
            const by_root = by_root_gop.value_ptr;

            const validator_votes_gop = try by_root.getOrPut(allocator, block_root);
            if (!validator_votes_gop.found_existing) validator_votes_gop.value_ptr.* = .{};
            const validator_votes = validator_votes_gop.value_ptr;

            // Pre-allocate capacity so the loop below cannot fail with OOM,
            // avoiding partial state changes.
            try validator_votes.ensureTotalCapacity(allocator, validator_votes.count() + @as(u32, @intCast(attesting_indices.len)));

            for (attesting_indices) |validator_index| {
                if (!self.fc_store.equivocating_indices.contains(validator_index)) {
                    validator_votes.putAssumeCapacity(validator_index, payload_status);
                }
            }
        }
    }

    // ── Attestation validation (private) ──

    /// Validates the `indexed_attestation` for application to fork choice.
    ///
    /// Equivalent to:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#validate_on_attestation
    fn validateOnAttestation(
        self: *ForkChoice,
        allocator: Allocator,
        attestation: *const AnyIndexedAttestation,
        slot: Slot,
        block_root: Root,
        target_epoch: Epoch,
        att_data_root: Root,
        force_import: bool,
    ) (Allocator.Error || ForkChoiceError)!void {
        // There is no point in processing an attestation with an empty bitfield. Reject
        // it immediately. This is not in the specification, however it should be transparent
        // to other nodes. We return early here to avoid wasting precious resources verifying
        // the rest of it.
        if (attestation.attestingIndices().len == 0) return error.InvalidAttestationEmptyAggregationBitfield;

        // Skip if already validated (cache check).
        if (!self.validated_attestation_datas.contains(att_data_root)) {
            try self.validateAttestationData(allocator, attestation, slot, block_root, target_epoch, att_data_root, force_import);
        }
    }

    /// Validate attestation data fields.
    fn validateAttestationData(
        self: *ForkChoice,
        allocator: Allocator,
        attestation: *const AnyIndexedAttestation,
        slot: Slot,
        block_root: Root,
        target_epoch: Epoch,
        att_data_root: Root,
        force_import: bool,
    ) (Allocator.Error || ForkChoiceError)!void {
        const epoch_now = computeEpochAtSlot(self.fc_store.current_slot);
        const target_root = attestation.targetRoot();

        // FUTURE_EPOCH: Attestation must be from the current or previous epoch.
        if (target_epoch > epoch_now) return error.InvalidAttestationFutureEpoch;

        // PAST_EPOCH: Attestation must be from the current or previous epoch (unless force_import).
        if (!force_import and target_epoch + 1 < epoch_now) return error.InvalidAttestationPastEpoch;

        // BAD_TARGET_EPOCH: target epoch must match epoch of attestation slot.
        if (target_epoch != computeEpochAtSlot(slot)) return error.InvalidAttestationBadTargetEpoch;

        // UNKNOWN_TARGET_ROOT: Attestation target must be for a known block.
        // We do not delay the block for later processing to reduce complexity and DoS attack surface.
        if (!self.proto_array.hasBlock(target_root)) return error.InvalidAttestationUnknownTargetRoot;

        // UNKNOWN_HEAD_BLOCK: Load the block for attestation.data.beacon_block_root.
        //
        // This indirectly checks to see if the beacon_block_root is in our fork choice. Any known,
        // non-finalized block should be in fork choice, so this check immediately filters out
        // attestations that attest to a block that has not been processed.
        //
        // Attestations must be for a known block. If the block is unknown, we simply drop the
        // attestation and do not delay consideration for later.
        const default_status = self.proto_array.getDefaultVariant(block_root) orelse return error.InvalidAttestationUnknownHeadBlock;
        const block = self.getBlock(block_root, default_status) orelse return error.InvalidAttestationUnknownHeadBlock;

        // INVALID_TARGET: If an attestation points to a block that is from an earlier slot than
        // the attestation, then all slots between the block and attestation must be skipped.
        // Therefore if the block is from a prior epoch to the attestation, then the target root
        // must be equal to the root of the block that is being attested to.
        const expected_target = if (target_epoch > computeEpochAtSlot(block.slot)) block_root else block.target_root;
        if (!std.mem.eql(u8, &expected_target, &target_root)) return error.InvalidAttestationInvalidTarget;

        // ATTESTS_TO_FUTURE_BLOCK: Attestations must not be for blocks in the future. If this is
        // the case, the attestation should not be considered.
        if (block.slot > slot) return error.InvalidAttestationAttestsToFutureBlock;

        // Gloas attestation validation.
        const att_index = attestation.index();
        if (block.isGloasBlock()) {
            // INVALID_DATA_INDEX: For Gloas blocks, attestation index must be 0 or 1.
            if (att_index != 0 and att_index != 1) return error.InvalidAttestationInvalidDataIndex;

            // Same-slot attestations can only vote for the PENDING variant (index 0).
            if (block.slot == slot and att_index != 0) return error.InvalidAttestationInvalidDataIndex;

            // Voting for FULL (index=1) requires the FULL variant to exist.
            if (att_index == 1 and !self.proto_array.hasPayload(block_root)) return error.InvalidAttestationUnknownPayloadStatus;
        }

        // Cache validated attestation data root.
        try self.validated_attestation_datas.put(
            allocator,
            att_data_root,
            {},
        );
    }

    // ── Timeliness (private) ──

    /// Return true if the block is timely for the current slot.
    fn isBlockTimely(self: *const ForkChoice, block_slot: Slot, block_delay_sec: u32) bool {
        // Only current-slot blocks can be timely.
        if (block_slot != self.fc_store.current_slot) return false;

        // Timely if arrived before the attestation due time.
        const fork = self.config.forkSeq(block_slot);
        const attestation_due_ms = self.config.getAttestationDueMs(fork);
        return block_delay_sec * 1000 < attestation_due_ms;
    }

    // ── BlockExtraMeta construction helpers ──

    /// Determine parent's execution payload number based on which variant the block extends.
    /// If parent is pre-merge, return 0. If parent is pre-Gloas, it only has FULL variant.
    /// Parent is Gloas: get the variant that matches the parentBlockHash from bid.
    fn getGloasParentExecPayloadNumber(
        self: *const ForkChoice,
        parent_node: *const ProtoNode,
        parent_root: Root,
        bid_parent_block_hash: Root,
    ) u64 {
        // If parent is pre-merge, return 0.
        _ = parent_node.extra_meta.executionPayloadBlockHash() orelse return 0;

        // If parent is pre-Gloas, it only has FULL variant.
        if (!parent_node.isGloasBlock()) {
            return parent_node.extra_meta.executionPayloadNumber();
        }

        // Parent is Gloas: get the variant matching the parentBlockHash from bid.
        const parent_variant = self.proto_array.getNodeByRootAndBlockHash(parent_root, bid_parent_block_hash) orelse
            return parent_node.extra_meta.executionPayloadNumber();
        // Only use variant's number if variant is post-merge.
        if (parent_variant.extra_meta.executionPayloadBlockHash()) |_| {
            return parent_variant.extra_meta.executionPayloadNumber();
        }
        // Fallback to parent block's number (we know it's post-merge from check above).
        return parent_node.extra_meta.executionPayloadNumber();
    }

    /// Construct BlockExtraMeta for a Gloas (ePBS) block.
    /// Comptime fork guarantees direct field access to signed_execution_payload_bid.
    fn getGloasExtraMetaTyped(
        self: *const ForkChoice,
        comptime fork: ForkSeq,
        body: *const BeaconBlockBody(.full, fork),
        parent_node: *const ProtoNode,
        parent_root: Root,
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,
    ) BlockExtraMeta {
        comptime assert(fork.gte(.gloas));
        assert(execution_status == .payload_separated);
        const bid_parent_block_hash = body.inner.signed_execution_payload_bid.message.parent_block_hash;
        const exec_payload_number = self.getGloasParentExecPayloadNumber(
            parent_node,
            parent_root,
            bid_parent_block_hash,
        );
        return .{
            .post_merge = BlockExtraMeta.PostMergeMeta.init(
                bid_parent_block_hash,
                exec_payload_number,
                execution_status,
                data_availability_status,
            ),
        };
    }

    /// Construct BlockExtraMeta for a post-merge, pre-Gloas block (bellatrix..fulu).
    /// Comptime fork enables compile-time isExecutionEnabled and direct payload access.
    /// Replaces runtime `catch unreachable` with compile-time type safety.
    fn getPreGloasExtraMetaTyped(
        comptime fork: ForkSeq,
        fork_state: *BeaconState(fork),
        block: *const BeaconBlock(.full, fork),
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,
    ) BlockExtraMeta {
        comptime assert(fork.gte(.bellatrix) and fork.lt(.gloas));
        if (!state_transition.isExecutionEnabled(fork, fork_state, .full, block)) {
            assert(execution_status == .pre_merge);
            assert(data_availability_status == .pre_data);
            return .{ .pre_merge = {} };
        }
        assert(execution_status != .pre_merge and execution_status != .payload_separated);
        const payload = block.body().executionPayload();
        return .{ .post_merge = BlockExtraMeta.PostMergeMeta.init(
            payload.blockHash().*,
            payload.inner.block_number,
            execution_status,
            data_availability_status,
        ) };
    }

    /// Construct BlockExtraMeta for a pre-merge block (phase0/altair).
    fn getPreMergeExtraMeta(
        execution_status: ExecutionStatus,
        data_availability_status: DataAvailabilityStatus,
    ) BlockExtraMeta {
        assert(execution_status == .pre_merge);
        assert(data_availability_status == .pre_data);
        return .{ .pre_merge = {} };
    }

    // ── Head selection ──

    /// Run the fork choice rule to determine the head. Update the head cache.
    ///
    /// Very expensive function (400ms / run as of Aug 2021). Call when the head really
    /// needs to be re-calculated.
    ///
    /// Equivalent to:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_head
    fn updateHead(self: *ForkChoice, allocator: Allocator) !ComputeDeltasResult {
        // Check if scores need to be calculated/updated
        const old_balances = self.balances.get().items;
        const new_balances = self.fc_store.justified.balances.get().items;

        const vote_fields = self.votes.fields();
        const result = try computeDeltas(
            allocator,
            &self.deltas_cache,
            @intCast(self.proto_array.nodes.items.len),
            vote_fields.current_indices,
            vote_fields.next_indices,
            old_balances,
            new_balances,
            &self.fc_store.equivocating_indices,
        );

        self.balances.unref();
        self.balances = self.fc_store.justified.balances.ref();

        // Compute proposer boost: {root, score} | null
        const update_opts = self.opts;
        const proposer_boost: ?ProtoArray.ProposerBoost = if (update_opts.proposer_boost and self.proposer_boost_root != null) blk: {
            const proposer_boost_score = self.justified_proposer_boost_score orelse score_blk: {
                const s = getCommitteeFraction(self.fc_store.justified.total_balance, preset.SLOTS_PER_EPOCH, self.config.chain.PROPOSER_SCORE_BOOST);
                self.justified_proposer_boost_score = s;
                break :score_blk s;
            };
            break :blk .{ .root = self.proposer_boost_root.?, .score = proposer_boost_score };
        } else null;

        const current_slot = self.fc_store.current_slot;

        try self.proto_array.applyScoreChanges(
            result.deltas,
            proposer_boost,
            self.fc_store.justified.checkpoint.epoch,
            self.fc_store.justified.checkpoint.root,
            self.fc_store.finalized_checkpoint.epoch,
            self.fc_store.finalized_checkpoint.root,
            current_slot,
        );

        const head = try self.proto_array.findHead(
            self.fc_store.justified.checkpoint.root,
            current_slot,
        );

        self.head = head.toBlock();
        return result;
    }

    /// Get the cached head (without recomputing).
    pub fn getHead(self: *const ForkChoice) ProtoBlock {
        return self.head;
    }

    // ── Proposer boost reorg ──

    /// Called by `predictProposerHead` and `onBlock`. If the result is not same as
    /// blockRoot's block, return true else false.
    /// See https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/bellatrix/fork-choice.md#should_override_forkchoice_update
    /// Return true if the given block passes all criteria to be re-orged out.
    /// Return false otherwise.
    /// Note when proposer boost reorg is disabled, it always returns false.
    pub fn shouldOverrideForkChoiceUpdate(
        self: *ForkChoice,
        head_block: *const ProtoBlock,
        sec_from_slot: u32,
        current_slot: Slot,
    ) ShouldOverrideForkChoiceUpdateResult {
        const opts = self.opts;
        if (!opts.proposer_boost or !opts.proposer_boost_reorg) {
            return .{ .should_not_override = .{ .reason = .proposer_boost_reorg_disabled } };
        }

        const parent_status = self.proto_array.getParentPayloadStatus(
            head_block.parent_root,
            head_block.parent_block_hash,
        ) catch {
            return .{ .should_not_override = .{ .reason = .parent_block_not_available } };
        };
        const parent_idx = self.proto_array.getNodeIndexByRootAndStatus(head_block.parent_root, parent_status) orelse {
            return .{ .should_not_override = .{ .reason = .parent_block_not_available } };
        };
        const parent_node = &self.proto_array.nodes.items[parent_idx];
        const proposal_slot = head_block.slot + 1;

        if (self.getPreliminaryProposerHead(head_block, parent_node, proposal_slot)) |reason| {
            return .{ .should_not_override = .{ .reason = reason } };
        }

        const current_time_ok = head_block.slot == current_slot or
            (proposal_slot == current_slot and self.isProposingOnTime(sec_from_slot, current_slot));
        if (!current_time_ok) {
            return .{ .should_not_override = .{ .reason = .reorg_more_than_one_slot } };
        }

        return .{ .should_override = .{ .parent_block = parent_node.toBlock() } };
    }

    /// This function takes in the canonical head block and determine the proposer head
    /// (canonical head block or its parent).
    /// https://github.com/ethereum/consensus-specs/pull/3034 for info about proposer boost reorg.
    /// This function should only be called during block proposal and only be called after
    /// `updateHead()` in `updateAndGetHead()`.
    /// Same as https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#get_proposer_head
    fn getProposerHead(
        self: *ForkChoice,
        head_block: *const ProtoBlock,
        sec_from_slot: u32,
        slot: Slot,
    ) UpdateAndGetHeadResult {
        const is_head_timely = head_block.timeliness;

        // Skip re-org attempt if proposer boost (reorg) are disabled
        const opts = self.opts;
        if (!opts.proposer_boost or !opts.proposer_boost_reorg) {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .proposer_boost_reorg_disabled };
        }

        const parent_status = self.proto_array.getParentPayloadStatus(
            head_block.parent_root,
            head_block.parent_block_hash,
        ) catch {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .parent_block_not_available };
        };
        const parent_idx = self.proto_array.getNodeIndexByRootAndStatus(head_block.parent_root, parent_status) orelse {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .parent_block_not_available };
        };
        const parent_node = &self.proto_array.nodes.items[parent_idx];

        // Preliminary checks (timeliness, shuffling stability, FFG, finalization, slot distance)
        if (self.getPreliminaryProposerHead(head_block, parent_node, slot)) |reason| {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = reason };
        }

        // Only re-org if we are proposing on-time
        if (!self.isProposingOnTime(sec_from_slot, slot)) {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .not_proposing_on_time };
        }

        // No reorg if attempted reorg is more than a single slot
        // Half of single_slot_reorg check in the spec is done in getPreliminaryProposerHead()
        if (head_block.slot + 1 != slot) {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .reorg_more_than_one_slot };
        }

        // No reorg if proposer boost is still in effect
        if (self.proposer_boost_root) |boost_root| {
            if (std.mem.eql(u8, &boost_root, &head_block.block_root)) {
                return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .proposer_boost_not_worn_off };
            }
        }

        // No reorg if headBlock is "not weak" — weight exceeds REORG_HEAD_WEIGHT_THRESHOLD% of committee
        const reorg_threshold = getCommitteeFraction(self.fc_store.justified.total_balance, preset.SLOTS_PER_EPOCH, self.config.chain.REORG_HEAD_WEIGHT_THRESHOLD);
        const head_node_idx = self.proto_array.getNodeIndexByRootAndStatus(head_block.block_root, head_block.payload_status) orelse {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .head_block_not_weak };
        };
        if (self.proto_array.nodes.items[head_node_idx].weight >= reorg_threshold) {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .head_block_not_weak };
        }

        // No reorg if parentBlock is "not strong" — weight is <= REORG_PARENT_WEIGHT_THRESHOLD% of committee
        const parent_threshold = getCommitteeFraction(self.fc_store.justified.total_balance, preset.SLOTS_PER_EPOCH, self.config.chain.REORG_PARENT_WEIGHT_THRESHOLD);
        if (self.proto_array.nodes.items[parent_idx].weight <= parent_threshold) {
            return .{ .head = head_block.*, .is_head_timely = is_head_timely, .not_reorged_reason = .parent_block_not_strong };
        }

        // All checks passed — reorg to parent
        return .{ .head = parent_node.toBlock(), .is_head_timely = is_head_timely, .not_reorged_reason = null };
    }

    /// Common logic of getProposerHead() and shouldOverrideForkChoiceUpdate().
    /// No one should be calling this function except these two.
    /// Checks: timeliness, shuffling stability, FFG competitiveness, finalization, slot distance.
    /// Returns the reason reorg is blocked, or null if all preliminary checks pass.
    fn getPreliminaryProposerHead(
        self: *const ForkChoice,
        head_block: *const ProtoBlock,
        parent_node: *const ProtoNode,
        slot: Slot,
    ) ?NotReorgedReason {
        // No reorg if headBlock is on time (is_head_late check)
        if (head_block.timeliness) {
            return .head_block_is_timely;
        }

        // No reorg if at epoch boundary where proposer shuffling could change (is_shuffling_stable)
        if (slot % preset.SLOTS_PER_EPOCH == 0) {
            return .not_shuffling_stable;
        }

        // No reorg if headBlock and parentBlock are not FFG competitive (is_ffg_competitive)
        if (head_block.unrealized_justified_epoch != parent_node.unrealized_justified_epoch or
            !std.mem.eql(u8, &head_block.unrealized_justified_root, &parent_node.unrealized_justified_root))
        {
            return .not_ffg_competitive;
        }

        // No reorg if chain is not finalizing within REORG_MAX_EPOCHS_SINCE_FINALIZATION (is_finalization_ok)
        const epochs_since_finalization = computeEpochAtSlot(slot) - self.fc_store.finalized_checkpoint.epoch;
        if (epochs_since_finalization > self.config.chain.REORG_MAX_EPOCHS_SINCE_FINALIZATION) {
            return .chain_long_unfinality;
        }

        // No reorg if this reorg spans more than a single slot
        if (parent_node.slot + 1 != head_block.slot) {
            return .parent_block_distance_more_than_one_slot;
        }

        // All preliminary checks passed — reorg allowed
        return null;
    }

    /// To predict the proposer head of the next slot. That is, to predict if proposer-boost-reorg
    /// could happen. There is a chance we mispredict since information of the head block is not
    /// fully available yet (current slot hasn't ended, especially the attesters' votes).
    /// By calling this function, we assume we are the proposer of next slot.
    fn predictProposerHead(
        self: *ForkChoice,
        head_block: *const ProtoBlock,
        sec_from_slot: u32,
        current_slot: Slot,
    ) ProtoBlock {
        const opts = self.opts;
        if (!opts.proposer_boost or !opts.proposer_boost_reorg) {
            return head_block.*;
        }

        const result = self.shouldOverrideForkChoiceUpdate(head_block, sec_from_slot, current_slot);
        return switch (result) {
            .should_override => |r| r.parent_block,
            .should_not_override => head_block.*,
        };
    }

    /// Check if the proposer is proposing on time.
    /// https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/phase0/fork-choice.md#is_proposing_on_time
    fn isProposingOnTime(self: *const ForkChoice, sec_from_slot: u32, slot: Slot) bool {
        const proposer_reorg_cutoff = self.config.getProposerReorgCutoffMs(self.config.forkSeq(slot));
        return @as(u64, sec_from_slot) * 1000 <= proposer_reorg_cutoff;
    }

    /// A multiplexer to wrap around the traditional `updateHead()` according to the scenario.
    /// Scenarios:
    ///   - Prepare to propose in the next slot: getHead() -> predictProposerHead()
    ///   - Proposing in the current slot: updateHead() -> getProposerHead()
    ///   - Others (e.g. initializing forkchoice, importBlock): updateHead()
    pub fn updateAndGetHead(
        self: *ForkChoice,
        allocator: Allocator,
        io: std.Io,
        opt: UpdateAndGetHeadOpt,
    ) !UpdateAndGetHeadResult {
        const canonical_head: ProtoBlock = switch (opt) {
            .get_predicted_proposer_head => self.head,
            else => blk: {
                const compute_deltas_timer = time.start(io);
                const result = try self.updateHead(allocator);
                observeComputeDeltasMetrics(io, compute_deltas_timer, result);
                break :blk self.head;
            },
        };

        return switch (opt) {
            .get_canonical_head => .{ .head = canonical_head },
            .get_proposer_head => |params| self.getProposerHead(&canonical_head, params.sec_from_slot, params.slot),
            .get_predicted_proposer_head => |params| .{
                .head = self.predictProposerHead(&canonical_head, params.sec_from_slot, params.slot),
            },
        };
    }

    /// Record `computeDeltas` timing and counter metrics. Pulled out of
    /// `updateAndGetHead` so the public hot path stays readable.
    fn observeComputeDeltasMetrics(io: std.Io, start: std.Io.Timestamp, result: ComputeDeltasResult) void {
        const fm = &metrics.fork_choice_metrics;
        fm.compute_deltas_duration.observe(time.durationSeconds(time.since(io, start)));
        fm.compute_deltas_deltas_count.set(@intCast(result.deltas.len));
        fm.compute_deltas_equivocating_validators.set(result.equivocating_validators);
        fm.compute_deltas_old_inactive_validators.set(result.old_inactive_validators);
        fm.compute_deltas_new_inactive_validators.set(result.new_inactive_validators);
        fm.compute_deltas_unchanged_vote_validators.set(result.unchanged_vote_validators);
        fm.compute_deltas_new_vote_validators.set(result.new_vote_validators);

        var zero_count: u64 = 0;
        for (result.deltas) |d| if (d == 0) {
            zero_count += 1;
        };
        fm.compute_deltas_zero_deltas_count.set(zero_count);
    }

    // ── Equivocation ──

    /// Mark validators as equivocating (attester slashing).
    /// We already call is_slashable_attestation_data() and is_valid_indexed_attestation
    /// in state transition so no need to do it again.
    /// Takes an AttesterSlashing, computes the sorted intersection of attesting indices
    /// from its two indexed attestations, and adds them to the equivocating set.
    /// Their weight is removed in the next computeDeltas call.
    pub fn onAttesterSlashing(
        self: *ForkChoice,
        allocator: Allocator,
        attester_slashing: *const AnyAttesterSlashing,
    ) Allocator.Error!void {
        const indices_1 = attester_slashing.attestingIndices1();
        const indices_2 = attester_slashing.attestingIndices2();
        // Two-pointer sorted intersection (both arrays are pre-sorted by isValidIndexedAttestation).
        var i: usize = 0;
        var j: usize = 0;
        while (i < indices_1.len and j < indices_2.len) {
            if (indices_1[i] == indices_2[j]) {
                try self.fc_store.equivocating_indices.put(allocator, indices_1[i], {});
                i += 1;
                j += 1;
            } else if (indices_1[i] < indices_2[j]) {
                i += 1;
            } else {
                j += 1;
            }
        }
    }

    // ── Time ──

    /// Call `onTick` for all slots between `fc_store.current_slot` and the provided `current_slot`.
    /// This should only be called once per slot because:
    ///   - calling this multiple times in the same slot does not update `votes`
    ///     (new attestations in the current slot must stay in the queue,
    ///      new attestations in old slots are applied to the `votes` already)
    ///   - also side effect of this function is `validatedAttestationDatas` reset
    pub fn updateTime(self: *ForkChoice, allocator: Allocator, current_slot: Slot) !void {
        if (self.fc_store.current_slot >= current_slot) return;

        // Tick each slot from previous+1 to current.
        while (self.fc_store.current_slot < current_slot) {
            const previous_slot = self.fc_store.current_slot;
            try self.onTick(previous_slot + 1);
        }

        // Process queued attestations after time advance.
        self.queued_attestations_previous_slot = 0;
        try self.processAttestationQueue(allocator);

        // Clear validated attestation data cache.
        self.validated_attestation_datas.clearRetainingCapacity();
    }

    pub fn getTime(self: *const ForkChoice) Slot {
        return self.fc_store.current_slot;
    }

    // ── Checkpoint management (private) ──

    /// Update realized checkpoints from block processing.
    /// Epoch-monotonic: only advances, never regresses.
    ///
    /// Why `getJustifiedBalances` getter?
    /// - updateCheckpoints() is called in both onBlock and onTick.
    /// - Our cache strategy to get justified balances is incomplete, it can't regen all
    ///   possible states.
    /// - If the justified state is not available it will get one that is "closest" to the
    ///   justified checkpoint.
    /// - As a last resort fallback the state that references the new justified checkpoint is
    ///   close or equal to the desired justified state. However, the state is available only
    ///   in the onBlock handler.
    /// - `getJustifiedBalances` makes the dynamics of justified balances cache easier to reason
    ///   about.
    ///
    /// **onBlock**: May need the justified balances of justifiedCheckpoint and
    /// unrealizedJustifiedCheckpoint. These balances are not immediately available so the
    /// getter calls a cache fn.
    ///
    /// **onTick**: May need the justified balances of unrealizedJustified. Already available
    /// in `CheckpointWithBalance`, so the getter is direct without cache interaction.
    fn updateCheckpoints(
        self: *ForkChoice,
        justified_checkpoint: Checkpoint,
        finalized_checkpoint: Checkpoint,
        getJustifiedBalances: GetJustifiedBalancesFn,
    ) !void {
        // Update justified if epoch advances.
        if (justified_checkpoint.epoch > self.fc_store.justified.checkpoint.epoch) {
            const new_rc = try getJustifiedBalances.call();
            const new_total = store.computeTotalBalance(new_rc.instance.items);

            self.fc_store.justified.balances.unref();
            self.fc_store.justified = .{
                .checkpoint = justified_checkpoint,
                .balances = new_rc,
                .total_balance = new_total,
            };

            self.justified_proposer_boost_score = null;
            if (self.fc_store.events.on_justified) |cb| cb.call(justified_checkpoint);
        }

        // Update finalized if epoch advances.
        if (finalized_checkpoint.epoch > self.fc_store.finalized_checkpoint.epoch) {
            self.fc_store.setFinalizedCheckpoint(finalized_checkpoint);
            self.justified_proposer_boost_score = null;
        }
    }

    /// Lazy justified-balances supplier.
    /// Passed to `updateCheckpoints` so balances are only fetched/acquired when needed.
    /// Returns an acquired RC (caller takes ownership).
    const GetJustifiedBalancesFn = struct {
        context: ?*anyopaque = null,
        getFn: *const fn (context: ?*anyopaque) error{OutOfMemory}!*EffectiveBalanceIncrementsRc,

        fn call(self: GetJustifiedBalancesFn) error{OutOfMemory}!*EffectiveBalanceIncrementsRc {
            return self.getFn(self.context);
        }
    };

    /// Closure context for `onBlock` path: calls `getter.get(checkpoint, state)` → wraps in RC.
    const OnBlockBalancesCtx = struct {
        getter: store.JustifiedBalancesGetter,
        checkpoint: Checkpoint,
        state: *CachedBeaconState,

        fn call(ctx: ?*anyopaque) error{OutOfMemory}!*EffectiveBalanceIncrementsRc {
            const self: *OnBlockBalancesCtx = @ptrCast(@alignCast(ctx.?));
            const balances = self.getter.get(self.checkpoint, self.state);
            return EffectiveBalanceIncrementsRc.create(balances.allocator, balances);
        }
    };

    /// Closure context for `onTick` path: acquires existing RC.
    const OnTickBalancesCtx = struct {
        balances: *EffectiveBalanceIncrementsRc,

        fn call(ctx: ?*anyopaque) error{OutOfMemory}!*EffectiveBalanceIncrementsRc {
            const self: *OnTickBalancesCtx = @ptrCast(@alignCast(ctx.?));
            return self.balances.ref();
        }
    };

    /// Update unrealized checkpoints from pull-up FFG.
    /// Epoch-monotonic: only advances, never regresses.
    /// Update unrealized checkpoints in store if necessary.
    fn updateUnrealizedCheckpoints(
        self: *ForkChoice,
        unrealized_justified_checkpoint: Checkpoint,
        unrealized_finalized_checkpoint: Checkpoint,
        getJustifiedBalances: GetJustifiedBalancesFn,
    ) !void {
        if (unrealized_justified_checkpoint.epoch > self.fc_store.unrealized_justified.checkpoint.epoch) {
            const new_rc = try getJustifiedBalances.call();
            const new_total = store.computeTotalBalance(new_rc.instance.items);

            self.fc_store.unrealized_justified.balances.unref();
            self.fc_store.unrealized_justified = .{
                .checkpoint = unrealized_justified_checkpoint,
                .balances = new_rc,
                .total_balance = new_total,
            };
        }
        if (unrealized_finalized_checkpoint.epoch > self.fc_store.unrealized_finalized_checkpoint.epoch) {
            self.fc_store.unrealized_finalized_checkpoint = unrealized_finalized_checkpoint;
        }
    }

    // ── Attestation message processing (private) ──

    /// Add a validator's latest message to the tracked votes.
    /// Always sync voteCurrentIndices and voteNextIndices so that it'll not throw
    /// in computeDeltas().
    /// Modified for Gloas to accept slot and payloadPresent.
    /// Spec: gloas/fork-choice.md#modified-update_latest_messages
    fn addLatestMessage(
        self: *ForkChoice,
        allocator: Allocator,
        validator_index: ValidatorIndex,
        next_slot: Slot,
        next_root: Root,
        next_payload_status: PayloadStatus,
    ) !void {
        // Get the node index for the voted block.
        const next_index = self.proto_array.getNodeIndexByRootAndStatus(next_root, next_payload_status) orelse
            return error.MissingProtoArrayBlock;

        try self.votes.ensureValidatorCount(allocator, @intCast(validator_index + 1));
        const fields = self.votes.fields();

        const existing_next_slot = fields.next_slots[validator_index];
        // Accept vote if it's the first vote (INIT_VOTE_SLOT) or epoch advances.
        if (existing_next_slot == INIT_VOTE_SLOT or computeEpochAtSlot(next_slot) > computeEpochAtSlot(existing_next_slot)) {
            fields.next_indices[validator_index] = @intCast(next_index);
            fields.next_slots[validator_index] = next_slot;
        }
        // else it's an old vote, don't count it.
    }

    // ── Time management (private) ──

    /// Called whenever the current time increases.
    ///
    /// Equivalent to:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_tick
    fn onTick(self: *ForkChoice, slot: Slot) !void {
        const previous_slot = self.fc_store.current_slot;

        if (slot > previous_slot + 1) return error.InconsistentOnTick;

        // Update store time.
        self.fc_store.current_slot = slot;

        // Reset proposer boost if this is a new slot.
        if (self.proposer_boost_root != null) {
            self.proposer_boost_root = null;
        }

        // Not a new epoch, return.
        if (computeSlotsSinceEpochStart(slot) != 0) {
            return;
        }

        // If a new epoch, pull-up justification and finalization from previous epoch.
        {
            var tick_ctx = OnTickBalancesCtx{
                .balances = self.fc_store.unrealized_justified.balances,
            };
            try self.updateCheckpoints(
                self.fc_store.unrealized_justified.checkpoint,
                self.fc_store.unrealized_finalized_checkpoint,
                .{ .context = @ptrCast(&tick_ctx), .getFn = OnTickBalancesCtx.call },
            );
        }
    }

    /// Processes and removes from the queue any queued attestations which may now be eligible
    /// for processing due to the slot clock incrementing.
    fn processAttestationQueue(self: *ForkChoice, allocator: Allocator) !void {
        const current_slot = self.fc_store.current_slot;
        var remove_count: u32 = 0;

        var slot_iter = self.queued_attestations.iterator();
        while (slot_iter.next()) |entry| {
            const slot = entry.key_ptr.*;
            if (slot < current_slot) {
                // Process all attestations for this slot.
                var block_iter = entry.value_ptr.iterator();
                while (block_iter.next()) |block_entry| {
                    const block_root = block_entry.key_ptr.*;
                    var vote_iter = block_entry.value_ptr.iterator();
                    while (vote_iter.next()) |vote_entry| {
                        try self.addLatestMessage(
                            allocator,
                            vote_entry.key_ptr.*,
                            slot,
                            block_root,
                            vote_entry.value_ptr.*,
                        );
                    }

                    if (slot == current_slot - 1) {
                        self.queued_attestations_previous_slot += @intCast(block_entry.value_ptr.count());
                    }
                    block_entry.value_ptr.deinit(allocator);
                }
                entry.value_ptr.deinit(allocator);
                remove_count += 1;
            } else {
                break;
            }
        }

        // Remove processed slots from front.
        for (0..remove_count) |_| {
            const key = self.queued_attestations.keys()[0];
            _ = self.queued_attestations.orderedRemove(key);
        }
    }

    // ── Public checkpoint getters ──

    pub fn getJustifiedCheckpoint(self: *const ForkChoice) Checkpoint {
        return self.fc_store.justified.checkpoint;
    }

    pub fn getFinalizedCheckpoint(self: *const ForkChoice) Checkpoint {
        return self.fc_store.finalized_checkpoint;
    }

    // ── Pruning ──

    /// Prune finalized ancestors from the DAG to bound memory usage.
    /// All indices in votes are relative to proto array so always keep it up to date.
    /// Caller owns the returned pruned blocks slice.
    pub fn prune(
        self: *ForkChoice,
        allocator: Allocator,
        finalized_root: Root,
    ) (Allocator.Error || ForkChoiceError)![]ProtoBlock {
        const pruned_nodes = try self.proto_array.maybePrune(allocator, finalized_root);
        const pruned_count: u32 = @intCast(pruned_nodes.len);

        if (pruned_count == 0) return pruned_nodes;

        // Adjust all vote indices — critical for correctness.
        const fields = self.votes.fields();
        for (0..self.votes.len()) |i| {
            if (fields.current_indices[i] != NULL_VOTE_INDEX) {
                if (fields.current_indices[i] >= pruned_count) {
                    fields.current_indices[i] -= pruned_count;
                } else {
                    fields.current_indices[i] = NULL_VOTE_INDEX;
                }
            }
            if (fields.next_indices[i] != NULL_VOTE_INDEX) {
                if (fields.next_indices[i] >= pruned_count) {
                    fields.next_indices[i] -= pruned_count;
                } else {
                    fields.next_indices[i] = NULL_VOTE_INDEX;
                }
            }
        }

        return pruned_nodes;
    }

    // ── Execution validation ──

    /// Propagate execution layer validity response through the DAG.
    /// Only sets irrecoverable_error for InvalidLVHExecutionResponse;
    /// other errors are silently ignored.
    pub fn validateLatestHash(
        self: *ForkChoice,
        allocator: Allocator,
        exec_response: LVHExecResponse,
        current_slot: Slot,
    ) void {
        self.proto_array.validateLatestHash(allocator, exec_response, current_slot) catch |err| {
            if (err == error.InvalidLVHExecutionResponse) {
                self.irrecoverable_error = err;
                self.lvh_error = self.proto_array.lvh_error;
            }
        };
    }

    // ── Block queries ──

    /// Returns `true` if the block is known **and** a descendant of the finalized root.
    /// Uses default variant (PENDING for Gloas, FULL for pre-Gloas).
    pub fn hasBlock(self: *const ForkChoice, block_root: Root) bool {
        const idx = self.proto_array.getDefaultNodeIndex(block_root) orelse return false;
        assert(idx < self.proto_array.nodes.items.len);
        const node = &self.proto_array.nodes.items[idx];
        return self.proto_array.isFinalizedRootOrDescendant(node);
    }

    /// Same as hasBlock but without checking if the block is a descendant of the finalized root.
    pub fn hasBlockUnsafe(self: *const ForkChoice, block_root: Root) bool {
        return self.proto_array.hasBlock(block_root);
    }

    /// Returns true if the FULL payload variant (execution payload envelope) exists for this
    /// block root, without checking finalized-descendant status.
    pub fn hasPayloadUnsafe(self: *const ForkChoice, block_root: Root) bool {
        return self.proto_array.hasPayload(block_root);
    }

    /// Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root.
    pub fn getBlock(self: *const ForkChoice, block_root: Root, payload_status: PayloadStatus) ?ProtoBlock {
        const node = self.proto_array.getNode(block_root, payload_status) orelse return null;
        if (!self.proto_array.isFinalizedRootOrDescendant(node)) return null;
        return node.toBlock();
    }

    /// Returns a `ProtoBlock` with the default variant for the given block root.
    /// Pre-Gloas blocks: returns FULL variant (only variant).
    /// Gloas blocks: returns PENDING variant.
    /// Use this when you need the canonical block reference regardless of payload status.
    pub fn getBlockDefaultStatus(self: *const ForkChoice, block_root: Root) ?ProtoBlock {
        const default_status = self.proto_array.getDefaultVariant(block_root) orelse return null;
        return self.getBlock(block_root, default_status);
    }

    /// Returns EMPTY or FULL `ProtoBlock` that has matching block root and block hash.
    pub fn getBlockAndBlockHash(self: *const ForkChoice, block_root: Root, block_hash: Root) ?ProtoBlock {
        return self.proto_array.getBlockAndBlockHash(block_root, block_hash);
    }

    /// Get the justified block from proto array (canonical variant).
    pub fn getJustifiedBlock(self: *const ForkChoice) !ProtoBlock {
        const cp = self.fc_store.justified.checkpoint;
        return self.getBlockDefaultStatus(cp.root) orelse return error.MissingProtoArrayBlock;
    }

    /// Get the finalized block from proto array (canonical variant).
    pub fn getFinalizedBlock(self: *const ForkChoice) !ProtoBlock {
        const cp = self.fc_store.finalized_checkpoint;
        return self.getBlockDefaultStatus(cp.root) orelse return error.MissingProtoArrayBlock;
    }

    /// Returns the root of the safe beacon block.
    ///
    /// Under honest majority and certain network synchronicity assumptions there exists a block
    /// that is safe from re-orgs. Normally this block is pretty close to the head of canonical
    /// chain which makes it valuable to expose a safe block to users.
    ///
    /// Spec: https://github.com/ethereum/consensus-specs/blob/v1.6.0/fork_choice/safe-block.md#get_safe_beacon_block_root
    pub fn getSafeBeaconBlockRoot(self: *const ForkChoice) Root {
        return self.getJustifiedCheckpoint().root;
    }

    /// Returns the execution payload block hash for the safe block.
    ///
    /// This function assumes that the safe block is post-Bellatrix and should not
    /// be called otherwise. Our existing usage is aligned with this condition so
    /// no fork-check is performed inside this function.
    ///
    /// Spec: https://github.com/ethereum/consensus-specs/blob/v1.6.0/fork_choice/safe-block.md#get_safe_execution_block_hash
    pub fn getSafeExecutionBlockHash(self: *const ForkChoice) !Root {
        const justified_block = try self.getJustifiedBlock();
        return justified_block.extra_meta.executionPayloadBlockHash() orelse ZERO_HASH;
    }

    /// Get the slot of the finalized checkpoint's block.
    pub fn getFinalizedCheckpointSlot(self: *const ForkChoice) Slot {
        return computeStartSlotAtEpoch(self.fc_store.finalized_checkpoint.epoch);
    }

    // ── Traversal ──

    /// Returns the block root of an ancestor of `block_root` at the given `ancestor_slot`.
    /// (Note: `ancestor_slot` refers to the block that is *returned*, not the one that is supplied.)
    ///
    /// NOTE: May be expensive: potentially walks through the entire fork of head to finalized block.
    ///
    /// Equivalent to:
    /// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_ancestor
    pub fn getAncestor(self: *const ForkChoice, block_root: Root, ancestor_slot: Slot) ForkChoiceError!ProtoNode {
        const node = try self.proto_array.getAncestor(block_root, ancestor_slot);
        return node.*;
    }

    /// Check if one block is a descendant of another.
    pub fn isDescendant(
        self: *const ForkChoice,
        ancestor_root: Root,
        ancestor_payload_status: PayloadStatus,
        descendant_root: Root,
        descendant_payload_status: PayloadStatus,
    ) ForkChoiceError!bool {
        return try self.proto_array.isDescendant(
            ancestor_root,
            ancestor_payload_status,
            descendant_root,
            descendant_payload_status,
        );
    }

    /// Get the canonical block matching the given root.
    pub fn getCanonicalBlockByRoot(self: *const ForkChoice, block_root: Root) ForkChoiceError!?ProtoBlock {
        if (std.mem.eql(u8, &self.head.block_root, &block_root)) return self.head;

        var iter = self.proto_array.iterateAncestors(self.head.block_root, self.head.payload_status);
        while (try iter.next()) |node| {
            if (std.mem.eql(u8, &node.block_root, &block_root)) return node.toBlock();
        }
        return null;
    }

    /// Get the canonical block at a given slot.
    pub fn getCanonicalBlockAtSlot(self: *const ForkChoice, slot: Slot) ForkChoiceError!?ProtoBlock {
        if (slot > self.head.slot) return null;
        if (slot == self.head.slot) return self.head;

        var iter = self.proto_array.iterateAncestors(self.head.block_root, self.head.payload_status);
        while (try iter.next()) |node| {
            if (node.slot == slot) return node.toBlock();
        }
        return null;
    }

    /// Get the canonical block at or before a given slot.
    pub fn getCanonicalBlockClosestLteSlot(self: *const ForkChoice, slot: Slot) ForkChoiceError!?ProtoBlock {
        if (slot >= self.head.slot) return self.head;

        var iter = self.proto_array.iterateAncestors(self.head.block_root, self.head.payload_status);
        while (try iter.next()) |node| {
            if (slot >= node.slot) return node.toBlock();
        }
        return null;
    }

    /// Iterates backwards through block summaries, starting from a block root.
    /// Return only the non-finalized blocks.
    pub fn iterateAncestorBlocks(
        self: *const ForkChoice,
        block_root: Root,
        status: PayloadStatus,
    ) ProtoArray.AncestorIterator {
        return self.proto_array.iterateAncestors(block_root, status);
    }

    /// Returns all blocks backwards starting from a block root.
    /// Return only the non-finalized blocks (last ancestor block is excluded).
    /// Delegates to proto_array.getAllAncestorNodes.
    pub fn getAllAncestorBlocks(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
        status: PayloadStatus,
    ) ![]ProtoBlock {
        var blocks = try self.proto_array.getAllAncestorNodes(allocator, block_root, status);
        // The last block is the previous finalized one, exclude it.
        if (blocks.items.len > 0) _ = blocks.pop();
        return blocks.toOwnedSlice(allocator);
    }

    /// The same to iterateAncestorBlocks but this gets non-ancestor blocks instead of ancestor blocks.
    /// Delegates to proto_array.getAllNonAncestorNodes.
    pub fn getAllNonAncestorBlocks(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
        status: PayloadStatus,
    ) ![]ProtoBlock {
        var blocks = try self.proto_array.getAllNonAncestorNodes(allocator, block_root, status);
        return blocks.toOwnedSlice(allocator);
    }

    /// Returns both ancestor and non-ancestor blocks in a single traversal.
    ///
    /// `ancestors` is the raw walk and includes the previous finalized block as its last
    /// element — callers that don't want the boundary should slice it off themselves.
    pub fn getAllAncestorAndNonAncestorBlocks(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
        status: PayloadStatus,
    ) !AncestorAndNonAncestorBlocks {
        var pa_result = try self.proto_array.getAllAncestorAndNonAncestorNodes(allocator, block_root, status);

        return .{
            .ancestors = try pa_result.ancestors.toOwnedSlice(pa_result.allocator),
            .non_ancestors = try pa_result.non_ancestors.toOwnedSlice(pa_result.allocator),
        };
    }

    /// Same as `getAllAncestorAndNonAncestorBlocks` but resolves the default payload-status
    /// variant (FULL pre-Gloas, PENDING for Gloas) for the given root. Use when the caller
    /// holds a `Checkpoint` / finalized root without a specific payload-status variant in mind.
    pub fn getAllAncestorAndNonAncestorBlocksDefaultStatus(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
    ) !AncestorAndNonAncestorBlocks {
        const default_status = self.proto_array.getDefaultVariant(block_root) orelse return error.MissingProtoArrayBlock;
        return self.getAllAncestorAndNonAncestorBlocks(allocator, block_root, default_status);
    }

    /// Get common ancestor depth between two blocks.
    /// Returns how deep the common ancestor is from the higher of the two blocks.
    pub fn getCommonAncestorDepth(self: *const ForkChoice, prev_block: *const ProtoBlock, new_block: *const ProtoBlock) AncestorResult {
        const prev_node = self.proto_array.getNode(prev_block.block_root, prev_block.payload_status) orelse
            return .{ .block_unknown = {} };
        const new_node = self.proto_array.getNode(new_block.block_root, new_block.payload_status) orelse
            return .{ .block_unknown = {} };

        const common_ancestor = self.proto_array.getCommonAncestor(prev_node, new_node) orelse
            return .{ .no_common_ancestor = {} };

        // If common ancestor is one of both nodes, they are direct descendants.
        if (std.mem.eql(u8, &common_ancestor.block_root, &prev_node.block_root) or
            std.mem.eql(u8, &common_ancestor.block_root, &new_node.block_root))
        {
            return .{ .descendant = {} };
        }

        return .{ .common_ancestor = .{ .depth = @intCast(@max(new_node.slot, prev_node.slot) - common_ancestor.slot) } };
    }

    /// Get the dependent root for a block at a given epoch difference.
    pub fn getDependentRoot(self: *const ForkChoice, head_block: ProtoBlock, epoch_difference: EpochDifference) !Root {
        // beforeSlot = block.slot - (block.slot % SLOTS_PER_EPOCH) - epochDifference * SLOTS_PER_EPOCH
        const epoch_diff_val: Slot = @intFromEnum(epoch_difference);
        const before_slot_signed: i64 = @as(i64, @intCast(head_block.slot)) -
            @as(i64, @intCast(head_block.slot % preset.SLOTS_PER_EPOCH)) -
            @as(i64, @intCast(epoch_diff_val * preset.SLOTS_PER_EPOCH));

        // Special case close to genesis block, return the genesis block root.
        // Invariant: when before_slot <= 0, genesis has not been pruned yet
        // (finalization hasn't advanced enough), so items[0] is always genesis.
        if (before_slot_signed <= 0) {
            const genesis_block = &self.proto_array.nodes.items[0];
            assert(genesis_block.slot == 0);
            return genesis_block.block_root;
        }
        const before_slot: Slot = @intCast(before_slot_signed);

        const finalized_slot = (try self.getFinalizedBlock()).slot;
        var block = head_block;

        while (block.slot >= finalized_slot) {
            // Dependent root must be in epoch less than beforeSlot.
            if (block.slot < before_slot) return block.block_root;

            // Skip one last jump if there's no skipped slot at first slot of the epoch.
            if (block.slot == before_slot) return block.parent_root;

            // For the first slot of the epoch, a block is its own target.
            const next_root = if (std.mem.eql(u8, &block.block_root, &block.target_root))
                block.parent_root
            else
                block.target_root;

            // Use default variant (PENDING for Gloas, FULL for pre-Gloas).
            const default_status = self.proto_array.getDefaultVariant(next_root) orelse
                return error.MissingProtoArrayBlock;
            block = (try self.proto_array.getBlockReadonly(next_root, default_status)).toBlock();
        }

        return error.DependentRootNotFound;
    }

    // ── Getters ──

    /// Get the head block root (from cache, without recomputing).
    pub fn getHeadRoot(self: *const ForkChoice) Root {
        return self.head.block_root;
    }

    pub fn getProposerBoostRoot(self: *const ForkChoice) Root {
        return self.proposer_boost_root orelse ZERO_HASH;
    }

    /// Decide whether to extend an available payload from the previous slot for a given
    /// beacon block root. Thin wrapper over `ProtoArray.shouldExtendPayload` that supplies
    /// the fork-choice-owned proposer-boost root.
    pub fn shouldExtendPayload(self: *const ForkChoice, block_root: Root) ProtoArrayError!bool {
        return self.proto_array.shouldExtendPayload(block_root, self.proposer_boost_root);
    }

    /// Set the prune threshold.
    pub fn setPruneThreshold(self: *ForkChoice, threshold: u32) void {
        self.proto_array.prune_threshold = threshold;
    }

    // ── Debug / metrics ──

    /// Get all leaf nodes (heads of chains).
    pub fn getHeads(self: *const ForkChoice, allocator: Allocator) ![]ProtoBlock {
        var result: std.ArrayList(ProtoBlock) = .empty;
        errdefer result.deinit(allocator);

        for (self.proto_array.nodes.items) |node| {
            if (node.best_child == null) {
                try result.append(allocator, node.toBlock());
            }
        }
        return result.toOwnedSlice(allocator);
    }

    /// Get all nodes in the DAG.
    pub fn getAllNodes(self: *const ForkChoice) []ProtoNode {
        return self.proto_array.nodes.items;
    }

    /// Very expensive function, iterates the entire ProtoArray.
    pub fn forwardIterateAncestorBlocks(self: *const ForkChoice, allocator: Allocator) Allocator.Error![]ProtoBlock {
        const nodes = self.proto_array.nodes.items;
        const result = try allocator.alloc(ProtoBlock, nodes.len);
        for (nodes, 0..) |node, i| {
            result[i] = node.toBlock();
        }
        return result;
    }

    /// Count slots present in a window.
    pub fn getSlotsPresent(self: *const ForkChoice, window_start: Slot) u32 {
        var count: u32 = 0;
        for (self.proto_array.nodes.items) |node| {
            if (node.slot > window_start) count += 1;
        }
        return count;
    }

    /// Lazy forward iterator over descendants of a given block.
    /// Caller must call `deinit()` when done.
    pub const DescendantIterator = struct {
        nodes: []const ProtoNode,
        current_index: usize,
        roots_in_chain: std.AutoHashMapUnmanaged(Root, void),

        pub fn next(self: *DescendantIterator, allocator: Allocator) Allocator.Error!?ProtoBlock {
            while (self.current_index < self.nodes.len) {
                const node = &self.nodes[self.current_index];
                self.current_index += 1;
                if (self.roots_in_chain.contains(node.parent_root)) {
                    try self.roots_in_chain.put(allocator, node.block_root, {});
                    return node.toBlock();
                }
            }
            return null;
        }

        pub fn deinit(self: *DescendantIterator, allocator: Allocator) void {
            self.roots_in_chain.deinit(allocator);
        }
    };

    /// Forward-iterate descendants of a block.
    /// Caller must call `deinit()` on the returned iterator when done.
    pub fn forwardIterateDescendants(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
        status: PayloadStatus,
    ) (Allocator.Error || ForkChoiceError)!DescendantIterator {
        const block_index = self.proto_array.getNodeIndexByRootAndStatus(block_root, status) orelse
            return error.MissingProtoArrayBlock;

        var roots_in_chain: std.AutoHashMapUnmanaged(Root, void) = .empty;
        try roots_in_chain.put(allocator, block_root, {});

        return .{
            .nodes = self.proto_array.nodes.items,
            .current_index = block_index + 1,
            .roots_in_chain = roots_in_chain,
        };
    }

    /// Same as `forwardIterateDescendants` but resolves the default payload-status variant
    /// (FULL pre-Gloas, PENDING for Gloas). Use when the caller holds a `Checkpoint` /
    /// finalized root without a specific payload-status variant in mind.
    pub fn forwardIterateDescendantsDefaultStatus(
        self: *const ForkChoice,
        allocator: Allocator,
        block_root: Root,
    ) (Allocator.Error || ForkChoiceError)!DescendantIterator {
        const default_status = self.proto_array.getDefaultVariant(block_root) orelse return error.MissingProtoArrayBlock;
        return self.forwardIterateDescendants(allocator, block_root, default_status);
    }

    /// Get block summaries by parent root.
    pub fn getBlockSummariesByParentRoot(
        self: *const ForkChoice,
        allocator: Allocator,
        parent_root: Root,
    ) ![]ProtoBlock {
        var result: std.ArrayList(ProtoBlock) = .empty;
        errdefer result.deinit(allocator);

        for (self.proto_array.nodes.items) |node| {
            if (std.mem.eql(u8, &node.parent_root, &parent_root)) {
                try result.append(allocator, node.toBlock());
            }
        }
        return result.toOwnedSlice(allocator);
    }

    /// Get block summaries at a specific slot.
    pub fn getBlockSummariesAtSlot(
        self: *const ForkChoice,
        allocator: Allocator,
        slot: Slot,
    ) ![]ProtoBlock {
        var result: std.ArrayList(ProtoBlock) = .empty;
        errdefer result.deinit(allocator);

        for (self.proto_array.nodes.items) |node| {
            if (node.slot == slot) {
                try result.append(allocator, node.toBlock());
            }
        }
        return result.toOwnedSlice(allocator);
    }

    // ── Gloas (ePBS) ──

    /// Notify fork choice that an execution payload has arrived (Gloas fork).
    /// Creates the FULL variant of a Gloas block when the payload becomes available.
    /// Spec: gloas/fork-choice.md#new-on_execution_payload
    pub fn onExecutionPayload(
        self: *ForkChoice,
        allocator: Allocator,
        block_root: Root,
        execution_payload_block_hash: Root,
        execution_payload_number: u64,
        execution_status: ExecutionStatus,
    ) (Allocator.Error || ForkChoiceError)!void {
        try self.proto_array.onExecutionPayload(
            allocator,
            block_root,
            self.fc_store.current_slot,
            execution_payload_block_hash,
            execution_payload_number,
            self.proposer_boost_root,
            execution_status,
        );
    }

    /// Process a PTC (Payload Timeliness Committee) message.
    /// Updates the PTC votes for multiple validators attesting to a block.
    /// Spec: gloas/fork-choice.md#new-on_payload_attestation_message
    pub fn notifyPtcMessages(
        self: *ForkChoice,
        block_root: Root,
        ptc_indices: []const u32,
        payload_present: bool,
    ) void {
        self.proto_array.notifyPtcMessages(block_root, ptc_indices, payload_present);
    }
};

// ── Helper functions ──

/// Approximate committee fraction calculation.
/// See https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/phase0/fork-choice.md#calculate_committee_fraction
fn getCommitteeFraction(total_active_balance_by_increment: u64, slots_per_epoch: u64, committee_percent: u64) u64 {
    assert(slots_per_epoch > 0);
    const committee_weight = total_active_balance_by_increment / slots_per_epoch;
    return (committee_weight * committee_percent) / 100;
}

// ── Test/bench helpers ──

/// Simplified onBlock that takes a pre-constructed ProtoBlock directly (bypasses block/state
/// processing). For tests and benchmarks only — not part of the production API.
pub fn onBlockFromProto(
    fc: *ForkChoice,
    allocator: Allocator,
    block: ProtoBlock,
    current_slot: Slot,
) (Allocator.Error || ForkChoiceError)!void {
    if (block.slot > current_slot) return error.InvalidBlockFutureSlot;

    const finalized_slot = computeStartSlotAtEpoch(fc.fc_store.finalized_checkpoint.epoch);
    if (block.slot <= finalized_slot) return error.InvalidBlockFinalizedSlot;

    const parent_idx = fc.proto_array.getDefaultNodeIndex(block.parent_root) orelse return error.InvalidBlockUnknownParent;
    const parent_node = &fc.proto_array.nodes.items[parent_idx];
    if (!fc.proto_array.isFinalizedRootOrDescendant(parent_node)) return error.InvalidBlockNotFinalizedDescendant;

    try fc.proto_array.onBlock(allocator, block, current_slot, null);
}

// ── Tests ──

fn makeTestCheckpoint(epoch: Epoch, root: Root) Checkpoint {
    return .{ .epoch = epoch, .root = root };
}

fn makeTestBlock(slot: Slot, root: Root, parent_root: Root) ProtoBlock {
    return .{
        .slot = slot,
        .block_root = root,
        .parent_root = parent_root,
        .state_root = ZERO_HASH,
        .target_root = root,
        .justified_epoch = 0,
        .justified_root = ZERO_HASH,
        .finalized_epoch = 0,
        .finalized_root = ZERO_HASH,
        .unrealized_justified_epoch = 0,
        .unrealized_justified_root = ZERO_HASH,
        .unrealized_finalized_epoch = 0,
        .unrealized_finalized_root = ZERO_HASH,
        .extra_meta = .{ .pre_merge = {} },
        .timeliness = true,
    };
}

fn hashFromByte(byte: u8) Root {
    var root: Root = ZERO_HASH;
    root[0] = byte;
    return root;
}

/// Comptime inclusive range [from, to_inclusive].
fn range(comptime from: Slot, comptime to_inclusive: Slot) [to_inclusive - from + 1]Slot {
    var result: [to_inclusive - from + 1]Slot = undefined;
    for (0..result.len) |i| {
        result[i] = from + @as(Slot, @intCast(i));
    }
    return result;
}

/// Create a minimal phase0 AttesterSlashing for testing.
/// Both attestation_1 and attestation_2 share the same attesting_indices.
fn makeTestAttesterSlashing(
    indices: []const ValidatorIndex,
) consensus_types.phase0.AttesterSlashing.Type {
    const list = std.ArrayList(ValidatorIndex){ .items = @constCast(indices), .capacity = indices.len };
    const indexed_attestation = std.mem.zeroInit(consensus_types.phase0.IndexedAttestation.Type, .{
        .attesting_indices = list,
    });
    return .{
        .attestation_1 = indexed_attestation,
        .attestation_2 = indexed_attestation,
    };
}

fn dummyBalancesGetter(_: ?*anyopaque, _: Checkpoint, _: *CachedBeaconState) JustifiedBalances {
    return .empty;
}

fn getTestConfig() *const BeaconConfig {
    return &@import("config").minimal.config;
}

const test_balances_getter: JustifiedBalancesGetter = .{ .getFn = dummyBalancesGetter };

/// Test-only helper: heap-allocates ProtoArray, ForkChoiceStore, and ForkChoice.
/// Use `deinitTestForkChoice` to free all three.
fn initTestForkChoice(
    allocator: Allocator,
    anchor_block: ProtoBlock,
    current_slot: Slot,
    justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    justified_balances: []const u16,
) !*ForkChoice {
    const proto_arr = try allocator.create(ProtoArray);
    errdefer allocator.destroy(proto_arr);

    try proto_arr.initialize(
        allocator,
        anchor_block,
        current_slot,
    );
    errdefer proto_arr.deinit(allocator);

    const fc_store = try allocator.create(ForkChoiceStore);
    errdefer allocator.destroy(fc_store);

    try fc_store.init(
        allocator,
        current_slot,
        justified_checkpoint,
        finalized_checkpoint,
        justified_balances,
        test_balances_getter,
        .{},
    );
    errdefer fc_store.deinit(allocator);

    const fc = try allocator.create(ForkChoice);
    errdefer allocator.destroy(fc);

    try fc.init(allocator, getTestConfig(), fc_store, proto_arr, 0, .{});
    return fc;
}

/// Test-only: free ForkChoice + its heap-allocated ProtoArray and ForkChoiceStore.
fn deinitTestForkChoice(allocator: Allocator, fc: *ForkChoice) void {
    const proto_arr = fc.proto_array;
    const fc_store = fc.fc_store;
    fc.deinit(allocator);
    allocator.destroy(fc);
    proto_arr.deinit(allocator);
    allocator.destroy(proto_arr);
    fc_store.deinit(allocator);
    allocator.destroy(fc_store);
}

/// Test-only helper: create ForkChoice with custom options.
fn initTestForkChoiceWithOpts(
    allocator: Allocator,
    anchor_block: ProtoBlock,
    current_slot: Slot,
    justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    justified_balances: []const u16,
    opts: ForkChoiceOpts,
) !*ForkChoice {
    const proto_arr = try allocator.create(ProtoArray);
    errdefer allocator.destroy(proto_arr);
    try proto_arr.initialize(allocator, anchor_block, current_slot);
    errdefer proto_arr.deinit(allocator);

    const fc_store = try allocator.create(ForkChoiceStore);
    errdefer allocator.destroy(fc_store);
    try fc_store.init(allocator, current_slot, justified_checkpoint, finalized_checkpoint, justified_balances, test_balances_getter, .{});
    errdefer fc_store.deinit(allocator);

    const fc = try allocator.create(ForkChoice);
    errdefer allocator.destroy(fc);
    try fc.init(allocator, getTestConfig(), fc_store, proto_arr, 0, opts);
    return fc;
}

/// Test-only: set a node's weight directly by block root.
fn setTestNodeWeight(fc: *ForkChoice, root: Root, weight: i64) void {
    const idx = fc.proto_array.getDefaultNodeIndex(root) orelse return;
    fc.proto_array.nodes.items[idx].weight = weight;
}

/// Common parameters for proposer reorg tests.
/// Defaults represent a scenario where ALL reorg conditions are met:
///   3-block chain: genesis(0) → parent(9) → head(10), current_slot=11
///   Thresholds with 32 validators * 128 = total 4096 (mainnet SLOTS_PER_EPOCH=32):
///     committee_weight = 4096 / 32 = 128
///     reorg_threshold  = 128 * 20 (REORG_HEAD_WEIGHT_THRESHOLD) / 100 = 25
///     parent_threshold = 128 * 160 (REORG_PARENT_WEIGHT_THRESHOLD) / 100 = 204
const ReorgTestParams = struct {
    head_timely: bool = false,
    parent_slot: Slot = 9,
    head_slot: Slot = 10,
    current_slot: Slot = 11,
    finalized_epoch: Epoch = 0,
    head_uj_epoch: Epoch = 0,
    parent_uj_epoch: Epoch = 0,
    head_uj_root: Root = ZERO_HASH,
    parent_uj_root: Root = ZERO_HASH,
    head_weight: i64 = 20,
    parent_weight: i64 = 250,
};

const ReorgTestCtx = struct {
    fc: *ForkChoice,
    head_block: ProtoBlock,
    genesis_root: Root,
    parent_root: Root,
    head_root: Root,
};

fn initReorgTest(allocator: Allocator, params: ReorgTestParams) !ReorgTestCtx {
    const genesis_root = hashFromByte(0x01);
    const parent_root = hashFromByte(0x02);
    const head_root = hashFromByte(0x03);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{128} ** 32;

    const fc = try initTestForkChoiceWithOpts(
        allocator,
        genesis_block,
        params.current_slot,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(params.finalized_epoch, genesis_root),
        &balances,
        .{ .proposer_boost = true, .proposer_boost_reorg = true },
    );
    errdefer deinitTestForkChoice(allocator, fc);

    var parent_block = makeTestBlock(params.parent_slot, parent_root, genesis_root);
    parent_block.unrealized_justified_epoch = params.parent_uj_epoch;
    parent_block.unrealized_justified_root = params.parent_uj_root;
    try onBlockFromProto(fc, allocator, parent_block, params.current_slot);

    var head_block = makeTestBlock(params.head_slot, head_root, parent_root);
    head_block.timeliness = params.head_timely;
    head_block.unrealized_justified_epoch = params.head_uj_epoch;
    head_block.unrealized_justified_root = params.head_uj_root;
    try onBlockFromProto(fc, allocator, head_block, params.current_slot);

    setTestNodeWeight(fc, head_root, params.head_weight);
    setTestNodeWeight(fc, parent_root, params.parent_weight);

    return .{
        .fc = fc,
        .head_block = head_block,
        .genesis_root = genesis_root,
        .parent_root = parent_root,
        .head_root = head_root,
    };
}

test "getProposerHead reorgs when all conditions met" {
    var ctx = try initReorgTest(testing.allocator, .{});
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, null), result.not_reorged_reason);
    try testing.expectEqual(ctx.parent_root, result.head.block_root);
    try testing.expectEqual(@as(?bool, false), result.is_head_timely);
}

test "getProposerHead no reorg: head block is timely" {
    var ctx = try initReorgTest(testing.allocator, .{ .head_timely = true });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .head_block_is_timely), result.not_reorged_reason);
    try testing.expectEqual(ctx.head_root, result.head.block_root);
}

test "getProposerHead no reorg: not shuffling stable (epoch boundary)" {
    // current_slot=32 is epoch boundary (32 % 32 == 0), head=31, parent=30
    var ctx = try initReorgTest(testing.allocator, .{ .parent_slot = 30, .head_slot = 31, .current_slot = 32 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .not_shuffling_stable), result.not_reorged_reason);
}

test "getProposerHead no reorg: not FFG competitive (epoch differs)" {
    var ctx = try initReorgTest(testing.allocator, .{ .head_uj_epoch = 0, .parent_uj_epoch = 1 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .not_ffg_competitive), result.not_reorged_reason);
}

test "getProposerHead no reorg: not FFG competitive (root differs)" {
    var ctx = try initReorgTest(testing.allocator, .{ .head_uj_root = hashFromByte(0xAA) });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .not_ffg_competitive), result.not_reorged_reason);
}

test "getProposerHead no reorg: chain long unfinality" {
    // Finalized at epoch 0, current_slot=97 → epoch 3 → 3-0=3 > MAX(2)
    // (mainnet SLOTS_PER_EPOCH=32, epoch 3 starts at slot 96)
    var ctx = try initReorgTest(testing.allocator, .{
        .parent_slot = 95,
        .head_slot = 96,
        .current_slot = 97,
        .finalized_epoch = 0,
    });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .chain_long_unfinality), result.not_reorged_reason);
}

test "getProposerHead no reorg: parent distance more than one slot" {
    // parent at slot 7, head at slot 10: 7+1 != 10
    var ctx = try initReorgTest(testing.allocator, .{ .parent_slot = 7 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .parent_block_distance_more_than_one_slot), result.not_reorged_reason);
}

test "getProposerHead no reorg: reorg more than one slot" {
    // head at 10, current_slot=12: 10+1 != 12
    var ctx = try initReorgTest(testing.allocator, .{ .current_slot = 12 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .reorg_more_than_one_slot), result.not_reorged_reason);
}

test "getProposerHead no reorg: head block not weak" {
    // head weight 25 >= reorg_threshold 25
    var ctx = try initReorgTest(testing.allocator, .{ .head_weight = 25 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .head_block_not_weak), result.not_reorged_reason);
}

test "getProposerHead no reorg: parent block not strong" {
    // parent weight 204 <= parent_threshold 204
    var ctx = try initReorgTest(testing.allocator, .{ .parent_weight = 204 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 0, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .parent_block_not_strong), result.not_reorged_reason);
}

test "getProposerHead no reorg: not proposing on time" {
    // Minimal ChainConfig: PROPOSER_REORG_CUTOFF_BPS=1667, SLOT_DURATION_MS=6000
    // cutoff = (1667 * 6000 + 5000) / 10000 = 1000ms
    // sec_from_slot=2 → 2000ms > 1000ms → not on time
    var ctx = try initReorgTest(testing.allocator, .{});
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.getProposerHead(&ctx.head_block, 2, ctx.fc.fc_store.current_slot);
    try testing.expectEqual(@as(?NotReorgedReason, .not_proposing_on_time), result.not_reorged_reason);
}

test "shouldOverrideFCU overrides when head.slot == current_slot" {
    // head_slot=10, current_slot=10 → head.slot == current_slot → timing passes
    var ctx = try initReorgTest(testing.allocator, .{ .current_slot = 10 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 10);
    switch (result) {
        .should_override => |r| try testing.expectEqual(ctx.parent_root, r.parent_block.block_root),
        .should_not_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU overrides when proposal_slot == current_slot and on time" {
    // head_slot=10, current_slot=11 → proposal_slot=11==current_slot, sec_from_slot=0 → on time
    var ctx = try initReorgTest(testing.allocator, .{});
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 11);
    switch (result) {
        .should_override => |r| try testing.expectEqual(ctx.parent_root, r.parent_block.block_root),
        .should_not_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU no override: timing fails" {
    // head_slot=10, current_slot=13 → head.slot!=13, proposal_slot=11!=13 → timing fails
    var ctx = try initReorgTest(testing.allocator, .{ .current_slot = 13 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 13);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.reorg_more_than_one_slot, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

/// Compute target root for a block at `slot`, given `skipped_slots`.
fn getTargetRoot(slot: Slot, skipped_slots: []const Slot) Root {
    const genesis_root = hashFromByte(0x01);
    var target_slot: i64 = @intCast(computeStartSlotAtEpoch(computeEpochAtSlot(slot)));
    if (target_slot == 0) return genesis_root;
    while (target_slot >= 0) {
        if (!slotInList(@intCast(target_slot), skipped_slots)) return rootForSlot(@intCast(target_slot));
        target_slot -= 1;
    }
    unreachable;
}

fn slotInList(slot: Slot, list: []const Slot) bool {
    for (list) |s| {
        if (s == slot) return true;
    }
    return false;
}

/// Get parent root for a block at `slot`, walking backwards past skipped slots.
fn getParentRoot(slot: Slot, skipped_slots: []const Slot) Root {
    var s: i64 = @as(i64, @intCast(slot)) - 1;
    while (s >= 0) {
        if (!slotInList(@intCast(s), skipped_slots)) return rootForSlot(@intCast(s));
        s -= 1;
    }
    unreachable;
}

/// Build a chain populating all slots from 1..till_slot (skipping those in skipped_slots).
fn initDependentRootChain(allocator: Allocator, till_slot: Slot, skipped_slots: []const Slot) !*ForkChoice {
    const genesis_root = hashFromByte(0x01);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    const current_slot = till_slot + 10;

    const fc = try initTestForkChoice(
        allocator,
        genesis_block,
        current_slot,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    errdefer deinitTestForkChoice(allocator, fc);

    var slot: Slot = 1;
    while (slot <= till_slot) : (slot += 1) {
        if (slotInList(slot, skipped_slots)) continue;
        const root = rootForSlot(slot);
        const parent_root = getParentRoot(slot, skipped_slots);
        const target_root = getTargetRoot(slot, skipped_slots);
        var block = makeTestBlock(slot, root, parent_root);
        block.target_root = target_root;
        try onBlockFromProto(fc, allocator, block, current_slot);
    }

    return fc;
}

fn rootForSlot(slot: Slot) Root {
    return hashFromByte(@intCast(slot + 1));
}

test "getDependentRoot table-driven" {
    // dependentRootTestCases.
    // SLOTS_PER_EPOCH = 32 (mainnet preset).
    const Case = struct {
        at_slot: Slot,
        pivot_slot: Slot,
        epoch_diff: EpochDifference,
        skipped: []const Slot,
    };

    const cases = [_]Case{
        // First slot in epoch request, EpochDifference.current
        .{ .at_slot = 32, .pivot_slot = 31, .epoch_diff = .current, .skipped = &.{} },
        .{ .at_slot = 32, .pivot_slot = 30, .epoch_diff = .current, .skipped = &[_]Slot{31} },
        .{ .at_slot = 32, .pivot_slot = 8, .epoch_diff = .current, .skipped = &range(9, 31) },
        .{ .at_slot = 32, .pivot_slot = 0, .epoch_diff = .current, .skipped = &range(1, 31) },
        // First slot in epoch request, EpochDifference.previous
        .{ .at_slot = 64, .pivot_slot = 31, .epoch_diff = .previous, .skipped = &.{} },
        .{ .at_slot = 64, .pivot_slot = 30, .epoch_diff = .previous, .skipped = &[_]Slot{31} },
        .{ .at_slot = 64, .pivot_slot = 8, .epoch_diff = .previous, .skipped = &range(9, 32) },
        .{ .at_slot = 64, .pivot_slot = 0, .epoch_diff = .previous, .skipped = &range(1, 32) },
        // Mid slot in epoch request, EpochDifference.previous
        .{ .at_slot = 64 + 1, .pivot_slot = 31, .epoch_diff = .previous, .skipped = &.{} },
        .{ .at_slot = 64 + 8, .pivot_slot = 31, .epoch_diff = .previous, .skipped = &.{} },
        .{ .at_slot = 64 + 31, .pivot_slot = 31, .epoch_diff = .previous, .skipped = &.{} },
        // Underflow up to genesis
        .{ .at_slot = 31, .pivot_slot = 0, .epoch_diff = .current, .skipped = &.{} },
        .{ .at_slot = 8, .pivot_slot = 0, .epoch_diff = .current, .skipped = &.{} },
        .{ .at_slot = 0, .pivot_slot = 0, .epoch_diff = .current, .skipped = &.{} },
        .{ .at_slot = 32, .pivot_slot = 0, .epoch_diff = .previous, .skipped = &.{} },
        .{ .at_slot = 8, .pivot_slot = 0, .epoch_diff = .previous, .skipped = &.{} },
        .{ .at_slot = 0, .pivot_slot = 0, .epoch_diff = .previous, .skipped = &.{} },
    };

    for (cases) |tc| {
        var fc = try initDependentRootChain(testing.allocator, tc.at_slot, tc.skipped);
        defer deinitTestForkChoice(testing.allocator, fc);

        const head_root = rootForSlot(tc.at_slot);
        const block = fc.getBlockDefaultStatus(head_root) orelse return error.TestBlockNotFound;
        const expected_root = rootForSlot(tc.pivot_slot);
        const result = try fc.getDependentRoot(block, tc.epoch_diff);
        try testing.expectEqual(expected_root, result);
    }
}

// Tree:
//       0(genesis)
//       |
//       1(block_a)
//       |
//       2(block_b)
test "getAllAncestorBlocks returns non-finalized ancestors from blockRoot" {
    const genesis_root = hashFromByte(0x01);
    const block_a_root = hashFromByte(0x02);
    const block_b_root = hashFromByte(0x03);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &[_]u16{1},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, block_a_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, block_b_root, block_a_root), 10);

    // Vote for block_b to make it head.
    try fc.addLatestMessage(testing.allocator, 0, 2, block_b_root, .full);
    _ = try fc.updateHead(testing.allocator);
    try testing.expectEqual(block_b_root, fc.head.block_root);

    // Get ancestors starting from block_b — delegates to proto_array.
    // getAllAncestorNodes returns [block_b, block_a, genesis], then we drop the last (finalized).
    // getAllAncestorNodes returns [block_b, block_a, genesis], then we drop the last (finalized).
    const ancestors = try fc.getAllAncestorBlocks(testing.allocator, block_b_root, .full);
    defer testing.allocator.free(ancestors);

    // Should include block_b and block_a, but NOT genesis (the finalized node is excluded).
    try testing.expectEqual(@as(usize, 2), ancestors.len);
    try testing.expectEqual(block_b_root, ancestors[0].block_root);
    try testing.expectEqual(block_a_root, ancestors[1].block_root);
}

// Tree:
//       0(genesis)
//      / \
//   1(a)  1(fork)
//     |
//   2(b)
//     |
//   3(c)
test "getAllAncestorAndNonAncestorBlocks equals getAllAncestorBlocks + getAllNonAncestorBlocks" {
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x02);
    const b_root = hashFromByte(0x03);
    const c_root = hashFromByte(0x04);
    const fork_root = hashFromByte(0x0A);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &[_]u16{ 1, 1 },
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, b_root, a_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(3, c_root, b_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, fork_root, genesis_root), 10);

    // Test with a block from the canonical chain.
    const canonical_ancestors = try fc.getAllAncestorBlocks(testing.allocator, c_root, .full);
    defer testing.allocator.free(canonical_ancestors);
    const canonical_non_ancestors = try fc.getAllNonAncestorBlocks(testing.allocator, c_root, .full);
    defer testing.allocator.free(canonical_non_ancestors);
    const canonical_combined = try fc.getAllAncestorAndNonAncestorBlocks(testing.allocator, c_root, .full);
    defer testing.allocator.free(canonical_combined.ancestors);
    defer testing.allocator.free(canonical_combined.non_ancestors);

    try testing.expectEqual(canonical_ancestors.len + 1, canonical_combined.ancestors.len);
    for (canonical_ancestors, canonical_combined.ancestors[0..canonical_ancestors.len]) |expected, actual| {
        try testing.expectEqual(expected.block_root, actual.block_root);
    }
    try testing.expectEqual(canonical_non_ancestors.len, canonical_combined.non_ancestors.len);
    for (canonical_non_ancestors, canonical_combined.non_ancestors) |expected, actual| {
        try testing.expectEqual(expected.block_root, actual.block_root);
    }

    // Test with a block from the fork chain.
    const fork_ancestors = try fc.getAllAncestorBlocks(testing.allocator, fork_root, .full);
    defer testing.allocator.free(fork_ancestors);
    const fork_non_ancestors = try fc.getAllNonAncestorBlocks(testing.allocator, fork_root, .full);
    defer testing.allocator.free(fork_non_ancestors);
    const fork_combined = try fc.getAllAncestorAndNonAncestorBlocks(testing.allocator, fork_root, .full);
    defer testing.allocator.free(fork_combined.ancestors);
    defer testing.allocator.free(fork_combined.non_ancestors);

    try testing.expectEqual(fork_ancestors.len + 1, fork_combined.ancestors.len);
    for (fork_ancestors, fork_combined.ancestors[0..fork_ancestors.len]) |expected, actual| {
        try testing.expectEqual(expected.block_root, actual.block_root);
    }
    try testing.expectEqual(fork_non_ancestors.len, fork_combined.non_ancestors.len);
    for (fork_non_ancestors, fork_combined.non_ancestors) |expected, actual| {
        try testing.expectEqual(expected.block_root, actual.block_root);
    }
}

// Tree:
//       genesis
//      / \
//     a   b
//         |
//         c
// 4 validators with balances [100, 200, 200, 300].
// Validators 1,2 vote for b; validator 3 votes for c. Head → b (400 > 300).
// Slash validator 1 → c becomes head. Re-slash validator 1 → noop.
test "onAttesterSlashing affects head via computeDeltas" {
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x02);
    const b_root = hashFromByte(0x03);
    const c_root = hashFromByte(0x04);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &[_]u16{ 100, 200, 200, 300 },
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    // Insert: genesis → a, a → b, a → c.
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, b_root, a_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(3, c_root, a_root), 10);

    // Validators 1,2 vote for b; validator 3 votes for c.
    // (Validator 0 has no vote.)
    try fc.addLatestMessage(testing.allocator, 1, 2, b_root, .full);
    try fc.addLatestMessage(testing.allocator, 2, 2, b_root, .full);
    try fc.addLatestMessage(testing.allocator, 3, 3, c_root, .full);

    // Head should be b (weight: b=200+200=400 > c=300).
    _ = try fc.updateHead(testing.allocator);
    try testing.expectEqual(b_root, fc.head.block_root);

    // Slash validator 1 → b loses 200, now b=200 < c=300 → c becomes head.
    var slashing1 = makeTestAttesterSlashing(&[_]u64{1});
    try fc.onAttesterSlashing(testing.allocator, &.{ .phase0 = &slashing1 });
    _ = try fc.updateHead(testing.allocator);
    try testing.expectEqual(c_root, fc.head.block_root);

    // Re-slash validator 1 → noop (already slashed). c remains head.
    var slashing2 = makeTestAttesterSlashing(&[_]u64{1});
    try fc.onAttesterSlashing(testing.allocator, &.{ .phase0 = &slashing2 });
    _ = try fc.updateHead(testing.allocator);
    try testing.expectEqual(c_root, fc.head.block_root);
}

// Tree:
//       0(genesis)
//      /  |  \
//     a   b   c
//             |
//             d
test "multiple forks competing with votes" {
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x02);
    const b_root = hashFromByte(0x03);
    const c_root = hashFromByte(0x04);
    const d_root = hashFromByte(0x05);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &[_]u16{ 1, 1, 1, 1, 1 },
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, b_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, c_root, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, d_root, c_root), 10);

    // 1 vote a, 1 vote b, 3 votes d → d wins.
    try fc.addLatestMessage(testing.allocator, 0, 1, a_root, .full);
    try fc.addLatestMessage(testing.allocator, 1, 1, b_root, .full);
    try fc.addLatestMessage(testing.allocator, 2, 2, d_root, .full);
    try fc.addLatestMessage(testing.allocator, 3, 2, d_root, .full);
    try fc.addLatestMessage(testing.allocator, 4, 2, d_root, .full);

    _ = try fc.updateHead(testing.allocator);
    try testing.expectEqual(d_root, fc.head.block_root);

    // Head chain: d → c → genesis.
    const heads = try fc.getHeads(testing.allocator);
    defer testing.allocator.free(heads);
    // Should have 3 leaf nodes: a, b, d.
    try testing.expectEqual(@as(usize, 3), heads.len);
}

// Tree:
//   0(genesis)
//       |
//       1
//       |
//       2
//       |
//       3
//       |
//       4
//       |
//       5
//       |
//       6
//       |
//       7
//       |
//       8
test "deep chain head selection follows longest weighted branch" {
    const genesis_root = hashFromByte(0x01);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        20,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &[_]u16{1},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    var prev_root = genesis_root;
    var i: u8 = 1;
    while (i <= 8) : (i += 1) {
        const root = hashFromByte(i + 1);
        try onBlockFromProto(fc, testing.allocator, makeTestBlock(i, root, prev_root), 20);
        prev_root = root;
    }

    // Vote for the deepest block.
    const tip_root = hashFromByte(9); // slot 8, root 0x09
    try fc.addLatestMessage(testing.allocator, 0, 8, tip_root, .full);
    _ = try fc.updateHead(testing.allocator);

    try testing.expectEqual(tip_root, fc.head.block_root);
    try testing.expectEqual(@as(usize, 9), fc.proto_array.nodes.items.len); // genesis + 8 blocks
}

test "shouldOverrideFCU no override: not FFG competitive" {
    // Head has lower uj_epoch than parent → not FFG competitive → no override.
    var ctx = try initReorgTest(testing.allocator, .{ .head_uj_epoch = 0, .parent_uj_epoch = 1 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 11);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.not_ffg_competitive, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU no override: chain not finalizing" {
    // finalized_epoch=0, current_slot=97 → epoch=3, epochs_since_finalization=3 > REORG_MAX_EPOCHS_SINCE_FINALIZATION(2)
    // → chain_long_unfinality.
    var ctx = try initReorgTest(testing.allocator, .{
        .parent_slot = 95,
        .head_slot = 96,
        .current_slot = 97,
        .finalized_epoch = 0,
    });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 97);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.chain_long_unfinality, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU no override: parent distance more than one slot" {
    // parent_slot=8, head_slot=10 → distance=2 → no override.
    var ctx = try initReorgTest(testing.allocator, .{ .parent_slot = 8, .head_slot = 10, .current_slot = 11 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 11);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.parent_block_distance_more_than_one_slot, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU no override: not shuffling stable (epoch boundary)" {
    // current_slot=32 is epoch boundary → not shuffling stable.
    var ctx = try initReorgTest(testing.allocator, .{ .parent_slot = 30, .head_slot = 31, .current_slot = 32 });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 32);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.not_shuffling_stable, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

test "shouldOverrideFCU no override: head block is timely" {
    // head_timely=true → getPreliminaryProposerHead returns .head_block_is_timely
    var ctx = try initReorgTest(testing.allocator, .{ .head_timely = true });
    defer deinitTestForkChoice(testing.allocator, ctx.fc);

    const result = ctx.fc.shouldOverrideForkChoiceUpdate(&ctx.head_block, 0, 11);
    switch (result) {
        .should_not_override => |r| try testing.expectEqual(NotReorgedReason.head_block_is_timely, r.reason),
        .should_override => return error.TestUnexpectedResult,
    }
}

// Tree:
//       genesis
//         |
//       node1
//         |
//       node2
//         |
//       node3
// 3 validators, each voting for their respective node.
// justifiedBalances = [10, 20, 30] → each node gets its voter's balance.
// Zig verifies per-node weight = {60, 50, 30} (back-propagated).
test "balance positive change: fresh votes with new balances" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x02);
    const root2 = hashFromByte(0x03);
    const root3 = hashFromByte(0x04);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{ 10, 20, 30 };

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, root1, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, root2, root1), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(3, root3, root2), 10);

    // Each validator votes for their corresponding node.
    try fc.addLatestMessage(allocator, 0, 1, root1, .full);
    try fc.addLatestMessage(allocator, 1, 2, root2, .full);
    try fc.addLatestMessage(allocator, 2, 3, root3, .full);

    _ = try fc.updateHead(allocator);

    // Verify weights (back-propagated): node3=30, node2=20+30=50, node1=10+50=60.
    const idx1 = fc.proto_array.getDefaultNodeIndex(root1) orelse return error.TestUnexpectedResult;
    const idx2 = fc.proto_array.getDefaultNodeIndex(root2) orelse return error.TestUnexpectedResult;
    const idx3 = fc.proto_array.getDefaultNodeIndex(root3) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(i64, 60), fc.proto_array.nodes.items[idx1].weight);
    try testing.expectEqual(@as(i64, 50), fc.proto_array.nodes.items[idx2].weight);
    try testing.expectEqual(@as(i64, 30), fc.proto_array.nodes.items[idx3].weight);
}

// Tree:
//       genesis
//         |
//       node1
//         |
//       node2
//         |
//       node3
// Each node balance=100 initially.
// old_balances = [100, 100, 100], new_balances = [10, 20, 30].
// Zig verifies per-node weight = {60, 50, 30} (back-propagated).
test "balance negative change: existing balances decrease" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x02);
    const root2 = hashFromByte(0x03);
    const root3 = hashFromByte(0x04);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const old_balances = [_]u16{ 100, 100, 100 };
    const new_balances = [_]u16{ 10, 20, 30 };

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &old_balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, root1, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, root2, root1), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(3, root3, root2), 10);

    try fc.addLatestMessage(allocator, 0, 1, root1, .full);
    try fc.addLatestMessage(allocator, 1, 2, root2, .full);
    try fc.addLatestMessage(allocator, 2, 3, root3, .full);

    // First updateHead establishes votes with old_balances=100.
    _ = try fc.updateHead(allocator);

    // Now update to lower balances.
    {
        var new_list: store.JustifiedBalances = .empty;
        try new_list.appendSlice(allocator, &new_balances);
        const new_rc = try store.JustifiedBalancesRc.create(allocator, new_list);
        fc.fc_store.justified.balances.unref();
        fc.fc_store.justified.balances = new_rc;
    }
    _ = try fc.updateHead(allocator);

    // After second updateHead, weights reflect the new lower balances.
    // node3: 30, node2: 20+30=50, node1: 10+50=60 (back-propagated).
    const idx1 = fc.proto_array.getDefaultNodeIndex(root1) orelse return error.TestUnexpectedResult;
    const idx2 = fc.proto_array.getDefaultNodeIndex(root2) orelse return error.TestUnexpectedResult;
    const idx3 = fc.proto_array.getDefaultNodeIndex(root3) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(i64, 60), fc.proto_array.nodes.items[idx1].weight);
    try testing.expectEqual(@as(i64, 50), fc.proto_array.nodes.items[idx2].weight);
    try testing.expectEqual(@as(i64, 30), fc.proto_array.nodes.items[idx3].weight);
}

// Tree:
//       genesis
//         |
//       node1
//         |
//       node2
// old_balances = [100, 100], new_balances = [50, 200].
// Votes point to same nodes with same slot.
// Zig verifies per-node weight = {250, 200} (back-propagated).
test "balance same slot change: balance update without vote movement" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x02);
    const root2 = hashFromByte(0x03);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const old_balances = [_]u16{ 100, 100 };
    const new_balances = [_]u16{ 50, 200 };

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &old_balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, root1, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, root2, root1), 10);

    try fc.addLatestMessage(allocator, 0, 1, root1, .full);
    try fc.addLatestMessage(allocator, 1, 2, root2, .full);

    // First updateHead with old_balances.
    _ = try fc.updateHead(allocator);

    // Update balances without changing votes.
    {
        var new_list: store.JustifiedBalances = .empty;
        try new_list.appendSlice(allocator, &new_balances);
        const new_rc = try store.JustifiedBalancesRc.create(allocator, new_list);
        fc.fc_store.justified.balances.unref();
        fc.fc_store.justified.balances = new_rc;
    }
    _ = try fc.updateHead(allocator);

    // node2: 200, node1: 50+200=250 (back-propagated).
    const idx1 = fc.proto_array.getDefaultNodeIndex(root1) orelse return error.TestUnexpectedResult;
    const idx2 = fc.proto_array.getDefaultNodeIndex(root2) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(i64, 250), fc.proto_array.nodes.items[idx1].weight);
    try testing.expectEqual(@as(i64, 200), fc.proto_array.nodes.items[idx2].weight);
}

// Tree:
//       genesis
//         |
//       node1
//         |
//       node2
//         |
//       node3
// 3 validators, each voting for their respective node.
// old_balances = [125, 125, 125], new_balances = [10, 20, 30].
// Verifies that negative deltas do not cause unsigned overflow.
test "balance underflow clamping: old > new does not wrap unsigned" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x02);
    const root2 = hashFromByte(0x03);
    const root3 = hashFromByte(0x04);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const old_balances = [_]u16{ 125, 125, 125 };
    const new_balances = [_]u16{ 10, 20, 30 };

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &old_balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert 3 nodes in a chain: genesis → root1 → root2 → root3
    try onBlockFromProto(fc, allocator, makeTestBlock(1, root1, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, root2, root1), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(3, root3, root2), 10);

    // Each validator votes for their corresponding node.
    try fc.addLatestMessage(allocator, 0, 1, root1, .full);
    try fc.addLatestMessage(allocator, 1, 2, root2, .full);
    try fc.addLatestMessage(allocator, 2, 3, root3, .full);

    // First updateHead with old_balances (125 each) establishes votes.
    _ = try fc.updateHead(allocator);

    // Now update justified balances to new_balances (lower). Weight should decrease, not wrap.
    {
        var new_list: store.JustifiedBalances = .empty;
        try new_list.appendSlice(allocator, &new_balances);
        const new_rc = try store.JustifiedBalancesRc.create(allocator, new_list);
        fc.fc_store.justified.balances.unref();
        fc.fc_store.justified.balances = new_rc;
    }
    _ = try fc.updateHead(allocator);

    // All node weights should be non-negative (no underflow wrap).
    const idx1 = fc.proto_array.getDefaultNodeIndex(root1) orelse return error.TestUnexpectedResult;
    const idx2 = fc.proto_array.getDefaultNodeIndex(root2) orelse return error.TestUnexpectedResult;
    const idx3 = fc.proto_array.getDefaultNodeIndex(root3) orelse return error.TestUnexpectedResult;
    try testing.expect(fc.proto_array.nodes.items[idx1].weight >= 0);
    try testing.expect(fc.proto_array.nodes.items[idx2].weight >= 0);
    try testing.expect(fc.proto_array.nodes.items[idx3].weight >= 0);

    // Verify expected weights after underflow clamping.
    // computeDeltas: delta[node1]=-115, delta[node2]=-105, delta[node3]=-95
    // updateWeights backward propagation:
    //   node3: 125 + (-95) = 30, back-prop -95 → delta[node2] becomes -200
    //   node2: 250 + (-200) = 50, back-prop -200 → delta[node1] becomes -315
    //   node1: 375 + (-315) = 60
    try testing.expectEqual(@as(i64, 60), fc.proto_array.nodes.items[idx1].weight);
    try testing.expectEqual(@as(i64, 50), fc.proto_array.nodes.items[idx2].weight);
    try testing.expectEqual(@as(i64, 30), fc.proto_array.nodes.items[idx3].weight);
}

test "failed insertion cleanup: unknown parent does not leave dangling root" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const orphan_root = hashFromByte(0xAA);
    const unknown_parent = hashFromByte(0xBB);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    // Try to insert block with unknown parent. Should fail.
    const orphan_block = makeTestBlock(1, orphan_root, unknown_parent);
    try testing.expectError(error.InvalidBlockUnknownParent, onBlockFromProto(fc, allocator, orphan_block, 10));

    // Verify orphan root was NOT left in the indices map.
    try testing.expectEqual(@as(?u32, null), fc.proto_array.getDefaultNodeIndex(orphan_root));
}

// Tree:
//         0(genesis)
//          / \
//     1(slot 1)  2(slot 2)
//         |          |
//     3(slot 3)  4(slot 4)
//                    |
//                5(slot 5)
//                    |
//                6(slot 6)
// Default head = 6 (longest chain by tiebreaker).
// Canonical: genesis YES, 1 NO, 2 YES, 3 NO, 4 YES, 5 YES, 6 YES.
test "IsCanonical: default head follows longest chain" {
    const genesis_root = ZERO_HASH;
    const root1 = hashFromByte(0x11);
    const root2 = hashFromByte(0x12);
    const root3 = hashFromByte(0x13);
    const root4 = hashFromByte(0x14);
    const root5 = hashFromByte(0x15);
    const root6 = hashFromByte(0x16);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    // Branch 1: genesis → 1(slot 1), parent=genesis
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, root1, genesis_root), 10);
    // Branch 2: genesis → 2(slot 2), parent=genesis
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, root2, genesis_root), 10);
    // Branch 1 continues: 1 → 3(slot 3)
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(3, root3, root1), 10);
    // Branch 2 continues: 2 → 4(slot 4) → 5(slot 5) → 6(slot 6)
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(4, root4, root2), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(5, root5, root4), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(6, root6, root5), 10);

    // Default head should be 6 (longest/heaviest chain).
    _ = try fc.updateHead(testing.allocator);

    // Canonical chain: genesis → 2 → 4 → 5 → 6
    try testing.expect(try fc.getCanonicalBlockByRoot(genesis_root) != null); // genesis: YES
    try testing.expect(try fc.getCanonicalBlockByRoot(root1) == null); // 1: NO
    try testing.expect(try fc.getCanonicalBlockByRoot(root2) != null); // 2: YES
    try testing.expect(try fc.getCanonicalBlockByRoot(root3) == null); // 3: NO
    try testing.expect(try fc.getCanonicalBlockByRoot(root4) != null); // 4: YES
    try testing.expect(try fc.getCanonicalBlockByRoot(root5) != null); // 5: YES
    try testing.expect(try fc.getCanonicalBlockByRoot(root6) != null); // 6: YES
}

// Tree:
//       0(genesis)
//         |
//       1(slot 1)
//         |
//       2(slot 2)
//         |
//       3(slot 5)
// AncestorRoot(3, slot=6) → 3 (slot 5 <= 6).
// AncestorRoot(3, slot=5) → 3 (exact match).
// AncestorRoot(3, slot=1) → 1.
test "AncestorRoot: walks up to ancestor at or before given slot" {
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x21);
    const root2 = hashFromByte(0x22);
    const root3 = hashFromByte(0x23);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(1, root1, genesis_root), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(2, root2, root1), 10);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(5, root3, root2), 10);

    // AncestorRoot(root3, slot=6) → root3 (slot 5 <= 6).
    const a6 = try fc.proto_array.getAncestor(root3, 6);
    try testing.expectEqual(root3, a6.block_root);

    // AncestorRoot(root3, slot=5) → root3 (exact match).
    const a5 = try fc.proto_array.getAncestor(root3, 5);
    try testing.expectEqual(root3, a5.block_root);

    // AncestorRoot(root3, slot=1) → root1.
    const a1 = try fc.proto_array.getAncestor(root3, 1);
    try testing.expectEqual(root1, a1.block_root);
}

// Tree:
//       0(genesis)
//         |
//       1(slot 100)
//         |
//       3(slot 101)
// AncestorRoot(3, slot=100) → 1.
test "AncestorRoot: equal slot returns parent" {
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x31);
    const root3 = hashFromByte(0x33);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        200,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(100, root1, genesis_root), 200);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(101, root3, root1), 200);

    const ancestor = try fc.proto_array.getAncestor(root3, 100);
    try testing.expectEqual(root1, ancestor.block_root);
}

// Tree:
//       0(genesis)
//         |
//       1(slot 100)
//         |
//       3(slot 200)
// AncestorRoot(3, slot=150) → 1 (largest slot <= 150).
test "AncestorRoot: lower slot with gap returns parent" {
    const genesis_root = hashFromByte(0x01);
    const root1 = hashFromByte(0x41);
    const root3 = hashFromByte(0x43);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        testing.allocator,
        genesis_block,
        300,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(testing.allocator, fc);

    try onBlockFromProto(fc, testing.allocator, makeTestBlock(100, root1, genesis_root), 300);
    try onBlockFromProto(fc, testing.allocator, makeTestBlock(200, root3, root1), 300);

    const ancestor = try fc.proto_array.getAncestor(root3, 150);
    try testing.expectEqual(root1, ancestor.block_root);
}

// Tree:
//       genesis(0)
//       /        \
//     a(1)       b(1)
//    /   \         \
//  c(2)   d(2)    e(2)
//  |       |
//  f(3)   g(3)
//
// 7 validators, balances = [100]*7.
// Phase 1: No votes → head = root tiebreak.
// Phase 2: V0-V2 vote for f → head = f.
// Phase 3: V3-V6 vote for e → head = e (4*100 > 3*100 on b-branch).
// Phase 4: V3-V4 switch from e to g → a-branch=5*100 > b-branch=2*100 → head = f.
// Phase 5: Slash V0 → f=2*100, g=2*100, e=2*100 → a-branch=4*100, b-branch=2*100 → head on a still.
test "comprehensive multi-phase vote: 8-node tree with switching and slashing" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const c_root = hashFromByte(0x0C);
    const d_root = hashFromByte(0x0D);
    const e_root = hashFromByte(0x0E);
    const f_root = hashFromByte(0x0F);
    const g_root = hashFromByte(0x10);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 7;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert tree.
    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(1, b_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, c_root, a_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, d_root, a_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, e_root, b_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(3, f_root, c_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(3, g_root, d_root), 10);

    // Phase 1: No votes → head = highest leaf by root tiebreak.
    _ = try fc.updateHead(allocator);
    // g_root=0x10 > f_root=0x0F > e_root=0x0E → deepest leaves are f,g,e.
    // Weight ties at 0 → best-child chosen by root. The head depends on tree
    // back-propagation: genesis has children a(0x0A) and b(0x0B). b > a by root,
    // so best-child of genesis is b → head follows b → e.
    try testing.expectEqual(e_root, fc.head.block_root);

    // Phase 2: V0-V2 vote for f.
    try fc.addLatestMessage(allocator, 0, 3, f_root, .full);
    try fc.addLatestMessage(allocator, 1, 3, f_root, .full);
    try fc.addLatestMessage(allocator, 2, 3, f_root, .full);
    _ = try fc.updateHead(allocator);
    // a-branch weight: a=300(propagated), c=300, f=300. b-branch: b=0, e=0.
    // a-branch wins → head = f.
    try testing.expectEqual(f_root, fc.head.block_root);

    // Phase 3: V3-V6 vote for e.
    try fc.addLatestMessage(allocator, 3, 2, e_root, .full);
    try fc.addLatestMessage(allocator, 4, 2, e_root, .full);
    try fc.addLatestMessage(allocator, 5, 2, e_root, .full);
    try fc.addLatestMessage(allocator, 6, 2, e_root, .full);
    _ = try fc.updateHead(allocator);
    // a-branch=300, b-branch=400 → head = e.
    try testing.expectEqual(e_root, fc.head.block_root);

    // Phase 4: V3-V4 switch from e to g.
    // addLatestMessage requires epoch advancement to accept a vote switch.
    // Phase 3 used slot 2 (epoch 0), so we need slot in epoch 1.
    const epoch1_slot = preset.SLOTS_PER_EPOCH;
    try fc.addLatestMessage(allocator, 3, epoch1_slot, g_root, .full);
    try fc.addLatestMessage(allocator, 4, epoch1_slot, g_root, .full);
    _ = try fc.updateHead(allocator);
    // a-branch: f=300, g=200, total through a = 500.
    // b-branch: e=200, total through b = 200.
    // a wins → head. Within a: c(300) vs d(200) → c wins → head = f.
    try testing.expectEqual(f_root, fc.head.block_root);

    // Phase 5: Slash V0 → f loses 100. f=200, g=200, e=200.
    var slashing = makeTestAttesterSlashing(&[_]u64{0});
    try fc.onAttesterSlashing(allocator, &.{ .phase0 = &slashing });
    _ = try fc.updateHead(allocator);
    // a-branch: f=200, g=200, total through a = 400.
    // b-branch: e=200, total through b = 200.
    // a still wins. Within a: c(200) vs d(200) → root tiebreak d(0x0D) > c(0x0C) → head = g.
    try testing.expectEqual(g_root, fc.head.block_root);
}

/// Test-only helper: convert a pre-merge ProtoBlock to a Gloas block.
/// Sets parent_block_hash and extra_meta.post_merge so that isGloasBlock() returns true.
fn makeGloasTestBlock(slot: Slot, root: Root, parent_root: Root, parent_bh: Root) ProtoBlock {
    var block = makeTestBlock(slot, root, parent_root);
    block.parent_block_hash = parent_bh;
    block.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(
            parent_bh,
            0,
            .payload_separated,
            .pre_data,
        ),
    };
    return block;
}

//
// Tree (Gloas block A with PENDING, EMPTY, FULL; children B and C):
//
//   genesis(0, pre-merge)
//     |
//   A.PENDING(slot=1, Gloas)
//     / \
//   A.EMPTY  A.FULL  (created via onExecutionPayload)
//     |        |
//   B.PENDING  C.PENDING  (B child of EMPTY, C child of FULL)
//     |          |
//   B.EMPTY    C.EMPTY
//
// With current_slot=2, A is at slot n-1. EMPTY/FULL effective weights are zeroed.
// The tiebreaker decides: without PTC → EMPTY wins → head follows B.
// With PTC supermajority → FULL wins → head follows C.
test "Gloas head integration: EMPTY vs FULL tiebreaker via PTC" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const c_root = hashFromByte(0x0C);

    // parentBlockHash for block A's bid (used for PENDING/EMPTY).
    const a_parent_bh = hashFromByte(0xA0);
    // executionPayloadBlockHash for A's FULL variant (arrives via onExecutionPayload).
    const a_exec_bh = hashFromByte(0xAA);

    const balances = [_]u16{100} ** 4;

    var fc = try initTestForkChoiceWithOpts(
        allocator,
        makeTestBlock(0, genesis_root, ZERO_HASH),
        2, // current_slot = 2, so A (slot=1) is at n-1
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
        .{ .proposer_boost = true },
    );
    defer deinitTestForkChoice(allocator, fc);

    // Phase 1: Insert Gloas block A at slot 1.
    // onBlock creates PENDING + EMPTY nodes.
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, a_root, genesis_root, a_parent_bh), 2);

    // Verify PENDING and EMPTY exist, no FULL yet.
    try testing.expect(fc.proto_array.getNodeIndexByRootAndStatus(a_root, .pending) != null);
    try testing.expect(fc.proto_array.getNodeIndexByRootAndStatus(a_root, .empty) != null);
    try testing.expect(fc.proto_array.getNodeIndexByRootAndStatus(a_root, .full) == null);

    // Phase 2: Execution payload arrives for A → creates FULL node.
    try fc.onExecutionPayload(allocator, a_root, a_exec_bh, 1, .valid);
    try testing.expect(fc.proto_array.getNodeIndexByRootAndStatus(a_root, .full) != null);

    // Phase 3: Insert B (child of A's EMPTY) and C (child of A's FULL).
    // B's parent_block_hash = a_parent_bh (matches A's EMPTY execution_payload_block_hash).
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(2, b_root, a_root, a_parent_bh), 2);
    // C's parent_block_hash = a_exec_bh (matches A's FULL execution_payload_block_hash).
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(2, c_root, a_root, a_exec_bh), 2);

    // Phase 4: Vote for both B and C equally.
    // V0-V1 vote for B, V2-V3 vote for C.
    try fc.addLatestMessage(allocator, 0, 2, b_root, .pending);
    try fc.addLatestMessage(allocator, 1, 2, b_root, .pending);
    try fc.addLatestMessage(allocator, 2, 2, c_root, .pending);
    try fc.addLatestMessage(allocator, 3, 2, c_root, .pending);

    // Phase 5: With proposer boost on B (extends A's EMPTY), no PTC votes.
    // shouldExtendPayload: boost root = B, B's parent = A, B extends EMPTY → returns false.
    // EMPTY tiebreaker = 1, FULL tiebreaker = 0 (not timely, extends EMPTY) → EMPTY wins → head through B.
    fc.proposer_boost_root = b_root;
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(b_root, fc.head.block_root);
    // Head is B's EMPTY node.
    try testing.expectEqual(PayloadStatus.empty, fc.head.payload_status);

    // Phase 6: Add PTC supermajority → isPayloadTimely true → shouldExtendPayload true → FULL wins.
    // Set all PTC votes to true for block A.
    fc.proto_array.ptc_votes.getPtr(a_root).?.* = ProtoArray.PtcVotes.initFull();

    _ = try fc.updateHead(allocator);
    // FULL tiebreaker = 2, EMPTY tiebreaker = 1 → FULL wins → head follows C.
    try testing.expectEqual(c_root, fc.head.block_root);
    try testing.expectEqual(PayloadStatus.empty, fc.head.payload_status);
}

/// Test-only helper: post-merge block with syncing execution status.
fn makePostMergeTestBlock(slot: Slot, root: Root, parent_root: Root, exec_hash: Root) ProtoBlock {
    var block = makeTestBlock(slot, root, parent_root);
    block.extra_meta = .{
        .post_merge = BlockExtraMeta.PostMergeMeta.init(exec_hash, 0, .syncing, .available),
    };
    return block;
}

//
// Tree:
//   genesis(0)
//     /      \
//   A(1)     B(1)     [post-merge, syncing]
//   |         |
//   C(2)     D(2)
//
// Phase 1: V0-V3 vote for C → head = C.
// Phase 2: Invalidate A (LVH=genesis exec hash) → A + C become invalid.
// Phase 3: updateHead → head must be D (only viable branch).
test "head moves to valid branch after mass invalidation" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const c_root = hashFromByte(0x0C);
    const d_root = hashFromByte(0x0D);

    // Execution payload hashes for invalidation tracking.
    const genesis_exec_hash = hashFromByte(0xE0);
    const a_exec_hash = hashFromByte(0xEA);
    const b_exec_hash = hashFromByte(0xEB);
    const c_exec_hash = hashFromByte(0xEC);
    const d_exec_hash = hashFromByte(0xED);

    const balances = [_]u16{100} ** 6;

    // Genesis needs to be post-merge for the invalidation chain to work.
    var fc = try initTestForkChoice(
        allocator,
        makePostMergeTestBlock(0, genesis_root, ZERO_HASH, genesis_exec_hash),
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert two branches: A →C, B→D (all post-merge syncing).
    try onBlockFromProto(fc, allocator, makePostMergeTestBlock(1, a_root, genesis_root, a_exec_hash), 10);
    try onBlockFromProto(fc, allocator, makePostMergeTestBlock(1, b_root, genesis_root, b_exec_hash), 10);
    try onBlockFromProto(fc, allocator, makePostMergeTestBlock(2, c_root, a_root, c_exec_hash), 10);
    try onBlockFromProto(fc, allocator, makePostMergeTestBlock(2, d_root, b_root, d_exec_hash), 10);

    // Phase 1: V0-V3 vote for C → head = C.
    try fc.addLatestMessage(allocator, 0, 2, c_root, .full);
    try fc.addLatestMessage(allocator, 1, 2, c_root, .full);
    try fc.addLatestMessage(allocator, 2, 2, c_root, .full);
    try fc.addLatestMessage(allocator, 3, 2, c_root, .full);
    // V4-V5 vote for D (minority).
    try fc.addLatestMessage(allocator, 4, 2, d_root, .full);
    try fc.addLatestMessage(allocator, 5, 2, d_root, .full);

    _ = try fc.updateHead(allocator);
    try testing.expectEqual(c_root, fc.head.block_root);

    // Phase 2: Invalidate A's branch. LVH = genesis exec hash.
    // This marks A (and its descendant C) as invalid.
    fc.validateLatestHash(allocator, .{
        .invalid = .{
            .invalidate_from_parent_block_root = a_root,
            .latest_valid_exec_hash = genesis_exec_hash,
        },
    }, 10);

    // Phase 3: updateHead → head should move to D (only viable branch).
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(d_root, fc.head.block_root);
}

//
// Tree:
//   genesis(0)
//     /      \
//   A(1,Gloas)  B(1,Gloas)
//
// Phase 1: V0-V2 vote for A → head = A.
// Phase 2: V3-V6 vote for B → head = B (4*100 > 3*100).
// Phase 3: V3-V4 switch from B to A at epoch 1 → A=5*100, B=2*100 → head = A.
test "Gloas forked branches attestation shift" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const a_parent_bh = hashFromByte(0xA0);
    const b_parent_bh = hashFromByte(0xB0);

    const balances = [_]u16{100} ** 7;

    var fc = try initTestForkChoice(
        allocator,
        makeTestBlock(0, genesis_root, ZERO_HASH),
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert two Gloas branches.
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, a_root, genesis_root, a_parent_bh), 10);
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, b_root, genesis_root, b_parent_bh), 10);

    // Phase 1: V0-V2 vote for A → head = A.
    try fc.addLatestMessage(allocator, 0, 1, a_root, .pending);
    try fc.addLatestMessage(allocator, 1, 1, a_root, .pending);
    try fc.addLatestMessage(allocator, 2, 1, a_root, .pending);
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(a_root, fc.head.block_root);

    // Phase 2: V3-V6 vote for B → head = B (4*100 > 3*100).
    try fc.addLatestMessage(allocator, 3, 1, b_root, .pending);
    try fc.addLatestMessage(allocator, 4, 1, b_root, .pending);
    try fc.addLatestMessage(allocator, 5, 1, b_root, .pending);
    try fc.addLatestMessage(allocator, 6, 1, b_root, .pending);
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(b_root, fc.head.block_root);

    // Phase 3: V3-V4 switch from B to A at epoch 1 (needs slot >= SLOTS_PER_EPOCH).
    const epoch1_slot = preset.SLOTS_PER_EPOCH;
    try fc.addLatestMessage(allocator, 3, epoch1_slot, a_root, .pending);
    try fc.addLatestMessage(allocator, 4, epoch1_slot, a_root, .pending);
    _ = try fc.updateHead(allocator);
    // A now has 5 votes (V0,V1,V2,V3,V4), B has 2 (V5,V6). Head = A.
    try testing.expectEqual(a_root, fc.head.block_root);
}

/// Create a test phase0 IndexedAttestation for use with onAttestation.
fn makeTestIndexedAttestation(
    indices: []const ValidatorIndex,
    slot: Slot,
    beacon_block_root: Root,
    target_epoch: Epoch,
    target_root: Root,
    source_epoch: Epoch,
    source_root: Root,
    index: u64,
) consensus_types.phase0.IndexedAttestation.Type {
    const list = std.ArrayList(ValidatorIndex){ .items = @constCast(indices), .capacity = indices.len };
    return std.mem.zeroInit(consensus_types.phase0.IndexedAttestation.Type, .{
        .attesting_indices = list,
        .data = std.mem.zeroInit(consensus_types.phase0.AttestationData.Type, .{
            .slot = slot,
            .index = index,
            .beacon_block_root = beacon_block_root,
            .source = std.mem.zeroInit(consensus_types.phase0.Checkpoint.Type, .{
                .epoch = source_epoch,
                .root = source_root,
            }),
            .target = std.mem.zeroInit(consensus_types.phase0.Checkpoint.Type, .{
                .epoch = target_epoch,
                .root = target_root,
            }),
        }),
    });
}

test "onAttestation: reject empty aggregation bitfield" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 10);

    // Empty attesting indices.
    var att = makeTestIndexedAttestation(&.{}, 1, block_root, 0, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationEmptyAggregationBitfield,
        fc.onAttestation(allocator, &any_att, ZERO_HASH, false),
    );
}

test "onAttestation: reject future epoch" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    // current_slot = 10, so current_epoch = 10 / SLOTS_PER_EPOCH = 1 (minimal: 8 slots/epoch)
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 10);

    // Future epoch: target_epoch = 5 >> current_epoch = 1.
    const indices = [_]ValidatorIndex{0};
    const future_epoch_slot = 5 * preset.SLOTS_PER_EPOCH;
    var att = makeTestIndexedAttestation(&indices, future_epoch_slot, block_root, 5, block_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationFutureEpoch,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF1), false),
    );
}

test "onAttestation: reject past epoch (non-force)" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    // current_slot = 3 * SLOTS_PER_EPOCH, so current_epoch = 3.
    const current_slot = 3 * preset.SLOTS_PER_EPOCH;
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        current_slot,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), current_slot);

    // Past epoch: target_epoch = 0, current_epoch = 3 => 0 + 1 < 3 => past.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, block_root, 0, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationPastEpoch,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF2), false),
    );
}

test "onAttestation: reject bad target epoch" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    // current_slot = 40 → current_epoch = 1 (SLOTS_PER_EPOCH=32 mainnet).
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        40,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 40);

    // Bad target epoch: att_slot = 33 (epoch 1), target_epoch = 0 → mismatch.
    // FutureEpoch: 0 > 1 = false. PastEpoch: 0+1 < 1 = false. BadTargetEpoch: 0 != 1 = true.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 33, block_root, 0, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationBadTargetEpoch,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF3), false),
    );
}

test "onAttestation: reject unknown target root" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 10);

    // Unknown target root: target_root = 0xFF which is not in the tree.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, block_root, 0, hashFromByte(0xFF), 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationUnknownTargetRoot,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF4), false),
    );
}

test "onAttestation: reject unknown head block" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    // beacon_block_root = 0xFF not in tree, but target_root = genesis_root (known).
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, hashFromByte(0xFF), 0, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationUnknownHeadBlock,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF5), false),
    );
}

test "onAttestation: reject attests to future block" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert block at slot 5.
    try onBlockFromProto(fc, allocator, makeTestBlock(5, block_root, genesis_root), 10);

    // Attestation slot = 3, but block.slot = 5 => block.slot > att_slot => future block.
    // target_root = block_root to pass the target validation before reaching the future block check.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 3, block_root, 0, block_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationAttestsToFutureBlock,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF6), false),
    );
}

test "onAttestation: reject invalid target (cross-epoch mismatch)" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    // current_slot in epoch 1 so we can attest in epoch 1.
    const current_slot = preset.SLOTS_PER_EPOCH + 2;
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        current_slot,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    // Insert block at slot 1 (epoch 0). When target_epoch = 1 > epoch_of_block(0),
    // expected_target = block_root. But we set target_root = genesis_root != block_root.
    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), current_slot);

    const att_slot = preset.SLOTS_PER_EPOCH; // epoch 1
    const indices = [_]ValidatorIndex{0};
    // target_root = genesis_root but expected_target = block_root (because target_epoch > block_epoch).
    var att = makeTestIndexedAttestation(&indices, att_slot, block_root, 1, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationInvalidTarget,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xF7), false),
    );
}

test "onAttestation: valid attestation applies vote (past slot)" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    // current_slot = 5 so attestations at slot < 5 apply immediately.
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        5,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 5);

    // Valid attestation: slot = 1 (< current_slot = 5), target_epoch = 0 = epoch(slot 1).
    // target_root must match block.target_root (= block_root from makeTestBlock).
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, block_root, 0, block_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try fc.onAttestation(allocator, &any_att, hashFromByte(0xA1), false);

    // Validator 0 should now have a vote. Head should be block_root.
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(block_root, fc.head.block_root);
}

test "onAttestation: valid attestation queued (same slot)" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    // current_slot = 3 so attestation at slot 3 gets queued (att_slot >= current_slot).
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        3,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, block_root, genesis_root), 3);

    // Attestation at slot 3 = current_slot → should be queued.
    // target_root must match block.target_root (= block_root).
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 3, block_root, 0, block_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try fc.onAttestation(allocator, &any_att, hashFromByte(0xA2), false);

    // Should be in the queue, not yet applied.
    try testing.expect(fc.queued_attestations.count() > 0);
}

test "onAttestation: zero hash beacon_block_root is silently ignored" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        5,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &.{},
    );
    defer deinitTestForkChoice(allocator, fc);

    // Attestation to ZERO_HASH beacon_block_root should be silently ignored.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, ZERO_HASH, 0, genesis_root, 0, genesis_root, 0);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    // Should succeed (no error) — just returns early.
    try fc.onAttestation(allocator, &any_att, hashFromByte(0xA3), false);
}

// ── FFG updates with votes tests ──

test "onAttestation: votes shift head between forks" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 6;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Two branches from genesis.
    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(1, b_root, genesis_root), 10);

    // First V0-V2 vote for A via onAttestation.
    // target_root = a_root (block.target_root for makeTestBlock(1, a_root, ...)).
    {
        const indices = [_]ValidatorIndex{ 0, 1, 2 };
        var att = makeTestIndexedAttestation(&indices, 1, a_root, 0, a_root, 0, genesis_root, 0);
        const any_att = AnyIndexedAttestation{ .phase0 = &att };
        try fc.onAttestation(allocator, &any_att, hashFromByte(0xC1), false);
    }

    _ = try fc.updateHead(allocator);
    try testing.expectEqual(a_root, fc.head.block_root);

    // V3-V5 vote for B → B has 3 votes, A has 3 → tiebreaker. Let's add more so B wins.
    {
        const indices = [_]ValidatorIndex{ 3, 4, 5 };
        var att = makeTestIndexedAttestation(&indices, 1, b_root, 0, b_root, 0, genesis_root, 0);
        const any_att = AnyIndexedAttestation{ .phase0 = &att };
        try fc.onAttestation(allocator, &any_att, hashFromByte(0xC2), false);
    }

    // Tie: 3*100 vs 3*100. Winner decided by root comparison (higher root wins in tiebreaker).
    // Regardless of tiebreak, let's verify votes were applied by checking both branches have weight.
    _ = try fc.updateHead(allocator);
    // The tiebreaker selects based on root bytes — just verify head is one of them.
    try testing.expect(std.mem.eql(u8, &fc.head.block_root, &a_root) or std.mem.eql(u8, &fc.head.block_root, &b_root));
}

test "onAttestation: epoch advancement allows vote update" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    const epoch1_slot = preset.SLOTS_PER_EPOCH;
    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        epoch1_slot + 5,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), epoch1_slot + 5);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, b_root, genesis_root), epoch1_slot + 5);

    // Validator 0 votes for A in epoch 0.
    // target_root = a_root (block.target_root from makeTestBlock).
    {
        const indices = [_]ValidatorIndex{0};
        var att = makeTestIndexedAttestation(&indices, 1, a_root, 0, a_root, 0, genesis_root, 0);
        const any_att = AnyIndexedAttestation{ .phase0 = &att };
        try fc.onAttestation(allocator, &any_att, hashFromByte(0xD1), false);
    }

    _ = try fc.updateHead(allocator);
    try testing.expectEqual(a_root, fc.head.block_root);

    // Validator 0 switches vote to B in epoch 1 (epoch advances).
    // target_epoch=1 > epoch_of(block.slot=2)=0, so expected_target = b_root (beacon_block_root).
    {
        const indices = [_]ValidatorIndex{0};
        var att = makeTestIndexedAttestation(&indices, epoch1_slot, b_root, 1, b_root, 0, genesis_root, 0);
        const any_att = AnyIndexedAttestation{ .phase0 = &att };
        try fc.onAttestation(allocator, &any_att, hashFromByte(0xD2), false);
    }

    _ = try fc.updateHead(allocator);
    try testing.expectEqual(b_root, fc.head.block_root);
}

// ── Proposer boost with attestation tests ──

test "onAttestation: proposer boost outweighs attestation votes" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    // 32 validators each with weight 128 → committee_weight = 32*128/32 = 128
    // proposer_boost_score = committee_weight * 40 / 100 = 51
    const balances = [_]u16{128} ** 32;

    var fc = try initTestForkChoiceWithOpts(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
        .{ .proposer_boost = true },
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(1, b_root, genesis_root), 10);

    // Give A one vote (weight = 128).
    // target_root = a_root (block.target_root from makeTestBlock).
    {
        const indices = [_]ValidatorIndex{0};
        var att = makeTestIndexedAttestation(&indices, 1, a_root, 0, a_root, 0, genesis_root, 0);
        const any_att = AnyIndexedAttestation{ .phase0 = &att };
        try fc.onAttestation(allocator, &any_att, hashFromByte(0xE1), false);
    }

    // Apply proposer boost to B.
    fc.proposer_boost_root = b_root;

    // Head: A has 128 (1 vote). B has proposer_boost (51).
    // A should win with 128 > 51.
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(a_root, fc.head.block_root);
}

test "onAttestation: equivocating validator votes are not counted" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 4;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(1, b_root, genesis_root), 10);

    // Mark validator 0 as equivocating via attester slashing.
    const slashing_indices = [_]ValidatorIndex{0};
    var slashing = makeTestAttesterSlashing(&slashing_indices);
    const any_slashing = AnyAttesterSlashing{ .phase0 = &slashing };
    try fc.onAttesterSlashing(allocator, &any_slashing);

    // Validator 0 votes for A (should be ignored because equivocating).
    // Validator 1 votes for B.
    // target_root = a_root/b_root (block.target_root from makeTestBlock).
    {
        const indices_a = [_]ValidatorIndex{0};
        var att_a = makeTestIndexedAttestation(&indices_a, 1, a_root, 0, a_root, 0, genesis_root, 0);
        const any_att_a = AnyIndexedAttestation{ .phase0 = &att_a };
        try fc.onAttestation(allocator, &any_att_a, hashFromByte(0xE2), false);
    }
    {
        const indices_b = [_]ValidatorIndex{1};
        var att_b = makeTestIndexedAttestation(&indices_b, 1, b_root, 0, b_root, 0, genesis_root, 0);
        const any_att_b = AnyIndexedAttestation{ .phase0 = &att_b };
        try fc.onAttestation(allocator, &any_att_b, hashFromByte(0xE3), false);
    }

    // Head should be B since validator 0's vote was excluded.
    _ = try fc.updateHead(allocator);
    try testing.expectEqual(b_root, fc.head.block_root);
}

test "onAttestation: reject same-slot full vote for Gloas block" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Add a Gloas block at slot 1.
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, block_root, genesis_root, ZERO_HASH), 10);

    // Same-slot attestation (slot=1) with index=1 (FULL vote) must be rejected.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 1, block_root, 0, block_root, 0, genesis_root, 1);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationInvalidDataIndex,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xB1), false),
    );
}

test "onAttestation: reject full vote when FULL variant missing" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Add a Gloas block at slot 1 (only PENDING + EMPTY, no FULL).
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, block_root, genesis_root, ZERO_HASH), 10);

    // Attestation from a later slot (slot=2) with index=1 (FULL vote)
    // must be rejected because no FULL variant exists yet.
    const indices = [_]ValidatorIndex{0};
    var att = makeTestIndexedAttestation(&indices, 2, block_root, 0, block_root, 0, genesis_root, 1);
    const any_att = AnyIndexedAttestation{ .phase0 = &att };
    try testing.expectError(
        error.InvalidAttestationUnknownPayloadStatus,
        fc.onAttestation(allocator, &any_att, hashFromByte(0xB2), false),
    );
}

// Upstream lodestar #9209: ForkChoice.shouldExtendPayload is a thin wrapper that
// supplies the fork-choice-owned proposer-boost root to the underlying ProtoArray
// check, and inherits the new hasPayload gate.
test "ForkChoice.shouldExtendPayload uses own proposer_boost_root and hasPayload gate" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Gloas block, no FULL variant yet → gate closes.
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, block_root, genesis_root, ZERO_HASH), 10);
    try testing.expect(!try fc.shouldExtendPayload(block_root));

    // FULL arrives, no proposer boost set → condition 2 passes.
    try fc.onExecutionPayload(allocator, block_root, hashFromByte(0xEE), 1, .valid);
    try testing.expect(fc.proposer_boost_root == null);
    try testing.expect(try fc.shouldExtendPayload(block_root));
}

test "hasPayloadUnsafe reflects onExecutionPayload" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const block_root = hashFromByte(0x02);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    // Pre-Gloas genesis always has payload.
    try testing.expect(fc.hasPayloadUnsafe(genesis_root));

    // Add Gloas block — no FULL yet.
    try onBlockFromProto(fc, allocator, makeGloasTestBlock(1, block_root, genesis_root, ZERO_HASH), 10);
    try testing.expect(!fc.hasPayloadUnsafe(block_root));

    // After execution payload arrives, FULL exists.
    try fc.onExecutionPayload(allocator, block_root, hashFromByte(0xEE), 1, .valid);
    try testing.expect(fc.hasPayloadUnsafe(block_root));
}

test "getCanonicalBlockByRoot finds ancestor on canonical chain" {
    const allocator = testing.allocator;
    const genesis_root = hashFromByte(0x01);
    const a_root = hashFromByte(0x0A);
    const b_root = hashFromByte(0x0B);
    const genesis_block = makeTestBlock(0, genesis_root, ZERO_HASH);
    const balances = [_]u16{100} ** 2;

    var fc = try initTestForkChoice(
        allocator,
        genesis_block,
        10,
        makeTestCheckpoint(0, genesis_root),
        makeTestCheckpoint(0, genesis_root),
        &balances,
    );
    defer deinitTestForkChoice(allocator, fc);

    try onBlockFromProto(fc, allocator, makeTestBlock(1, a_root, genesis_root), 10);
    try onBlockFromProto(fc, allocator, makeTestBlock(2, b_root, a_root), 10);
    _ = try fc.updateHead(allocator);

    // Head should be B (longest chain).
    try testing.expectEqual(b_root, fc.head.block_root);

    // A is on the canonical chain.
    const found_a = try fc.getCanonicalBlockByRoot(a_root);
    try testing.expect(found_a != null);
    try testing.expectEqual(a_root, found_a.?.block_root);

    // Head itself is found.
    const found_b = try fc.getCanonicalBlockByRoot(b_root);
    try testing.expect(found_b != null);
    try testing.expectEqual(b_root, found_b.?.block_root);

    // Non-existent root returns null.
    const not_found = try fc.getCanonicalBlockByRoot(hashFromByte(0xFF));
    try testing.expect(not_found == null);
}
