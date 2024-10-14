import {Logger, MapDef, fromHex, toRootHex} from "@lodestar/utils";
import {SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH, INTERVALS_PER_SLOT} from "@lodestar/params";
import {bellatrix, Slot, ValidatorIndex, phase0, ssz, RootHex, Epoch, Root, BeaconBlock} from "@lodestar/types";
import {
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  computeEpochAtSlot,
  ZERO_HASH,
  EffectiveBalanceIncrements,
  CachedBeaconStateAllForks,
  isExecutionBlockBodyType,
  isExecutionStateType,
  isExecutionEnabled,
  getAttesterSlashableIndices,
} from "@lodestar/state-transition";
import {computeUnrealizedCheckpoints} from "@lodestar/state-transition/epoch";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";

import {computeDeltas} from "../protoArray/computeDeltas.js";
import {
  HEX_ZERO_HASH,
  VoteTracker,
  ProtoBlock,
  ExecutionStatus,
  MaybeValidExecutionStatus,
  LVHExecResponse,
  ProtoNode,
  DataAvailabilityStatus,
} from "../protoArray/interface.js";
import {ProtoArray} from "../protoArray/protoArray.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "../protoArray/errors.js";

import {ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode, InvalidAttestationCode} from "./errors.js";
import {
  IForkChoice,
  LatestMessage,
  PowBlockHex,
  EpochDifference,
  AncestorResult,
  AncestorStatus,
  ForkChoiceMetrics,
  NotReorgedReason,
} from "./interface.js";
import {IForkChoiceStore, CheckpointWithHex, toCheckpointWithHex, JustifiedBalances} from "./store.js";

export type ForkChoiceOpts = {
  proposerBoost?: boolean;
  proposerBoostReorg?: boolean;
  computeUnrealized?: boolean;
};

export enum UpdateHeadOpt {
  GetCanonicialHead = "getCanonicialHead", // Skip getProposerHead
  GetProposerHead = "getProposerHead", // With getProposerHead
  GetPredictedProposerHead = "getPredictedProposerHead", // With predictProposerHead
}

export type UpdateAndGetHeadOpt =
  | {mode: UpdateHeadOpt.GetCanonicialHead}
  | {mode: UpdateHeadOpt.GetProposerHead; secFromSlot: number; slot: Slot}
  | {mode: UpdateHeadOpt.GetPredictedProposerHead; slot: Slot};

/**
 * Provides an implementation of "Ethereum Consensus -- Beacon Chain Fork Choice":
 *
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#fork-choice
 *
 * ## Detail
 *
 * This class wraps `ProtoArray` and provides:
 *
 * - Management of validators latest messages and balances
 * - Management of the justified/finalized checkpoints as seen by fork choice
 * - Queuing of attestations from the current slot
 *
 * This class MUST be used with the following considerations:
 *
 * - Time is not updated automatically, updateTime MUST be called every slot
 */
export class ForkChoice implements IForkChoice {
  irrecoverableError?: Error;
  /**
   * Votes currently tracked in the protoArray
   * Indexed by validator index
   * Each vote contains the latest message and previous message
   */
  private readonly votes: VoteTracker[] = [];

  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   */
  private readonly queuedAttestations: MapDef<Slot, MapDef<RootHex, Set<ValidatorIndex>>> = new MapDef(
    () => new MapDef(() => new Set())
  );

  /**
   * It's inconsistent to count number of queued attestations at different intervals of slot.
   * Instead of that, we count number of queued attestations at the previous slot.
   */
  private queuedAttestationsPreviousSlot = 0;

  // Note: as of Jun 2022 Lodestar metrics show that 100% of the times updateHead() is called, synced = false.
  // Because we are processing attestations from gossip, recomputing scores is always necessary
  // /** Avoid having to compute deltas all the times. */
  // private synced = false;

  /** Cached head */
  private head: ProtoBlock;
  /**
   * Only cache attestation data root hex if it's tree backed since it's available.
   **/
  private validatedAttestationDatas = new Set<string>();
  /** Boost the entire branch with this proposer root as the leaf */
  private proposerBoostRoot: RootHex | null = null;
  /** Score to use in proposer boost, evaluated lazily from justified balances */
  private justifiedProposerBoostScore: number | null = null;
  /** The current effective balances */
  private balances: EffectiveBalanceIncrements;
  /**
   * Instantiates a Fork Choice from some existing components
   *
   * This is useful if the existing components have been loaded from disk after a process restart.
   */
  constructor(
    private readonly config: ChainForkConfig,
    private readonly fcStore: IForkChoiceStore,
    /** The underlying representation of the block DAG. */
    private readonly protoArray: ProtoArray,
    private readonly opts?: ForkChoiceOpts,
    private readonly logger?: Logger
  ) {
    this.head = this.updateHead();
    this.balances = this.fcStore.justified.balances;
  }

  getMetrics(): ForkChoiceMetrics {
    return {
      votes: this.votes.length,
      queuedAttestations: this.queuedAttestationsPreviousSlot,
      validatedAttestationDatas: this.validatedAttestationDatas.size,
      balancesLength: this.balances.length,
      nodes: this.protoArray.nodes.length,
      indices: this.protoArray.indices.size,
    };
  }

  /**
   * Returns the block root of an ancestor of `blockRoot` at the given `slot`.
   * (Note: `slot` refers to the block that is *returned*, not the one that is supplied.)
   *
   * NOTE: May be expensive: potentially walks through the entire fork of head to finalized block
   *
   * ### Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_ancestor
   */
  getAncestor(blockRoot: RootHex, ancestorSlot: Slot): RootHex {
    return this.protoArray.getAncestor(blockRoot, ancestorSlot);
  }

  /**
   * Get the cached head root
   */
  getHeadRoot(): RootHex {
    return this.getHead().blockRoot;
  }

  /**
   * Get the cached head
   */
  getHead(): ProtoBlock {
    return this.head;
  }

  /**
   *
   * A multiplexer to wrap around the traditional `updateHead()` according to the scenario
   * Scenarios as follow:
   *    Prepare to propose in the next slot: getHead() -> predictProposerHead()
   *    Proposing in the current slot: updateHead() -> getProposerHead()
   *    Others eg. initializing forkchoice, importBlock: updateHead()
   *
   * Only `GetProposerHead` returns additional field `isHeadTimely` and `notReorgedReason` for metrics purpose
   */
  updateAndGetHead(opt: UpdateAndGetHeadOpt): {
    head: ProtoBlock;
    isHeadTimely?: boolean;
    notReorgedReason?: NotReorgedReason;
  } {
    const {mode} = opt;

    const canonicialHeadBlock = mode === UpdateHeadOpt.GetPredictedProposerHead ? this.getHead() : this.updateHead();
    switch (mode) {
      case UpdateHeadOpt.GetPredictedProposerHead:
        return {head: this.predictProposerHead(canonicialHeadBlock, opt.slot)};
      case UpdateHeadOpt.GetProposerHead: {
        const {
          proposerHead: head,
          isHeadTimely,
          notReorgedReason,
        } = this.getProposerHead(canonicialHeadBlock, opt.secFromSlot, opt.slot);
        return {head, isHeadTimely, notReorgedReason};
      }
      case UpdateHeadOpt.GetCanonicialHead:
        return {head: canonicialHeadBlock};
      default:
        return {head: canonicialHeadBlock};
    }
  }

  /**
   * Get the proposer boost root
   */
  getProposerBoostRoot(): RootHex {
    return this.proposerBoostRoot ?? HEX_ZERO_HASH;
  }

  /**
   * To predict the proposer head of the next slot. That is, to predict if proposer-boost-reorg could happen.
   * Reason why we can't be certain is because information of the head block is not fully available yet
   * since the current slot hasn't ended especially the attesters' votes.
   *
   * There is a chance we mispredict.
   *
   * By calling this function, we assume we are the proposer of next slot
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/bellatrix/fork-choice.md#should_override_forkchoice_update
   */
  predictProposerHead(headBlock: ProtoBlock, currentSlot?: Slot): ProtoBlock {
    // Skip re-org attempt if proposer boost (reorg) are disabled
    if (!this.opts?.proposerBoost || !this.opts?.proposerBoostReorg) {
      this.logger?.verbose("No proposer boot reorg prediction since the related flags are disabled");
      return headBlock;
    }

    const parentBlock = this.protoArray.getBlock(headBlock.parentRoot);
    const proposalSlot = headBlock.slot + 1;
    currentSlot = currentSlot ?? this.fcStore.currentSlot;

    // No reorg if parentBlock isn't available
    if (parentBlock === undefined) {
      return headBlock;
    }

    const {prelimProposerHead} = this.getPreliminaryProposerHead(headBlock, parentBlock, proposalSlot);

    if (prelimProposerHead === headBlock) {
      return headBlock;
    }

    const currentTimeOk = headBlock.slot === currentSlot;
    if (!currentTimeOk) {
      return headBlock;
    }

    this.logger?.info("Current head is weak. Predicting next block to be built on parent of head");
    return parentBlock;
  }

  /**
   *
   * This function takes in the canonical head block and determine the proposer head (canonical head block or its parent)
   * https://github.com/ethereum/consensus-specs/pull/3034 for info about proposer boost reorg
   * This function should only be called during block proposal and only be called after `updateHead()` in `updateAndGetHead()`
   *
   * Same as https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#get_proposer_head
   */
  getProposerHead(
    headBlock: ProtoBlock,
    secFromSlot: number,
    slot: Slot
  ): {proposerHead: ProtoBlock; isHeadTimely: boolean; notReorgedReason?: NotReorgedReason} {
    const isHeadTimely = headBlock.timeliness;
    let proposerHead = headBlock;

    // Skip re-org attempt if proposer boost (reorg) are disabled
    if (!this.opts?.proposerBoost || !this.opts?.proposerBoostReorg) {
      this.logger?.verbose("No proposer boot reorg attempt since the related flags are disabled");
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ProposerBoostReorgDisabled};
    }

    const parentBlock = this.protoArray.getBlock(headBlock.parentRoot);

    // No reorg if parentBlock isn't available
    if (parentBlock === undefined) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotAvailable};
    }

    const {prelimProposerHead, prelimNotReorgedReason} = this.getPreliminaryProposerHead(headBlock, parentBlock, slot);

    if (prelimProposerHead === headBlock && prelimNotReorgedReason !== undefined) {
      return {proposerHead, isHeadTimely, notReorgedReason: prelimNotReorgedReason};
    }

    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_proposing_on_time
    const proposerReorgCutoff = this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT / 2;
    const isProposingOnTime = secFromSlot <= proposerReorgCutoff;
    if (!isProposingOnTime) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.NotProposingOnTime};
    }

    // No reorg if attempted reorg is more than a single slot
    // Half of single_slot_reorg check in the spec is done in getPreliminaryProposerHead()
    const currentTimeOk = headBlock.slot + 1 === slot;
    if (!currentTimeOk) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ReorgMoreThanOneSlot};
    }

    // No reorg if proposer boost is still in effect
    const isProposerBoostWornOff = this.proposerBoostRoot !== headBlock.blockRoot;
    if (!isProposerBoostWornOff) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ProposerBoostNotWornOff};
    }

    // No reorg if headBlock is "not weak" ie. headBlock's weight exceeds (REORG_HEAD_WEIGHT_THRESHOLD = 20)% of total attester weight
    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_head_weak
    const reorgThreshold = getCommitteeFraction(this.fcStore.justified.totalBalance, {
      slotsPerEpoch: SLOTS_PER_EPOCH,
      committeePercent: this.config.REORG_HEAD_WEIGHT_THRESHOLD,
    });
    const headNode = this.protoArray.getNode(headBlock.blockRoot);
    // If headNode is unavailable, give up reorg
    if (headNode === undefined || headNode.weight >= reorgThreshold) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.HeadBlockNotWeak};
    }

    // No reorg if parentBlock is "not strong" ie. parentBlock's weight is less than or equal to (REORG_PARENT_WEIGHT_THRESHOLD = 160)% of total attester weight
    // https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/fork-choice.md#is_parent_strong
    const parentThreshold = getCommitteeFraction(this.fcStore.justified.totalBalance, {
      slotsPerEpoch: SLOTS_PER_EPOCH,
      committeePercent: this.config.REORG_PARENT_WEIGHT_THRESHOLD,
    });
    const parentNode = this.protoArray.getNode(parentBlock.blockRoot);
    // If parentNode is unavailable, give up reorg
    if (parentNode === undefined || parentNode.weight <= parentThreshold) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotStrong};
    }

    // Reorg if all above checks fail
    this.logger?.info("Will perform single-slot reorg to reorg out current weak head");
    proposerHead = parentBlock;

    return {proposerHead, isHeadTimely};
  }

  /**
   * Run the fork choice rule to determine the head.
   * Update the head cache.
   *
   * Very expensive function (400ms / run as of Aug 2021). Call when the head really needs to be re-calculated.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#get_head
   */
  updateHead(): ProtoBlock {
    // balances is not changed but votes are changed

    // NOTE: In current Lodestar metrics, 100% of forkChoiceRequests this.synced = false.
    // No need to cache computeDeltas()
    //
    // TODO: In current Lodestar metrics, 100% of forkChoiceRequests result in a changed head.
    // No need to cache the head anymore

    // Check if scores need to be calculated/updated
    const oldBalances = this.balances;
    const newBalances = this.fcStore.justified.balances;
    const deltas = computeDeltas(
      this.protoArray.nodes.length,
      this.votes,
      oldBalances,
      newBalances,
      this.fcStore.equivocatingIndices
    );
    this.balances = newBalances;
    /**
     * The structure in line with deltas to propagate boost up the branch
     * starting from the proposerIndex
     */
    let proposerBoost: {root: RootHex; score: number} | null = null;
    if (this.opts?.proposerBoost && this.proposerBoostRoot) {
      const proposerBoostScore =
        this.justifiedProposerBoostScore ??
        getCommitteeFraction(this.fcStore.justified.totalBalance, {
          slotsPerEpoch: SLOTS_PER_EPOCH,
          committeePercent: this.config.PROPOSER_SCORE_BOOST,
        });
      proposerBoost = {root: this.proposerBoostRoot, score: proposerBoostScore};
      this.justifiedProposerBoostScore = proposerBoostScore;
    }

    const currentSlot = this.fcStore.currentSlot;
    this.protoArray.applyScoreChanges({
      deltas,
      proposerBoost,
      justifiedEpoch: this.fcStore.justified.checkpoint.epoch,
      justifiedRoot: this.fcStore.justified.checkpoint.rootHex,
      finalizedEpoch: this.fcStore.finalizedCheckpoint.epoch,
      finalizedRoot: this.fcStore.finalizedCheckpoint.rootHex,
      currentSlot,
    });

    const headRoot = this.protoArray.findHead(this.fcStore.justified.checkpoint.rootHex, currentSlot);
    const headIndex = this.protoArray.indices.get(headRoot);
    if (headIndex === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: headRoot,
      });
    }
    const headNode = this.protoArray.nodes[headIndex];
    if (headNode === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: headRoot,
      });
    }

    this.head = headNode;
    return this.head;
  }

  /**
   * An iteration over protoArray to get present slots, to be called preemptively
   * from prepareNextSlot to prevent delay on produceBlindedBlock
   * @param windowStart is the slot after which (excluding) to provide present slots
   */
  getSlotsPresent(windowStart: number): number {
    return this.protoArray.nodes.filter((node) => node.slot > windowStart).length;
  }

  /** Very expensive function, iterates the entire ProtoArray. Called only in debug API */
  getHeads(): ProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.bestChild === undefined);
  }

  /** This is for the debug API only */
  getAllNodes(): ProtoNode[] {
    return this.protoArray.nodes;
  }

  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.finalizedCheckpoint;
  }

  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.justified.checkpoint;
  }

  /**
   * Add `block` to the fork choice DAG.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_block
   *
   * It only approximates the specification since it does not run the `state_transition` check.
   * That should have already been called upstream and it's too expensive to call again.
   *
   * ## Notes:
   *
   * The supplied block **must** pass the `state_transition` function as it will not be run here.
   *
   * `justifiedBalances` balances of justified state which is updated synchronously.
   * This ensures that the forkchoice is never out of sync.
   */
  onBlock(
    block: BeaconBlock,
    state: CachedBeaconStateAllForks,
    blockDelaySec: number,
    currentSlot: Slot,
    executionStatus: MaybeValidExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): ProtoBlock {
    const {parentRoot, slot} = block;
    const parentRootHex = toRootHex(parentRoot);
    // Parent block must be known
    const parentBlock = this.protoArray.getBlock(parentRootHex);
    if (!parentBlock) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.UNKNOWN_PARENT,
          root: parentRootHex,
        },
      });
    }

    // Blocks cannot be in the future. If they are, their consideration must be delayed until
    // the are in the past.
    //
    // Note: presently, we do not delay consideration. We just drop the block.
    if (slot > this.fcStore.currentSlot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.FUTURE_SLOT,
          currentSlot: this.fcStore.currentSlot,
          blockSlot: slot,
        },
      });
    }

    // Check that block is later than the finalized epoch slot (optimization to reduce calls to
    // get_ancestor).
    const finalizedSlot = computeStartSlotAtEpoch(this.fcStore.finalizedCheckpoint.epoch);
    if (slot <= finalizedSlot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.FINALIZED_SLOT,
          finalizedSlot,
          blockSlot: slot,
        },
      });
    }

    // Check block is a descendant of the finalized block at the checkpoint finalized slot.
    const blockAncestorRoot = this.getAncestor(parentRootHex, finalizedSlot);
    const finalizedRoot = this.fcStore.finalizedCheckpoint.rootHex;
    if (blockAncestorRoot !== finalizedRoot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT,
          finalizedRoot,
          blockAncestor: blockAncestorRoot,
        },
      });
    }

    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(blockRoot);

    // Assign proposer score boost if the block is timely
    // before attesting interval = before 1st interval
    const isTimely = this.isBlockTimely(block, blockDelaySec);
    if (
      this.opts?.proposerBoost &&
      isTimely &&
      // only boost the first block we see
      this.proposerBoostRoot === null
    ) {
      this.proposerBoostRoot = blockRootHex;
    }

    // As per specs, we should be validating here the terminal conditions of
    // the PoW if this were a merge transition block.
    // (https://github.com/ethereum/consensus-specs/blob/dev/specs/bellatrix/fork-choice.md#on_block)
    //
    // However this check has been moved to the `verifyBlockStateTransition` in
    // `packages/beacon-node/src/chain/blocks/verifyBlock.ts` as:
    //
    //  1. Its prudent to fail fast and not try importing a block in forkChoice.
    //  2. Also the data to run such a validation is readily available there.

    const justifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const finalizedCheckpoint = toCheckpointWithHex(state.finalizedCheckpoint);
    const stateJustifiedEpoch = justifiedCheckpoint.epoch;

    // Justified balances for `justifiedCheckpoint` are new to the fork-choice. Compute them on demand only if
    // the justified checkpoint changes
    this.updateCheckpoints(justifiedCheckpoint, finalizedCheckpoint, () =>
      this.fcStore.justifiedBalancesGetter(justifiedCheckpoint, state)
    );

    const blockEpoch = computeEpochAtSlot(slot);

    // same logic to compute_pulled_up_tip in the spec, making it inline because of reusing variables
    // If the parent checkpoints are already at the same epoch as the block being imported,
    // it's impossible for the unrealized checkpoints to differ from the parent's. This
    // holds true because:
    //
    // 1. A child block cannot have lower FFG checkpoints than its parent.
    // 2. A block in epoch `N` cannot contain attestations which would justify an epoch higher than `N`.
    // 3. A block in epoch `N` cannot contain attestations which would finalize an epoch higher than `N - 1`.
    //
    // This is an optimization. It should reduce the amount of times we run
    // `process_justification_and_finalization` by approximately 1/3rd when the chain is
    // performing optimally.
    let unrealizedJustifiedCheckpoint: CheckpointWithHex;
    let unrealizedFinalizedCheckpoint: CheckpointWithHex;
    if (this.opts?.computeUnrealized) {
      if (
        parentBlock.unrealizedJustifiedEpoch === blockEpoch &&
        parentBlock.unrealizedFinalizedEpoch + 1 >= blockEpoch
      ) {
        // reuse from parent, happens at 1/3 last blocks of epoch as monitored in mainnet
        unrealizedJustifiedCheckpoint = {
          epoch: parentBlock.unrealizedJustifiedEpoch,
          root: fromHex(parentBlock.unrealizedJustifiedRoot),
          rootHex: parentBlock.unrealizedJustifiedRoot,
        };
        unrealizedFinalizedCheckpoint = {
          epoch: parentBlock.unrealizedFinalizedEpoch,
          root: fromHex(parentBlock.unrealizedFinalizedRoot),
          rootHex: parentBlock.unrealizedFinalizedRoot,
        };
      } else {
        // compute new, happens 2/3 first blocks of epoch as monitored in mainnet
        const unrealized = computeUnrealizedCheckpoints(state);
        unrealizedJustifiedCheckpoint = toCheckpointWithHex(unrealized.justifiedCheckpoint);
        unrealizedFinalizedCheckpoint = toCheckpointWithHex(unrealized.finalizedCheckpoint);
      }
    } else {
      unrealizedJustifiedCheckpoint = justifiedCheckpoint;
      unrealizedFinalizedCheckpoint = finalizedCheckpoint;
    }

    // Un-realized checkpoints
    // Update best known unrealized justified & finalized checkpoints
    this.updateUnrealizedCheckpoints(unrealizedJustifiedCheckpoint, unrealizedFinalizedCheckpoint, () =>
      this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state)
    );

    // If block is from past epochs, try to update store's justified & finalized checkpoints right away
    if (blockEpoch < computeEpochAtSlot(currentSlot)) {
      this.updateCheckpoints(unrealizedJustifiedCheckpoint, unrealizedFinalizedCheckpoint, () =>
        this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state)
      );
    }

    const targetSlot = computeStartSlotAtEpoch(blockEpoch);
    const targetRoot = slot === targetSlot ? blockRoot : state.blockRoots.get(targetSlot % SLOTS_PER_HISTORICAL_ROOT);

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    const protoBlock: ProtoBlock = {
      slot: slot,
      blockRoot: blockRootHex,
      parentRoot: parentRootHex,
      targetRoot: toRootHex(targetRoot),
      stateRoot: toRootHex(block.stateRoot),
      timeliness: isTimely,

      justifiedEpoch: stateJustifiedEpoch,
      justifiedRoot: toRootHex(state.currentJustifiedCheckpoint.root),
      finalizedEpoch: finalizedCheckpoint.epoch,
      finalizedRoot: toRootHex(state.finalizedCheckpoint.root),
      unrealizedJustifiedEpoch: unrealizedJustifiedCheckpoint.epoch,
      unrealizedJustifiedRoot: unrealizedJustifiedCheckpoint.rootHex,
      unrealizedFinalizedEpoch: unrealizedFinalizedCheckpoint.epoch,
      unrealizedFinalizedRoot: unrealizedFinalizedCheckpoint.rootHex,

      ...(isExecutionBlockBodyType(block.body) && isExecutionStateType(state) && isExecutionEnabled(state, block)
        ? {
            executionPayloadBlockHash: toRootHex(block.body.executionPayload.blockHash),
            executionPayloadNumber: block.body.executionPayload.blockNumber,
            executionStatus: this.getPostMergeExecStatus(executionStatus),
            dataAvailabilityStatus,
          }
        : {
            executionPayloadBlockHash: null,
            executionStatus: this.getPreMergeExecStatus(executionStatus),
            dataAvailabilityStatus: this.getPreMergeDataStatus(dataAvailabilityStatus),
          }),
    };

    this.protoArray.onBlock(protoBlock, currentSlot);

    return protoBlock;
  }

  /**
   * Register `attestation` with the fork choice DAG so that it may influence future calls to `getHead`.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_attestation
   *
   * It only approximates the specification since it does not perform
   * `is_valid_indexed_attestation` since that should already have been called upstream and it's
   * too expensive to call again.
   *
   * ## Notes:
   *
   * The supplied `attestation` **must** pass the `in_valid_indexed_attestation` function as it
   * will not be run here.
   */
  onAttestation(attestation: phase0.IndexedAttestation, attDataRoot: string, forceImport?: boolean): void {
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
    const attestationData = attestation.data;
    const {slot, beaconBlockRoot} = attestationData;
    const blockRootHex = toRootHex(beaconBlockRoot);
    const targetEpoch = attestationData.target.epoch;
    if (ssz.Root.equals(beaconBlockRoot, ZERO_HASH)) {
      return;
    }

    this.validateOnAttestation(attestation, slot, blockRootHex, targetEpoch, attDataRoot, forceImport);

    if (slot < this.fcStore.currentSlot) {
      for (const validatorIndex of attestation.attestingIndices) {
        if (!this.fcStore.equivocatingIndices.has(validatorIndex)) {
          this.addLatestMessage(validatorIndex, targetEpoch, blockRootHex);
        }
      }
    } else {
      // The spec declares:
      //
      // ```
      // Attestations can only affect the fork choice of subsequent slots.
      // Delay consideration in the fork choice until their slot is in the past.
      // ```
      const byRoot = this.queuedAttestations.getOrDefault(slot);
      const validatorIndices = byRoot.getOrDefault(blockRootHex);
      for (const validatorIndex of attestation.attestingIndices) {
        if (!this.fcStore.equivocatingIndices.has(validatorIndex)) {
          validatorIndices.add(validatorIndex);
        }
      }
    }
  }

  /**
   * Small different from the spec:
   * We already call is_slashable_attestation_data() and is_valid_indexed_attestation
   * in state transition so no need to do it again
   */
  onAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): void {
    // TODO: we already call in in state-transition, find a way not to recompute it again
    const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
    for (const validatorIndex of intersectingIndices) {
      this.fcStore.equivocatingIndices.add(validatorIndex);
    }
  }

  getLatestMessage(validatorIndex: ValidatorIndex): LatestMessage | undefined {
    const vote = this.votes[validatorIndex];
    if (vote === undefined) {
      return undefined;
    }
    return {
      epoch: vote.nextEpoch,
      root: vote.nextIndex === null ? HEX_ZERO_HASH : this.protoArray.nodes[vote.nextIndex].blockRoot,
    };
  }

  /**
   * Call `onTick` for all slots between `fcStore.getCurrentSlot()` and the provided `currentSlot`.
   * This should only be called once per slot because:
   *   - calling this multiple times in the same slot does not update `votes`
   *     - new attestations in the current slot must stay in the queue
   *     - new attestations in the old slots are applied to the `votes` already
   *   - also side effect of this function is `validatedAttestationDatas` reseted
   */
  updateTime(currentSlot: Slot): void {
    if (this.fcStore.currentSlot >= currentSlot) return;
    while (this.fcStore.currentSlot < currentSlot) {
      const previousSlot = this.fcStore.currentSlot;
      // Note: we are relying upon `onTick` to update `fcStore.time` to ensure we don't get stuck in a loop.
      this.onTick(previousSlot + 1);
    }

    this.queuedAttestationsPreviousSlot = 0;
    // Process any attestations that might now be eligible.
    this.processAttestationQueue();
    this.validatedAttestationDatas = new Set();
  }

  getTime(): Slot {
    return this.fcStore.currentSlot;
  }

  /** Returns `true` if the block is known **and** a descendant of the finalized root. */
  hasBlock(blockRoot: Root): boolean {
    return this.hasBlockHex(toRootHex(blockRoot));
  }
  /** Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root. */
  getBlock(blockRoot: Root): ProtoBlock | null {
    return this.getBlockHex(toRootHex(blockRoot));
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlockHex(blockRoot: RootHex): boolean {
    const node = this.protoArray.getNode(blockRoot);
    if (node === undefined) {
      return false;
    }

    return this.protoArray.isFinalizedRootOrDescendant(node);
  }

  /**
   * Same to hasBlock but without checking if the block is a descendant of the finalized root.
   */
  hasBlockUnsafe(blockRoot: Root): boolean {
    return this.hasBlockHexUnsafe(toRootHex(blockRoot));
  }

  /**
   * Same to hasBlockHex but without checking if the block is a descendant of the finalized root.
   */
  hasBlockHexUnsafe(blockRoot: RootHex): boolean {
    return this.protoArray.hasBlock(blockRoot);
  }

  /**
   * Returns a MUTABLE `ProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlockHex(blockRoot: RootHex): ProtoBlock | null {
    const node = this.protoArray.getNode(blockRoot);
    if (!node) {
      return null;
    }

    if (!this.protoArray.isFinalizedRootOrDescendant(node)) {
      return null;
    }

    return {
      ...node,
    };
  }

  getJustifiedBlock(): ProtoBlock {
    const block = this.getBlockHex(this.fcStore.justified.checkpoint.rootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: this.fcStore.justified.checkpoint.rootHex,
      });
    }
    return block;
  }

  getFinalizedBlock(): ProtoBlock {
    const block = this.getBlockHex(this.fcStore.finalizedCheckpoint.rootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: this.fcStore.finalizedCheckpoint.rootHex,
      });
    }
    return block;
  }

  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: RootHex, descendantRoot: RootHex): boolean {
    return this.protoArray.isDescendant(ancestorRoot, descendantRoot);
  }

  /**
   * All indices in votes are relative to proto array so always keep it up to date
   */
  prune(finalizedRoot: RootHex): ProtoBlock[] {
    const prunedNodes = this.protoArray.maybePrune(finalizedRoot);
    const prunedCount = prunedNodes.length;
    for (let i = 0; i < this.votes.length; i++) {
      const vote = this.votes[i];
      // validator has never voted
      if (vote === undefined) {
        continue;
      }

      if (vote.currentIndex !== null) {
        if (vote.currentIndex >= prunedCount) {
          vote.currentIndex -= prunedCount;
        } else {
          // the vote was for a pruned proto node
          vote.currentIndex = null;
        }
      }

      if (vote.nextIndex !== null) {
        if (vote.nextIndex >= prunedCount) {
          vote.nextIndex -= prunedCount;
        } else {
          // the vote was for a pruned proto node
          vote.nextIndex = null;
        }
      }
    }
    return prunedNodes;
  }

  setPruneThreshold(threshold: number): void {
    this.protoArray.pruneThreshold = threshold;
  }

  /**
   * Iterates backwards through block summaries, starting from a block root.
   * Return only the non-finalized blocks.
   */
  iterateAncestorBlocks(blockRoot: RootHex): IterableIterator<ProtoBlock> {
    return this.protoArray.iterateAncestorNodes(blockRoot);
  }

  /**
   * Returns all blocks backwards starting from a block root.
   * Return only the non-finalized blocks.
   */
  getAllAncestorBlocks(blockRoot: RootHex): ProtoBlock[] {
    const blocks = this.protoArray.getAllAncestorNodes(blockRoot);
    // the last node is the previous finalized one, it's there to check onBlock finalized checkpoint only.
    return blocks.slice(0, blocks.length - 1);
  }

  /**
   * The same to iterateAncestorBlocks but this gets non-ancestor nodes instead of ancestor nodes.
   */
  getAllNonAncestorBlocks(blockRoot: RootHex): ProtoBlock[] {
    return this.protoArray.getAllNonAncestorNodes(blockRoot);
  }

  getCanonicalBlockAtSlot(slot: Slot): ProtoBlock | null {
    if (slot > this.head.slot) {
      return null;
    }

    if (slot === this.head.slot) {
      return this.head;
    }

    for (const block of this.protoArray.iterateAncestorNodes(this.head.blockRoot)) {
      if (block.slot === slot) {
        return block;
      }
    }
    return null;
  }

  getCanonicalBlockClosestLteSlot(slot: Slot): ProtoBlock | null {
    if (slot >= this.head.slot) {
      return this.head;
    }

    for (const block of this.protoArray.iterateAncestorNodes(this.head.blockRoot)) {
      if (slot >= block.slot) {
        return block;
      }
    }
    return null;
  }

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  forwarditerateAncestorBlocks(): ProtoBlock[] {
    return this.protoArray.nodes;
  }

  *forwardIterateDescendants(blockRoot: RootHex): IterableIterator<ProtoBlock> {
    const rootsInChain = new Set([blockRoot]);

    const blockIndex = this.protoArray.indices.get(blockRoot);
    if (blockIndex === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot,
      });
    }

    for (let i = blockIndex + 1; i < this.protoArray.nodes.length; i++) {
      const node = this.protoArray.nodes[i];
      if (rootsInChain.has(node.parentRoot)) {
        rootsInChain.add(node.blockRoot);
        yield node;
      }
    }
  }

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  getBlockSummariesByParentRoot(parentRoot: RootHex): ProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.parentRoot === parentRoot);
  }

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  getBlockSummariesAtSlot(slot: Slot): ProtoBlock[] {
    const nodes = this.protoArray.nodes;
    const blocksAtSlot: ProtoBlock[] = [];
    for (let i = 0, len = nodes.length; i < len; i++) {
      const node = nodes[i];
      if (node.slot === slot) {
        blocksAtSlot.push(node);
      }
    }
    return blocksAtSlot;
  }

  /** Returns the distance of common ancestor of nodes to the max of the newNode and the prevNode. */
  getCommonAncestorDepth(prevBlock: ProtoBlock, newBlock: ProtoBlock): AncestorResult {
    const prevNode = this.protoArray.getNode(prevBlock.blockRoot);
    const newNode = this.protoArray.getNode(newBlock.blockRoot);
    if (!prevNode || !newNode) {
      return {code: AncestorStatus.BlockUnknown};
    }

    const commonAncestor = this.protoArray.getCommonAncestor(prevNode, newNode);
    // No common ancestor, should never happen. Return null to not throw
    if (!commonAncestor) {
      return {code: AncestorStatus.NoCommonAncenstor};
    }

    // If common node is one of both nodes, then they are direct descendants, return null
    if (commonAncestor.blockRoot === prevNode.blockRoot || commonAncestor.blockRoot === newNode.blockRoot) {
      return {code: AncestorStatus.Descendant};
    }

    return {code: AncestorStatus.CommonAncestor, depth: Math.max(newNode.slot, prevNode.slot) - commonAncestor.slot};
  }

  /**
   * Optimistic sync validate till validated latest hash, invalidate any descendant
   * branch if invalidate till hash provided
   *
   * Proxies to protoArray's validateLatestHash and could run extra validations for the
   * justified's status as well as validate the terminal conditions if terminal block
   * becomes valid
   */
  validateLatestHash(execResponse: LVHExecResponse): void {
    try {
      this.protoArray.validateLatestHash(execResponse, this.fcStore.currentSlot);
    } catch (e) {
      if (e instanceof ProtoArrayError && e.type.code === ProtoArrayErrorCode.INVALID_LVH_EXECUTION_RESPONSE) {
        this.irrecoverableError = e;
      }
    }
  }

  /**
   * A dependent root is the block root of the last block before the state transition that decided a specific shuffling
   *
   * For proposer shuffling with 0 epochs of lookahead = previous immediate epoch transition
   * For attester shuffling with 1 epochs of lookahead = last epoch's epoch transition
   *
   * ```
   *         epoch: 0       1       2       3       4
   *                |-------|-------|=======|-------|
   * dependent root A -------------^
   * dependent root B -----^
   * ```
   * - proposer shuffling for a block in epoch 2: dependent root A (EpochDifference = 0)
   * - attester shuffling for a block in epoch 2: dependent root B (EpochDifference = 1)
   */
  getDependentRoot(block: ProtoBlock, epochDifference: EpochDifference): RootHex {
    // The navigation at the end of the while loop will always progress backwards,
    // jumping to a block with a strictly less slot number. So the condition `blockEpoch < atEpoch`
    // is guaranteed to happen. Given the use of target blocks for faster navigation, it will take
    // at most `2 * (blockEpoch - atEpoch + 1)` iterations to find the dependent root.

    const beforeSlot = block.slot - (block.slot % SLOTS_PER_EPOCH) - epochDifference * SLOTS_PER_EPOCH;

    // Special case close to genesis block, return the genesis block root
    if (beforeSlot <= 0) {
      const genesisBlock = this.protoArray.nodes[0];
      if (genesisBlock === undefined || genesisBlock.slot !== 0) {
        throw Error("Genesis block not available");
      }
      return genesisBlock.blockRoot;
    }

    const finalizedSlot = this.getFinalizedBlock().slot;
    while (block.slot >= finalizedSlot) {
      // Dependant root must be in epoch less than `beforeSlot`
      if (block.slot < beforeSlot) {
        return block.blockRoot;
      }

      // Skip one last jump if there's no skipped slot at first slot of the epoch
      if (block.slot === beforeSlot) {
        return block.parentRoot;
      }

      block =
        block.blockRoot === block.targetRoot
          ? // For the first slot of the epoch, a block is it's own target
            this.protoArray.getBlockReadonly(block.parentRoot)
          : // else we can navigate much faster jumping to the target block
            this.protoArray.getBlockReadonly(block.targetRoot);
    }

    throw Error(`Not found dependent root for block slot ${block.slot}, epoch difference ${epochDifference}`);
  }

  /**
   * Return true if the block is timely for the current slot.
   * Child class can overwrite this for testing purpose.
   */
  protected isBlockTimely(block: BeaconBlock, blockDelaySec: number): boolean {
    const isBeforeAttestingInterval = blockDelaySec < this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT;
    return this.fcStore.currentSlot === block.slot && isBeforeAttestingInterval;
  }

  private getPreMergeExecStatus(executionStatus: MaybeValidExecutionStatus): ExecutionStatus.PreMerge {
    if (executionStatus !== ExecutionStatus.PreMerge)
      throw Error(`Invalid pre-merge execution status: expected: ${ExecutionStatus.PreMerge}, got ${executionStatus}`);
    return executionStatus;
  }

  private getPreMergeDataStatus(dataAvailabilityStatus: DataAvailabilityStatus): DataAvailabilityStatus.PreData {
    if (dataAvailabilityStatus !== DataAvailabilityStatus.PreData)
      throw Error(
        `Invalid pre-merge data status: expected: ${DataAvailabilityStatus.PreData}, got ${dataAvailabilityStatus}`
      );
    return dataAvailabilityStatus;
  }

  private getPostMergeExecStatus(
    executionStatus: MaybeValidExecutionStatus
  ): ExecutionStatus.Valid | ExecutionStatus.Syncing {
    if (executionStatus === ExecutionStatus.PreMerge)
      throw Error(
        `Invalid post-merge execution status: expected: ${ExecutionStatus.Syncing} or ${ExecutionStatus.Valid} , got ${executionStatus}`
      );
    return executionStatus;
  }

  /**
   * Why `getJustifiedBalances` getter?
   * - updateCheckpoints() is called in both on_block and on_tick.
   * - Our cache strategy to get justified balances is incomplete, it can't regen all possible states.
   * - If the justified state is not available it will get one that is "closest" to the justified checkpoint.
   * - As a last resort fallback the state that references the new justified checkpoint is close or equal to the
   *   desired justified state. However, the state is available only in the on_block handler
   * - `getJustifiedBalances` makes the dynamics of justified balances cache easier to reason about
   *
   * **`on_block`**:
   * May need the justified balances of:
   * - justifiedCheckpoint
   * - unrealizedJustifiedCheckpoint
   * These balances are not immediately available so the getter calls a cache fn `() => cache.getBalances()`
   *
   * **`on_tick`**
   * May need the justified balances of:
   * - unrealizedJustified: Already available in `CheckpointHexWithBalance`
   * Since this balances are already available the getter is just `() => balances`, without cache interaction
   */
  private updateCheckpoints(
    justifiedCheckpoint: CheckpointWithHex,
    finalizedCheckpoint: CheckpointWithHex,
    getJustifiedBalances: () => JustifiedBalances
  ): void {
    // Update justified checkpoint.
    if (justifiedCheckpoint.epoch > this.fcStore.justified.checkpoint.epoch) {
      this.fcStore.justified = {checkpoint: justifiedCheckpoint, balances: getJustifiedBalances()};
      this.justifiedProposerBoostScore = null;
    }

    // Update finalized checkpoint.
    if (finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      this.fcStore.finalizedCheckpoint = finalizedCheckpoint;
      this.justifiedProposerBoostScore = null;
    }
  }

  /**
   * Update unrealized checkpoints in store if necessary
   */
  private updateUnrealizedCheckpoints(
    unrealizedJustifiedCheckpoint: CheckpointWithHex,
    unrealizedFinalizedCheckpoint: CheckpointWithHex,
    getJustifiedBalances: () => JustifiedBalances
  ): void {
    if (unrealizedJustifiedCheckpoint.epoch > this.fcStore.unrealizedJustified.checkpoint.epoch) {
      this.fcStore.unrealizedJustified = {
        checkpoint: unrealizedJustifiedCheckpoint,
        balances: getJustifiedBalances(),
      };
    }
    if (unrealizedFinalizedCheckpoint.epoch > this.fcStore.unrealizedFinalizedCheckpoint.epoch) {
      this.fcStore.unrealizedFinalizedCheckpoint = unrealizedFinalizedCheckpoint;
    }
  }

  /**
   * Validates the `indexed_attestation` for application to fork choice.
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#validate_on_attestation
   */
  private validateOnAttestation(
    indexedAttestation: phase0.IndexedAttestation,
    slot: Slot,
    blockRootHex: string,
    targetEpoch: Epoch,
    attDataRoot: string,
    // forceImport attestation even if too old, mostly used in spec tests
    forceImport?: boolean
  ): void {
    // There is no point in processing an attestation with an empty bitfield. Reject
    // it immediately.
    //
    // This is not in the specification, however it should be transparent to other nodes. We
    // return early here to avoid wasting precious resources verifying the rest of it.
    if (!indexedAttestation.attestingIndices.length) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD,
        },
      });
    }

    if (!this.validatedAttestationDatas.has(attDataRoot)) {
      this.validateAttestationData(indexedAttestation.data, slot, blockRootHex, targetEpoch, attDataRoot, forceImport);
    }
  }

  private validateAttestationData(
    attestationData: phase0.AttestationData,
    slot: Slot,
    beaconBlockRootHex: string,
    targetEpoch: Epoch,
    attDataRoot: string,
    // forceImport attestation even if too old, mostly used in spec tests
    forceImport?: boolean
  ): void {
    const epochNow = computeEpochAtSlot(this.fcStore.currentSlot);
    const targetRootHex = toRootHex(attestationData.target.root);

    // Attestation must be from the current of previous epoch.
    if (targetEpoch > epochNow) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.FUTURE_EPOCH,
          attestationEpoch: targetEpoch,
          currentEpoch: epochNow,
        },
      });
    } else if (!forceImport && targetEpoch + 1 < epochNow) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.PAST_EPOCH,
          attestationEpoch: targetEpoch,
          currentEpoch: epochNow,
        },
      });
    }

    if (targetEpoch !== computeEpochAtSlot(slot)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.BAD_TARGET_EPOCH,
          target: targetEpoch,
          slot,
        },
      });
    }

    // Attestation target must be for a known block.
    //
    // We do not delay the block for later processing to reduce complexity and DoS attack
    // surface.
    if (!this.protoArray.hasBlock(targetRootHex)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT,
          root: targetRootHex,
        },
      });
    }

    // Load the block for `attestation.data.beacon_block_root`.
    //
    // This indirectly checks to see if the `attestation.data.beacon_block_root` is in our fork
    // choice. Any known, non-finalized block should be in fork choice, so this check
    // immediately filters out attestations that attest to a block that has not been processed.
    //
    // Attestations must be for a known block. If the block is unknown, we simply drop the
    // attestation and do not delay consideration for later.
    const block = this.protoArray.getBlock(beaconBlockRootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK,
          beaconBlockRoot: beaconBlockRootHex,
        },
      });
    }

    // If an attestation points to a block that is from an earlier slot than the attestation,
    // then all slots between the block and attestation must be skipped. Therefore if the block
    // is from a prior epoch to the attestation, then the target root must be equal to the root
    // of the block that is being attested to.
    const expectedTargetHex = targetEpoch > computeEpochAtSlot(block.slot) ? beaconBlockRootHex : block.targetRoot;

    if (expectedTargetHex !== targetRootHex) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.INVALID_TARGET,
          attestation: targetRootHex,
          local: expectedTargetHex,
        },
      });
    }

    // Attestations must not be for blocks in the future. If this is the case, the attestation
    // should not be considered.
    if (block.slot > slot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK,
          block: block.slot,
          attestation: slot,
        },
      });
    }

    this.validatedAttestationDatas.add(attDataRoot);
  }

  /**
   * Add a validator's latest message to the tracked votes
   */
  private addLatestMessage(validatorIndex: ValidatorIndex, nextEpoch: Epoch, nextRoot: RootHex): void {
    const vote = this.votes[validatorIndex];
    // should not happen, attestation is validated before this step
    const nextIndex = this.protoArray.indices.get(nextRoot);
    if (nextIndex === undefined) {
      throw new Error(`Could not find proto index for nextRoot ${nextRoot}`);
    }

    if (vote === undefined) {
      this.votes[validatorIndex] = {
        currentIndex: null,
        nextIndex,
        nextEpoch,
      };
    } else if (nextEpoch > vote.nextEpoch) {
      vote.nextIndex = nextIndex;
      vote.nextEpoch = nextEpoch;
    }
    // else its an old vote, don't count it
  }

  /**
   * Processes and removes from the queue any queued attestations which may now be eligible for
   * processing due to the slot clock incrementing.
   */
  private processAttestationQueue(): void {
    const currentSlot = this.fcStore.currentSlot;
    for (const [slot, byRoot] of this.queuedAttestations.entries()) {
      const targetEpoch = computeEpochAtSlot(slot);
      if (slot < currentSlot) {
        this.queuedAttestations.delete(slot);
        for (const [blockRoot, validatorIndices] of byRoot.entries()) {
          const blockRootHex = blockRoot;
          for (const validatorIndex of validatorIndices) {
            // equivocatingIndices was checked in onAttestation
            this.addLatestMessage(validatorIndex, targetEpoch, blockRootHex);
          }

          if (slot === currentSlot - 1) {
            this.queuedAttestationsPreviousSlot += validatorIndices.size;
          }
        }
      } else {
        break;
      }
    }
  }

  /**
   * Called whenever the current time increases.
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#on_tick
   */
  private onTick(time: Slot): void {
    const previousSlot = this.fcStore.currentSlot;

    if (time > previousSlot + 1) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INCONSISTENT_ON_TICK,
        previousSlot,
        time,
      });
    }

    // Update store time
    this.fcStore.currentSlot = time;
    // Reset proposer boost if this is a new slot.
    if (this.proposerBoostRoot) {
      // Since previous weight was boosted, we need would now need to recalculate the scores without the boost
      this.proposerBoostRoot = null;
    }

    // Not a new epoch, return.
    if (computeSlotsSinceEpochStart(time) !== 0) {
      return;
    }

    // If a new epoch, pull-up justification and finalization from previous epoch
    this.updateCheckpoints(
      this.fcStore.unrealizedJustified.checkpoint,
      this.fcStore.unrealizedFinalizedCheckpoint,
      () => this.fcStore.unrealizedJustified.balances
    );
  }

  /**
   *
   * Common logic of get_proposer_head() and should_override_forkchoice_update()
   * No one should be calling this function except these two
   *
   */
  private getPreliminaryProposerHead(
    headBlock: ProtoBlock,
    parentBlock: ProtoBlock,
    slot: Slot
  ): {prelimProposerHead: ProtoBlock; prelimNotReorgedReason?: NotReorgedReason} {
    let prelimProposerHead = headBlock;
    // No reorg if headBlock is on time
    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_head_late
    const isHeadLate = !headBlock.timeliness;
    if (!isHeadLate) {
      return {prelimProposerHead, prelimNotReorgedReason: NotReorgedReason.HeadBlockIsTimely};
    }

    // No reorg if we are at epoch boundary where proposer shuffling could change
    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_shuffling_stable
    const isShufflingStable = slot % SLOTS_PER_EPOCH !== 0;
    if (!isShufflingStable) {
      return {prelimProposerHead, prelimNotReorgedReason: NotReorgedReason.NotShufflingStable};
    }

    // No reorg if headBlock and parentBlock are not ffg competitive
    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_ffg_competitive
    const {unrealizedJustifiedEpoch: headBlockCpEpoch, unrealizedJustifiedRoot: headBlockCpRoot} = headBlock;
    const {unrealizedJustifiedEpoch: parentBlockCpEpoch, unrealizedJustifiedRoot: parentBlockCpRoot} = parentBlock;
    const isFFGCompetitive = headBlockCpEpoch === parentBlockCpEpoch && headBlockCpRoot === parentBlockCpRoot;
    if (!isFFGCompetitive) {
      return {prelimProposerHead, prelimNotReorgedReason: NotReorgedReason.NotFFGCompetitive};
    }

    // No reorg if chain is not finalizing within REORG_MAX_EPOCHS_SINCE_FINALIZATION
    // https://github.com/ethereum/consensus-specs/blob/v1.4.0-beta.4/specs/phase0/fork-choice.md#is_finalization_ok
    const epochsSinceFinalization = computeEpochAtSlot(slot) - this.getFinalizedCheckpoint().epoch;
    const isFinalizationOk = epochsSinceFinalization <= this.config.REORG_MAX_EPOCHS_SINCE_FINALIZATION;
    if (!isFinalizationOk) {
      return {prelimProposerHead, prelimNotReorgedReason: NotReorgedReason.ChainLongUnfinality};
    }

    // No reorg if this reorg spans more than a single slot
    const parentSlotOk = parentBlock.slot + 1 === headBlock.slot;
    if (!parentSlotOk) {
      return {prelimProposerHead, prelimNotReorgedReason: NotReorgedReason.ParentBlockDistanceMoreThanOneSlot};
    }

    prelimProposerHead = parentBlock;

    return {prelimProposerHead};
  }
}

/**
 * This function checks the terminal pow conditions on the merge block as
 * specified in the config either via TTD or TBH. This function is part of
 * forkChoice because if the merge block was previously imported as syncing
 * and the EL eventually signals it catching up via validateLatestHash
 * the specs mandates validating terminal conditions on the previously
 * imported merge block.
 */
export function assertValidTerminalPowBlock(
  config: ChainConfig,
  block: bellatrix.BeaconBlock,
  preCachedData: {
    executionStatus: ExecutionStatus.Syncing | ExecutionStatus.Valid;
    powBlock?: PowBlockHex | null;
    powBlockParent?: PowBlockHex | null;
  }
): void {
  if (!ssz.Root.equals(config.TERMINAL_BLOCK_HASH, ZERO_HASH)) {
    if (computeEpochAtSlot(block.slot) < config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH)
      throw Error(`Terminal block activation epoch ${config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH} not reached`);

    // powBock.blockHash is hex, so we just pick the corresponding root
    if (!ssz.Root.equals(block.body.executionPayload.parentHash, config.TERMINAL_BLOCK_HASH))
      throw new Error(
        `Invalid terminal block hash, expected: ${toRootHex(config.TERMINAL_BLOCK_HASH)}, actual: ${toRootHex(
          block.body.executionPayload.parentHash
        )}`
      );
  } else {
    // If no TERMINAL_BLOCK_HASH override, check ttd

    // Delay powBlock checks if the payload execution status is unknown because of
    // syncing response in notifyNewPayload call while verifying
    if (preCachedData?.executionStatus === ExecutionStatus.Syncing) return;

    const {powBlock, powBlockParent} = preCachedData;
    if (!powBlock) throw Error("onBlock preCachedData must include powBlock");
    // if powBlock is genesis don't assert powBlockParent
    if (!powBlockParent && powBlock.parentHash !== HEX_ZERO_HASH)
      throw Error("onBlock preCachedData must include powBlockParent");

    const isTotalDifficultyReached = powBlock.totalDifficulty >= config.TERMINAL_TOTAL_DIFFICULTY;
    // If we don't have powBlockParent here, powBlock is the genesis and as we would have errored above
    // we can mark isParentTotalDifficultyValid as valid
    const isParentTotalDifficultyValid =
      !powBlockParent || powBlockParent.totalDifficulty < config.TERMINAL_TOTAL_DIFFICULTY;
    if (!isTotalDifficultyReached) {
      throw Error(
        `Invalid terminal POW block: total difficulty not reached expected >= ${config.TERMINAL_TOTAL_DIFFICULTY}, actual = ${powBlock.totalDifficulty}`
      );
    } else if (!isParentTotalDifficultyValid) {
      throw Error(
        `Invalid terminal POW block parent: expected < ${config.TERMINAL_TOTAL_DIFFICULTY}, actual = ${powBlockParent.totalDifficulty}`
      );
    }
  }
}
// Approximate https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/fork-choice.md#calculate_committee_fraction
// Calculates proposer boost score when committeePercent = config.PROPOSER_SCORE_BOOST
export function getCommitteeFraction(
  justifiedTotalActiveBalanceByIncrement: number,
  config: {slotsPerEpoch: number; committeePercent: number}
): number {
  const committeeWeight = Math.floor(justifiedTotalActiveBalanceByIncrement / config.slotsPerEpoch);
  return Math.floor((committeeWeight * config.committeePercent) / 100);
}
