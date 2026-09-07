import {ChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MIN_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  IBeaconStateView,
  ZERO_HASH,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getAttesterSlashableIndices,
  isExecutionBlockBodyType,
  isStatePostBellatrix,
} from "@lodestar/state-transition";
import {
  AttesterSlashing,
  BeaconBlock,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  Slot,
  ValidatorIndex,
  isGloasBeaconBlock,
  phase0,
  ssz,
} from "@lodestar/types";
import {Logger, MapDef, fromHex, toRootHex, withObservedDuration} from "@lodestar/utils";
import {ForkChoiceMetrics} from "../metrics.js";
import {computeDeltas} from "../protoArray/computeDeltas.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "../protoArray/errors.js";
import {
  BlockExecutionStatus,
  ExecutionStatus,
  HEX_ZERO_HASH,
  LVHExecResponse,
  NULL_VOTE_INDEX,
  PayloadExecutionStatus,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  VoteIndex,
  isGloasBlock,
} from "../protoArray/interface.js";
import {ProtoArray} from "../protoArray/protoArray.js";
import {ForkChoiceError, ForkChoiceErrorCode, InvalidAttestationCode, InvalidBlockCode} from "./errors.js";
import {
  type FastConfirmationContext,
  FastConfirmationRule,
  FastConfirmationSteps,
  type IFastConfirmationRule,
  type IFastConfirmationSpecStore,
} from "./fastConfirmation/fastConfirmationRule.js";
import {
  AncestorResult,
  AncestorStatus,
  EpochDifference,
  IForkChoice,
  NotReorgedReason,
  ShouldOverrideForkChoiceUpdateResult,
} from "./interface.js";
import {CheckpointWithHex, IForkChoiceStore, JustifiedBalances, toCheckpointWithHex} from "./store.js";

export type ForkChoiceOpts = {
  proposerBoost?: boolean;
  proposerBoostReorg?: boolean;
  computeUnrealized?: boolean;
  fastConfirmation?: boolean;
};

const EFFECTIVE_BALANCE_INCREMENT_BIGINT = BigInt(EFFECTIVE_BALANCE_INCREMENT);

export enum UpdateHeadOpt {
  GetCanonicalHead = "getCanonicalHead", // Skip getProposerHead
  GetProposerHead = "getProposerHead", // With getProposerHead
  GetPredictedProposerHead = "getPredictedProposerHead", // With predictProposerHead
}

export type UpdateAndGetHeadOpt =
  | {mode: UpdateHeadOpt.GetCanonicalHead}
  | {mode: UpdateHeadOpt.GetProposerHead; secFromSlot: number; slot: Slot}
  | {mode: UpdateHeadOpt.GetPredictedProposerHead; secFromSlot: number; slot: Slot};

// the initial vote epoch for all validators
const INIT_VOTE_SLOT: Slot = 0;

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
   * Votes currently tracked in the protoArray. Instead of tracking a VoteTracker of currentIndex, nextIndex and epoch,
   * we decompose the struct and track them in separate arrays for performance reason.
   *
   * For Gloas (ePBS), LatestMessage tracks slot instead of epoch and includes payload_present flag.
   * Spec: gloas/fork-choice.md#modified-latestmessage
   *
   * IMPORTANT: voteCurrentIndices and voteNextIndices point to the EXACT variant node index.
   * The payload status is encoded in the node index itself (different variants have different indices).
   * For example, if a validator votes for the EMPTY variant, voteNextIndices[i] points to that specific EMPTY node.
   */
  private readonly voteCurrentIndices: VoteIndex[];
  private readonly voteNextIndices: VoteIndex[];
  private readonly voteNextSlots: Slot[];

  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   *
   * Modified for Gloas to track PayloadStatus per validator.
   * Maps: Slot -> BlockRoot -> ValidatorIndex -> PayloadStatus
   */
  private readonly queuedAttestations: MapDef<Slot, MapDef<RootHex, Map<ValidatorIndex, PayloadStatus>>> = new MapDef(
    () => new MapDef(() => new Map())
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
  private justifiedProposerBoostScore: bigint | null = null;
  /** The current effective balances */
  private balances: EffectiveBalanceIncrements;
  /** Optional fast confirmation rule implementation */
  private readonly fastConfirmationRule?: IFastConfirmationRule;
  private readonly fastConfirmationContext?: FastConfirmationContext;
  private fastConfirmationPaused = false;
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
    validatorCount: number,
    readonly metrics: ForkChoiceMetrics | null,
    private readonly opts?: ForkChoiceOpts,
    private readonly logger?: Logger
  ) {
    // initialize votes, they will grow in addLatestMessage() function below
    this.voteCurrentIndices = new Array(validatorCount).fill(NULL_VOTE_INDEX);
    this.voteNextIndices = new Array(validatorCount).fill(NULL_VOTE_INDEX);
    // when compute deltas, we ignore epoch if voteNextIndex is NULL_VOTE_INDEX anyway

    this.voteNextSlots = new Array(validatorCount).fill(0);

    this.head = this.updateHead();
    this.balances = this.fcStore.justified.balances;

    if (this.opts?.fastConfirmation) {
      this.fastConfirmationRule = new FastConfirmationRule(this.fcStore, metrics, this.logger);
      this.fastConfirmationContext = this.createFastConfirmationContext();
      metrics?.fastConfirmation.paused.set(0);
    }

    metrics?.forkChoice.votes.addCollect(() => {
      metrics.forkChoice.votes.set(this.voteNextSlots.length);
      metrics.forkChoice.queuedAttestations.set(this.queuedAttestationsPreviousSlot);
      metrics.forkChoice.validatedAttestationDatas.set(this.validatedAttestationDatas.size);
      metrics.forkChoice.balancesLength.set(this.balances.length);
      metrics.forkChoice.nodes.set(this.protoArray.nodes.length);
      metrics.forkChoice.indices.set(this.protoArray.indices.size);
    });
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
  getAncestor(blockRoot: RootHex, ancestorSlot: Slot): ProtoNode {
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

  getConfirmedRoot(): RootHex {
    return this.fastConfirmationRule?.getConfirmedRoot() ?? this.fcStore.justified.checkpoint.rootHex;
  }

  getFastConfirmationStore(): IFastConfirmationSpecStore {
    return {
      confirmedRoot: this.getConfirmedRoot(),
      previousEpochObservedJustifiedCheckpoint: this.fcStore.previousEpochObservedJustifiedCheckpoint,
      currentEpochObservedJustifiedCheckpoint: this.fcStore.currentEpochObservedJustifiedCheckpoint,
      previousEpochGreatestUnrealizedCheckpoint: this.fcStore.previousEpochGreatestUnrealizedCheckpoint,
      previousSlotHead: this.fcStore.previousSlotHead,
      currentSlotHead: this.fcStore.currentSlotHead,
    };
  }

  getConfirmedBlock(): ProtoBlock | null {
    return this.getBlockHexDefaultStatus(this.getConfirmedRoot());
  }

  resumeFastConfirmation(): void {
    this.toggleFastConfirmation(false);
  }

  pauseFastConfirmation(): void {
    this.toggleFastConfirmation(true);
  }

  private toggleFastConfirmation(paused: boolean): void {
    if (!this.fastConfirmationRule) return;
    if (paused === this.fastConfirmationPaused) return;
    this.fastConfirmationPaused = paused;
    if (paused) {
      // Pin immediately: block imports report the safe block hash to the EL before the next slot tick
      this.fcStore.confirmedRoot = this.fcStore.finalizedCheckpoint.rootHex;
      try {
        this.notifyConfirmedRoot();
      } catch (err) {
        // Callers run in clock/network handler context with no catch above
        this.logger?.debug("Fast confirmation notify failed", {slot: this.fcStore.currentSlot}, err as Error);
      }
    }
    this.metrics?.fastConfirmation.paused.set(paused ? 1 : 0);
    this.logger?.info(paused ? "Paused fast confirmation" : "Resumed fast confirmation", {
      slot: this.fcStore.currentSlot,
    });
  }

  private notifyConfirmedRoot(): void {
    const confirmedRoot = this.fcStore.confirmedRoot;
    const confirmedBlock = this.getBlockHexDefaultStatus(confirmedRoot);
    if (confirmedBlock === null) {
      throw new Error(`Fast confirmation produced root not in protoArray: ${confirmedRoot}`);
    }
    this.fcStore.notifyFastConfirmation?.({
      block: confirmedRoot,
      slot: confirmedBlock.slot,
      currentSlot: this.fcStore.currentSlot,
    });
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

    const canonicalHeadBlock = mode === UpdateHeadOpt.GetPredictedProposerHead ? this.getHead() : this.updateHead();
    switch (mode) {
      case UpdateHeadOpt.GetPredictedProposerHead:
        return {head: this.predictProposerHead(canonicalHeadBlock, opt.secFromSlot, opt.slot)};
      case UpdateHeadOpt.GetProposerHead: {
        const {
          proposerHead: head,
          isHeadTimely,
          notReorgedReason,
        } = this.getProposerHead(canonicalHeadBlock, opt.secFromSlot, opt.slot);
        return {head, isHeadTimely, notReorgedReason};
      }
      case UpdateHeadOpt.GetCanonicalHead:
        return {head: canonicalHeadBlock};
      default:
        return {head: canonicalHeadBlock};
    }
  }

  // Called by `predictProposerHead` and `importBlock`. If the result is not same as blockRoot's block, return true else false
  // See https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/bellatrix/fork-choice.md#should_override_forkchoice_update
  // Return true if the given block passes all criteria to be re-orged out
  // Return false otherwise.
  // Note when proposer boost reorg is disabled, it always returns false
  shouldOverrideForkChoiceUpdate(
    headBlock: ProtoBlock,
    secFromSlot: number,
    currentSlot: Slot
  ): ShouldOverrideForkChoiceUpdateResult {
    if (headBlock === null) {
      // should not happen because this block just got imported. Fall back to no-reorg.
      return {shouldOverrideFcu: false, reason: NotReorgedReason.HeadBlockNotAvailable};
    }
    const {proposerBoost, proposerBoostReorg} = this.opts ?? {};
    // Skip re-org attempt if proposer boost (reorg) are disabled
    if (!proposerBoost || !proposerBoostReorg) {
      this.logger?.verbose("Skip shouldOverrideForkChoiceUpdate check since the related flags are disabled", {
        slot: currentSlot,
        proposerBoost,
        proposerBoostReorg,
      });
      return {shouldOverrideFcu: false, reason: NotReorgedReason.ProposerBoostReorgDisabled};
    }

    const parentBlock = this.protoArray.getBlock(
      headBlock.parentRoot,
      this.protoArray.getParentPayloadStatus(headBlock)
    );
    const proposalSlot = headBlock.slot + 1;

    // No reorg if parentBlock isn't available
    if (parentBlock === undefined) {
      return {shouldOverrideFcu: false, reason: NotReorgedReason.ParentBlockNotAvailable};
    }

    const currentTimeOk =
      headBlock.slot === currentSlot ||
      (proposalSlot === currentSlot && this.isProposingOnTime(secFromSlot, currentSlot));

    // Mirror the proposer equivocation branch of getProposerHead(). The head slot's attestations are
    // still queued at this point so the head is assumed weak, same as for the regular branch below.
    if (currentTimeOk && this.isProposerEquivocation(headBlock)) {
      this.logger?.verbose("Head proposer equivocated. Should override forkchoice update", {
        blockRoot: headBlock.blockRoot,
        slot: currentSlot,
        proposerIndex: headBlock.proposerIndex,
      });
      return {shouldOverrideFcu: true, parentBlock};
    }

    const {prelimProposerHead, prelimNotReorgedReason} = this.getPreliminaryProposerHead(
      headBlock,
      parentBlock,
      proposalSlot
    );

    if (prelimProposerHead === headBlock) {
      return {shouldOverrideFcu: false, reason: prelimNotReorgedReason ?? NotReorgedReason.Unknown};
    }

    if (!currentTimeOk) {
      return {shouldOverrideFcu: false, reason: NotReorgedReason.ReorgMoreThanOneSlot};
    }

    this.logger?.verbose("Block is weak. Should override forkchoice update", {
      blockRoot: headBlock.blockRoot,
      slot: currentSlot,
    });
    return {shouldOverrideFcu: true, parentBlock};
  }

  /**
   * Get the proposer boost root
   */
  getProposerBoostRoot(): RootHex {
    return this.proposerBoostRoot ?? HEX_ZERO_HASH;
  }

  getPreviousProposerBoostRoot(): RootHex {
    return this.protoArray.getPreviousProposerBoostRoot();
  }

  /**
   * Decides whether to extend an available payload from the previous slot,
   * corresponding to the beacon block `blockRoot`.
   */
  shouldExtendPayload(blockRoot: RootHex): boolean {
    return this.protoArray.shouldExtendPayload(blockRoot, this.proposerBoostRoot);
  }

  /** Spec: should_build_on_full(store, head, slot) */
  shouldBuildOnFull(head: ProtoBlock, slot: Slot): boolean {
    return this.protoArray.shouldBuildOnFull(head, slot);
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
   */
  predictProposerHead(headBlock: ProtoBlock, secFromSlot: number, currentSlot: Slot): ProtoBlock {
    const {proposerBoost, proposerBoostReorg} = this.opts ?? {};
    // Skip re-org attempt if proposer boost (reorg) are disabled
    if (!proposerBoost || !proposerBoostReorg) {
      this.logger?.verbose("No proposer boost reorg prediction since the related flags are disabled", {
        slot: currentSlot,
        proposerBoost,
        proposerBoostReorg,
      });
      return headBlock;
    }

    const blockRoot = headBlock.blockRoot;
    const result = this.shouldOverrideForkChoiceUpdate(headBlock, secFromSlot, currentSlot);

    if (result.shouldOverrideFcu) {
      this.logger?.verbose("Current head is weak. Predicting next block to be built on parent of head.", {
        slot: currentSlot,
        proposerHead: result.parentBlock.blockRoot,
        weakHead: blockRoot,
      });
      return result.parentBlock;
    }

    this.logger?.verbose("Current head is strong. Predicting next block to be built on head", {
      slot: currentSlot,
      head: headBlock.blockRoot,
      reason: result.reason,
    });

    return headBlock;
  }

  /**
   *
   * This function takes in the canonical head block and determine the proposer head (canonical head block or its parent)
   * https://github.com/ethereum/consensus-specs/pull/3034 for info about proposer boost reorg
   * This function should only be called during block proposal and only be called after `updateHead()` in `updateAndGetHead()`
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/phase0/fork-choice.md#get_proposer_head
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/fork-choice.md#modified-get_proposer_head
   */
  getProposerHead(
    headBlock: ProtoBlock,
    secFromSlot: number,
    slot: Slot
  ): {proposerHead: ProtoBlock; isHeadTimely: boolean; notReorgedReason?: NotReorgedReason} {
    const isHeadTimely = headBlock.timeliness;
    let proposerHead = headBlock;

    // Skip re-org attempt if proposer boost (reorg) are disabled
    const {proposerBoost, proposerBoostReorg} = this.opts ?? {};
    if (!proposerBoost || !proposerBoostReorg) {
      this.logger?.verbose("No proposer boost reorg attempt since the related flags are disabled", {
        slot,
        proposerBoost,
        proposerBoostReorg,
      });
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ProposerBoostReorgDisabled};
    }

    const parentBlock = this.protoArray.getBlock(
      headBlock.parentRoot,
      this.protoArray.getParentPayloadStatus(headBlock)
    );

    // No reorg if parentBlock isn't available
    if (parentBlock === undefined) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotAvailable};
    }

    // Half of single_slot_reorg check in the spec is done in getPreliminaryProposerHead()
    const currentTimeOk = headBlock.slot + 1 === slot;
    const isProposerBoostWornOff = this.proposerBoostRoot !== headBlock.blockRoot;

    // Re-org more aggressively if there is a proposer equivocation in the previous slot, skipping the
    // regular reorg conditions. Any known equivocation counts here, timely or not.
    if (
      currentTimeOk &&
      isProposerBoostWornOff &&
      this.isProposerEquivocation(headBlock) &&
      this.isHeadWeak(headBlock.blockRoot)
    ) {
      this.logger?.verbose("Performing single-slot reorg to remove weak head of equivocating proposer", {
        slot,
        proposerHead: parentBlock.blockRoot,
        weakHead: headBlock.blockRoot,
        proposerIndex: headBlock.proposerIndex,
      });
      proposerHead = parentBlock;

      return {proposerHead, isHeadTimely};
    }

    const {prelimProposerHead, prelimNotReorgedReason} = this.getPreliminaryProposerHead(headBlock, parentBlock, slot);

    if (prelimProposerHead === headBlock && prelimNotReorgedReason !== undefined) {
      return {proposerHead, isHeadTimely, notReorgedReason: prelimNotReorgedReason};
    }

    // Only re-org if we are proposing on-time
    if (!this.isProposingOnTime(secFromSlot, slot)) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.NotProposingOnTime};
    }

    // No reorg if attempted reorg is more than a single slot
    if (!currentTimeOk) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ReorgMoreThanOneSlot};
    }

    // No reorg if proposer boost is still in effect
    if (!isProposerBoostWornOff) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ProposerBoostNotWornOff};
    }

    // No reorg if headBlock is "not weak" ie. headBlock's weight exceeds (REORG_HEAD_WEIGHT_THRESHOLD = 20)% of total attester weight
    if (!this.isHeadWeak(headBlock.blockRoot)) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.HeadBlockNotWeak};
    }

    // No reorg if parentBlock is "not strong" ie. parentBlock's weight is less than or equal to (REORG_PARENT_WEIGHT_THRESHOLD = 160)% of total attester weight
    if (!this.isParentStrong(parentBlock.blockRoot)) {
      return {proposerHead, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotStrong};
    }

    // Reorg if all above checks fail
    this.logger?.verbose("Performing single-slot reorg to remove current weak head", {
      slot,
      proposerHead: parentBlock.blockRoot,
      weakHead: headBlock.blockRoot,
    });
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
    const computeDeltasMetrics = this.metrics?.forkChoice.computeDeltas;

    const timer = computeDeltasMetrics?.duration.startTimer();
    const {
      attestationDeltas,
      equivocatingValidators,
      oldInactiveValidators,
      newInactiveValidators,
      unchangedVoteValidators,
      newVoteValidators,
    } = computeDeltas(
      this.protoArray.nodes.length,
      this.voteCurrentIndices,
      this.voteNextIndices,
      oldBalances,
      newBalances,
      this.fcStore.equivocatingIndices
    );
    timer?.();

    computeDeltasMetrics?.deltasCount.set(attestationDeltas.length);
    computeDeltasMetrics?.zeroDeltasCount.set(attestationDeltas.filter((d) => d === 0).length);
    computeDeltasMetrics?.equivocatingValidators.set(equivocatingValidators);
    computeDeltasMetrics?.oldInactiveValidators.set(oldInactiveValidators);
    computeDeltasMetrics?.newInactiveValidators.set(newInactiveValidators);
    computeDeltasMetrics?.unchangedVoteValidators.set(unchangedVoteValidators);
    computeDeltasMetrics?.newVoteValidators.set(newVoteValidators);

    this.balances = newBalances;

    const currentSlot = this.fcStore.currentSlot;
    const checkpoints = {
      justifiedEpoch: this.fcStore.justified.checkpoint.epoch,
      justifiedRoot: this.fcStore.justified.checkpoint.rootHex,
      finalizedEpoch: this.fcStore.finalizedCheckpoint.epoch,
      finalizedRoot: this.fcStore.finalizedCheckpoint.rootHex,
      currentSlot,
    };

    const boostedBlock =
      this.opts?.proposerBoost && this.proposerBoostRoot ? this.getBlockHexDefaultStatus(this.proposerBoostRoot) : null;

    if (boostedBlock && isGloasBlock(boostedBlock)) {
      // should_apply_proposer_boost judges the parent against the attestations known to the store,
      // via is_head_weak (which also assumes equivocators' votes were already discounted before
      // their balance is added back). Apply the attestation deltas first so the decision reads
      // post-delta scores, then apply the boost in a second pass.
      // TODO GLOAS: applyScoreChanges() updates weights and best child/descendant in one call;
      // splitting them would let the two passes update weights and recompute best child/descendant
      // once at the end.
      // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/fork-choice.md#new-should_apply_proposer_boost
      this.protoArray.applyScoreChanges({attestationDeltas, proposerBoost: null, ...checkpoints});
      const proposerBoost = this.shouldApplyProposerBoost() ? this.getProposerBoost() : null;
      // The first pass already rolled back the previous boost and left a coherent tree, so a
      // withheld boost needs no second pass
      if (proposerBoost !== null) {
        this.protoArray.applyScoreChanges({
          attestationDeltas: new Array<number>(this.protoArray.nodes.length).fill(0),
          proposerBoost,
          ...checkpoints,
        });
      }
    } else {
      // Pre-gloas the boost is unconditional, so attestation deltas and boost deltas can propagate
      // up the branch in a single pass
      this.protoArray.applyScoreChanges({
        attestationDeltas,
        proposerBoost: boostedBlock ? this.getProposerBoost() : null,
        ...checkpoints,
      });
    }

    // findHead returns the ProtoNode representing the head
    const head = this.protoArray.findHead(this.fcStore.justified.checkpoint.rootHex, currentSlot);

    this.head = head;
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

  getCanonicalPayloadCounts(fromSlot: Slot, toSlot: Slot, head: ProtoBlock): {full: number; empty: number} {
    return this.protoArray.getCanonicalPayloadCounts(fromSlot, toSlot, head.blockRoot, head.payloadStatus);
  }

  /** Very expensive function, iterates the entire ProtoArray. Called only in debug API */
  getHeads(): ProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.bestChild === undefined);
  }

  /** Returns exact Gwei weights for the compliance test. */
  getViableHeads(): {root: RootHex; payloadStatus: PayloadStatus; weight: bigint}[] {
    return this.protoArray.getViableHeads(this.fcStore.currentSlot);
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
    state: IBeaconStateView,
    receiveDelaySec: number,
    importDelaySec: number,
    currentSlot: Slot,
    executionStatus: BlockExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): ProtoBlock {
    const {parentRoot, slot} = block;
    const parentRootHex = toRootHex(parentRoot);
    // Parent block must be known because state_transition would have failed otherwise.
    const parentHashHex = isGloasBeaconBlock(block)
      ? toRootHex(block.body.signedExecutionPayloadBid.message.parentBlockHash)
      : null;
    const parentBlock = this.protoArray.getParent(parentRootHex, parentHashHex);
    if (!parentBlock) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.UNKNOWN_PARENT,
          root: parentRootHex,
          hash: parentHashHex,
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
    const blockAncestorNode = this.getAncestor(parentRootHex, finalizedSlot);
    const fcStoreFinalized = this.fcStore.finalizedCheckpoint;
    if (blockAncestorNode.blockRoot !== fcStoreFinalized.rootHex) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT,
          finalizedRoot: fcStoreFinalized.rootHex,
          blockAncestor: blockAncestorNode.blockRoot,
        },
      });
    }

    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(blockRoot);

    // Decide whether this block should receive proposer boost, and whether the block is timely.
    // The store field `this.proposerBoostRoot` and `updateCheckpoints()` are mutated only after
    // `protoArray.onBlock()` succeeds
    const isTimely = this.isBlockReceivedTimely(block, receiveDelaySec);
    const isProposerBoostBlock =
      this.opts?.proposerBoost === true &&
      isTimely &&
      // only boost the first block we see
      this.proposerBoostRoot === null &&
      this.isProposerBoostSameDependentRoot(this.head.blockRoot, parentRootHex);
    // Candidate boost root used for protoArray.onBlock's best-child weighting. Committed to the
    // store only after the insertion succeeds.
    const proposerBoostRoot = isProposerBoostBlock ? blockRootHex : this.proposerBoostRoot;

    const justifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const stateJustifiedEpoch = justifiedCheckpoint.epoch;

    const finalizedCheckpoint = toCheckpointWithHex(state.finalizedCheckpoint);

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
        const unrealized = state.computeUnrealizedCheckpoints();
        unrealizedJustifiedCheckpoint = toCheckpointWithHex(unrealized.justifiedCheckpoint);
        unrealizedFinalizedCheckpoint = toCheckpointWithHex(unrealized.finalizedCheckpoint);
      }
    } else {
      unrealizedJustifiedCheckpoint = justifiedCheckpoint;
      unrealizedFinalizedCheckpoint = finalizedCheckpoint;
    }

    const targetSlot = computeStartSlotAtEpoch(blockEpoch);
    const targetRoot = slot === targetSlot ? blockRoot : state.getBlockRootAtSlot(targetSlot);

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    const protoBlock: ProtoBlock = {
      slot: slot,
      blockRoot: blockRootHex,
      parentRoot: parentRootHex,
      targetRoot: toRootHex(targetRoot),
      stateRoot: toRootHex(block.stateRoot),
      timeliness: isTimely,
      ptcTimeliness: this.isBlockPtcTimely(block, receiveDelaySec),
      importedTimely: this.isBlockImportedTimely(block, importDelaySec),
      proposerIndex: block.proposerIndex,

      justifiedEpoch: stateJustifiedEpoch,
      justifiedRoot: toRootHex(state.currentJustifiedCheckpoint.root),
      finalizedEpoch: finalizedCheckpoint.epoch,
      finalizedRoot: toRootHex(state.finalizedCheckpoint.root),
      unrealizedJustifiedEpoch: unrealizedJustifiedCheckpoint.epoch,
      unrealizedJustifiedRoot: unrealizedJustifiedCheckpoint.rootHex,
      unrealizedFinalizedEpoch: unrealizedFinalizedCheckpoint.epoch,
      unrealizedFinalizedRoot: unrealizedFinalizedCheckpoint.rootHex,

      ...(isGloasBeaconBlock(block)
        ? (() => {
            // post-gloas, we don't know payload hash until we import execution payload. Set to
            // parent payload hash for now, along with the gas limit/number of that parent payload
            // (which is what bids built on top of this block will reference until a payload arrives).
            // we also use parent hash to pass to EL via fcu
            // see https://github.com/ethereum/consensus-specs/pull/5197
            const parentBlockHashFromBid = toRootHex(block.body.signedExecutionPayloadBid.message.parentBlockHash);

            // Inherit parent payload's (number, gasLimit) for the PENDING/EMPTY variants.
            // `parentBlock` is already the variant matching `parentBlockHashFromBid` —
            // `getParent` (called above) resolves Gloas parents via
            // `getBlockHexAndBlockHash(parentRoot, parentBlockHash)`, and pre-Gloas parents
            // have a single variant. Pre-merge parents have null payload hash and zero values.
            const parentMeta: {number: number; gasLimit: number} =
              parentBlock.executionPayloadBlockHash === null
                ? {number: 0, gasLimit: 0}
                : {number: parentBlock.executionPayloadNumber, gasLimit: parentBlock.executionPayloadGasLimit};

            return {
              executionPayloadBlockHash: parentBlockHashFromBid,
              executionPayloadNumber: parentMeta.number,
              executionPayloadGasLimit: parentMeta.gasLimit,
              executionStatus: this.getPostMergeExecStatus(executionStatus),
              dataAvailabilityStatus,
            };
          })()
        : isExecutionBlockBodyType(block.body) &&
            isStatePostBellatrix(state) &&
            state.isExecutionStateType &&
            state.isExecutionEnabled(block)
          ? {
              executionPayloadBlockHash: toRootHex(block.body.executionPayload.blockHash),
              executionPayloadNumber: block.body.executionPayload.blockNumber,
              executionPayloadGasLimit: block.body.executionPayload.gasLimit,
              executionStatus: this.getPostMergeExecStatus(executionStatus),
              dataAvailabilityStatus,
            }
          : {
              executionPayloadBlockHash: null,
              executionStatus: this.getPreMergeExecStatus(executionStatus),
              dataAvailabilityStatus: this.getPreMergeDataStatus(dataAvailabilityStatus),
            }),

      payloadStatus: isGloasBeaconBlock(block) ? PayloadStatus.PENDING : PayloadStatus.FULL,
      parentBlockHash: parentHashHex,
    };

    this.protoArray.onBlock(protoBlock, currentSlot, proposerBoostRoot);

    if (isProposerBoostBlock) {
      this.proposerBoostRoot = blockRootHex;
    }

    // Justified balances for `justifiedCheckpoint` are new to the fork-choice. Compute them on
    // demand only if the justified checkpoint changes.
    this.updateCheckpoints(justifiedCheckpoint, finalizedCheckpoint, () =>
      this.fcStore.justifiedBalancesGetter(justifiedCheckpoint, state)
    );

    // Un-realized checkpoints. Update best known unrealized justified & finalized checkpoints
    this.updateUnrealizedCheckpoints(unrealizedJustifiedCheckpoint, unrealizedFinalizedCheckpoint, () =>
      this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state)
    );

    // If block is from past epochs, try to update store's justified & finalized checkpoints right away
    if (blockEpoch < computeEpochAtSlot(currentSlot)) {
      this.updateCheckpoints(unrealizedJustifiedCheckpoint, unrealizedFinalizedCheckpoint, () =>
        this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state)
      );
    }

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
  onAttestation(attestation: IndexedAttestation, attDataRoot: string, forceImport?: boolean): void {
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

    // Determine which variant the attestation supports
    //
    // Pre-gloas: payload is always present, vote goes to FULL.
    // Post-gloas:
    //   - block.slot < message.slot: EMPTY if data.index is 0 and FULL if data.index is 1.
    //   - else: PENDING
    //
    // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/gloas/fork-choice.md#modified-get_supported_node
    let payloadStatus: PayloadStatus;
    const block = this.getBlockHexDefaultStatus(blockRootHex);

    if (block && isGloasBlock(block)) {
      // Post-Gloas block: determine FULL/EMPTY/PENDING based on slot and committee index
      // If slot > block.slot, we can determine FULL or EMPTY. Else always PENDING
      if (slot > block.slot) {
        if (attestationData.index === 1) {
          payloadStatus = PayloadStatus.FULL;
        } else if (attestationData.index === 0) {
          payloadStatus = PayloadStatus.EMPTY;
        } else {
          throw new ForkChoiceError({
            code: ForkChoiceErrorCode.INVALID_ATTESTATION,
            err: {
              code: InvalidAttestationCode.INVALID_DATA_INDEX,
              index: attestationData.index,
            },
          });
        }
      } else {
        payloadStatus = PayloadStatus.PENDING;
      }
    } else {
      // Pre-Gloas block or block not found: always FULL
      payloadStatus = PayloadStatus.FULL;
    }

    if (slot < this.fcStore.currentSlot) {
      for (const validatorIndex of attestation.attestingIndices) {
        if (!this.fcStore.equivocatingIndices.has(validatorIndex)) {
          this.addLatestMessage(validatorIndex, slot, blockRootHex, payloadStatus);
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
      const validatorVotes = byRoot.getOrDefault(blockRootHex);
      for (const validatorIndex of attestation.attestingIndices) {
        if (!this.fcStore.equivocatingIndices.has(validatorIndex)) {
          validatorVotes.set(validatorIndex, payloadStatus);
        }
      }
    }
  }

  /**
   * Small different from the spec:
   * We already call is_slashable_attestation_data() and is_valid_indexed_attestation
   * in state transition so no need to do it again
   */
  onAttesterSlashing(attesterSlashing: AttesterSlashing): void {
    // TODO: we already call in in state-transition, find a way not to recompute it again
    const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
    for (const validatorIndex of intersectingIndices) {
      this.fcStore.equivocatingIndices.add(validatorIndex);
    }
  }

  /**
   * Process a PTC (Payload Timeliness Committee) message
   * Updates the PTC votes for multiple validators attesting to a block
   * Spec: gloas/fork-choice.md#new-on_payload_attestation_message
   */
  notifyPtcMessages(
    blockRoot: RootHex,
    slot: Slot,
    ptcIndices: number[],
    payloadPresent: boolean,
    blobDataAvailable: boolean
  ): void {
    this.protoArray.notifyPtcMessages(blockRoot, slot, ptcIndices, payloadPresent, blobDataAvailable);
  }

  /**
   * Notify fork choice that an execution payload has arrived (Gloas fork)
   * Creates the FULL variant of a Gloas block when the payload becomes available
   * Spec: gloas/fork-choice.md#new-on_execution_payload
   */
  onExecutionPayload(
    blockRoot: RootHex,
    executionPayloadBlockHash: RootHex,
    executionPayloadNumber: number,
    executionPayloadGasLimit: number,
    executionStatus: PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): void {
    this.protoArray.onExecutionPayload(
      blockRoot,
      this.fcStore.currentSlot,
      executionPayloadBlockHash,
      executionPayloadNumber,
      executionPayloadGasLimit,
      this.proposerBoostRoot,
      executionStatus,
      dataAvailabilityStatus
    );
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
      const didUpdateCheckpoints = this.onTick(previousSlot + 1);
      this.queuedAttestationsPreviousSlot = 0;
      // Process any attestations that might now be eligible before running FCR for this slot.
      this.processAttestationQueue();
      const didRecomputeHead = this.runFastConfirmation();

      // An epoch-boundary checkpoint pull-up can move the head's dependent root and stale the cached
      // head before block 0 of the new epoch is imported, making isProposerBoostSameDependentRoot()
      // wrong for that block. Recompute the head so it reflects the new checkpoint and the queued
      // votes — unless fast confirmation already did, to avoid a redundant head calculation.
      if (didUpdateCheckpoints && !didRecomputeHead) {
        this.updateHead();
      }

      this.validatedAttestationDatas = new Set();
    }
  }

  getTime(): Slot {
    return this.fcStore.currentSlot;
  }

  /** Returns `true` if the block is known **and** a descendant of the finalized root. */
  hasBlock(blockRoot: Root): boolean {
    return this.hasBlockHex(toRootHex(blockRoot));
  }
  /** Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root. */
  getBlock(blockRoot: Root, payloadStatus: PayloadStatus): ProtoBlock | null {
    return this.getBlockHex(toRootHex(blockRoot), payloadStatus);
  }

  getBlockDefaultStatus(blockRoot: Root): ProtoBlock | null {
    return this.getBlockHexDefaultStatus(toRootHex(blockRoot));
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   * Uses default variant (PENDING for Gloas, FULL for pre-Gloas).
   */
  hasBlockHex(blockRoot: RootHex): boolean {
    const defaultStatus = this.protoArray.getDefaultVariant(blockRoot);
    const node = defaultStatus !== undefined ? this.protoArray.getNode(blockRoot, defaultStatus) : undefined;
    if (node === undefined) {
      return false;
    }

    return this.protoArray.isFinalizedRootOrDescendant(node);
  }

  /**
   * Same as hasBlock but without checking if the block is a descendant of the finalized root.
   */
  hasBlockUnsafe(blockRoot: Root): boolean {
    return this.hasBlockHexUnsafe(toRootHex(blockRoot));
  }

  /**
   * Same as hasBlockHex but without checking if the block is a descendant of the finalized root.
   */
  hasBlockHexUnsafe(blockRoot: RootHex): boolean {
    return this.protoArray.hasBlock(blockRoot);
  }

  /**
   * Returns true if the FULL payload variant (execution payload envelope) exists for this block root,
   * without checking if the block is a descendant of the finalized root.
   */
  hasPayloadUnsafe(blockRoot: Root): boolean {
    return this.hasPayloadHexUnsafe(toRootHex(blockRoot));
  }

  /**
   * Same as hasPayloadUnsafe but accepts a hex-encoded block root.
   */
  hasPayloadHexUnsafe(blockRoot: RootHex): boolean {
    return this.protoArray.hasPayload(blockRoot);
  }

  getPTCVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    const votes = this.protoArray.getPTCVotes(blockRootHex);
    if (votes === null) return null;
    return votes.toBoolArray().map((v) => v ?? null);
  }

  getPTCVoteCounts(blockRootHex: RootHex): {
    attesterCount: number;
    payloadPresentCount: number;
    dataAvailableCount: number;
  } | null {
    return this.protoArray.getPTCVoteCounts(blockRootHex);
  }

  getPayloadTimelinessVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    return this.protoArray.getPayloadTimelinessVotes(blockRootHex);
  }

  getPayloadDataAvailabilityVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    return this.protoArray.getPayloadDataAvailabilityVotes(blockRootHex);
  }

  getUnrealizedJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.unrealizedJustified.checkpoint;
  }

  getUnrealizedFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.unrealizedFinalizedCheckpoint;
  }

  /**
   * Returns a MUTABLE `ProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlockHex(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock | null {
    const node = this.protoArray.getNode(blockRoot, payloadStatus);
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

  /**
   * Returns a `ProtoBlock` with the default variant for the given block root
   * - Pre-Gloas blocks: returns FULL variant (only variant)
   * - Gloas blocks: returns PENDING variant
   *
   * Use this when you need the canonical block reference regardless of payload status.
   * For searching by execution payload hash and variant-specific info, use `getBlockHexAndBlockHash` instead.
   */
  getBlockHexDefaultStatus(blockRoot: RootHex): ProtoBlock | null {
    const defaultStatus = this.protoArray.getDefaultVariant(blockRoot);
    if (defaultStatus === undefined) {
      return null;
    }

    return this.getBlockHex(blockRoot, defaultStatus);
  }

  /**
   * Returns EMPTY or FULL `ProtoBlock` that has matching block root and block hash
   */
  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null {
    return this.protoArray.getBlockHexAndBlockHash(blockRoot, blockHash);
  }

  getJustifiedBlock(): ProtoBlock {
    const {rootHex} = this.fcStore.justified.checkpoint;
    const block = this.getBlockHexDefaultStatus(rootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: rootHex,
      });
    }
    return block;
  }

  getFinalizedBlock(): ProtoBlock {
    const {rootHex} = this.fcStore.finalizedCheckpoint;
    const block = this.getBlockHexDefaultStatus(rootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: rootHex,
      });
    }
    return block;
  }

  getFinalizedCheckpointSlot(): Slot {
    const finalizedEpoch = this.fcStore.finalizedCheckpoint.epoch;
    return computeStartSlotAtEpoch(finalizedEpoch);
  }

  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(
    ancestorRoot: RootHex,
    ancestorPayloadStatus: PayloadStatus,
    descendantRoot: RootHex,
    descendantPayloadStatus: PayloadStatus
  ): boolean {
    return this.protoArray.isDescendant(ancestorRoot, ancestorPayloadStatus, descendantRoot, descendantPayloadStatus);
  }

  /**
   * All indices in votes are relative to proto array so always keep it up to date
   */
  prune(finalizedRoot: RootHex): ProtoBlock[] {
    const prunedNodes = this.protoArray.maybePrune(finalizedRoot);
    const prunedCount = prunedNodes.length;
    for (let i = 0; i < this.voteNextSlots.length; i++) {
      const currentIndex = this.voteCurrentIndices[i];

      if (currentIndex !== NULL_VOTE_INDEX) {
        if (currentIndex >= prunedCount) {
          this.voteCurrentIndices[i] = currentIndex - prunedCount;
        } else {
          // the vote was for a pruned proto node
          this.voteCurrentIndices[i] = NULL_VOTE_INDEX;
        }
      }

      const nextIndex = this.voteNextIndices[i];

      if (nextIndex !== NULL_VOTE_INDEX) {
        if (nextIndex >= prunedCount) {
          this.voteNextIndices[i] = nextIndex - prunedCount;
        } else {
          // the vote was for a pruned proto node
          this.voteNextIndices[i] = NULL_VOTE_INDEX;
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
  iterateAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): IterableIterator<ProtoBlock> {
    return this.protoArray.iterateAncestorNodes(blockRoot, payloadStatus);
  }

  /**
   * Raw ancestor walk from `blockRoot` back toward the previous finalized block. Includes both
   * `blockRoot` and the previous-finalized boundary as last element. Mirrors the semantics of
   * `getAllAncestorAndNonAncestorBlocks.ancestors`
   */
  getAllAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock[] {
    return this.protoArray.getAllAncestorNodes(blockRoot, payloadStatus);
  }

  /**
   * The same to iterateAncestorBlocks but this gets non-ancestor nodes instead of ancestor nodes.
   */
  getAllNonAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock[] {
    return this.protoArray.getAllNonAncestorNodes(blockRoot, payloadStatus);
  }

  /**
   * Returns both ancestor and non-ancestor blocks in a single traversal.
   *
   * `ancestors` is the raw walk and includes the previous finalized block as its last element —
   * callers that don't want the boundary should slice it off themselves.
   * Post-gloas for each block root, it returns exactly one variant of it.
   */
  getAllAncestorAndNonAncestorBlocks(
    blockRoot: RootHex,
    payloadStatus: PayloadStatus
  ): {ancestors: ProtoBlock[]; nonAncestors: ProtoBlock[]} {
    return this.protoArray.getAllAncestorAndNonAncestorNodes(blockRoot, payloadStatus);
  }

  /**
   * Same to getAllAncestorAndNonAncestorBlocks with default variant of ${blockRoot} to start with
   */
  getAllAncestorAndNonAncestorBlocksDefaultStatus(blockRoot: RootHex): {
    ancestors: ProtoBlock[];
    nonAncestors: ProtoBlock[];
  } {
    const defaultStatus = this.protoArray.getDefaultVariant(blockRoot);
    if (defaultStatus === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot,
      });
    }
    return this.getAllAncestorAndNonAncestorBlocks(blockRoot, defaultStatus);
  }

  getCanonicalBlockByRoot(blockRoot: Root): ProtoBlock | null {
    const blockRootHex = toRootHex(blockRoot);
    if (blockRootHex === this.head.blockRoot) {
      return this.head;
    }

    for (const block of this.protoArray.iterateAncestorNodes(this.head.blockRoot, this.head.payloadStatus)) {
      if (block.blockRoot === blockRootHex) {
        return block;
      }
    }

    return null;
  }

  getCanonicalBlockAtSlot(slot: Slot): ProtoBlock | null {
    if (slot > this.head.slot) {
      return null;
    }

    if (slot === this.head.slot) {
      return this.head;
    }

    for (const block of this.protoArray.iterateAncestorNodes(this.head.blockRoot, this.head.payloadStatus)) {
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

    for (const block of this.protoArray.iterateAncestorNodes(this.head.blockRoot, this.head.payloadStatus)) {
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

  *forwardIterateDescendants(blockRoot: RootHex, payloadStatus: PayloadStatus): IterableIterator<ProtoBlock> {
    const rootsInChain = new Set([blockRoot]);
    const blockIndex = this.protoArray.getNodeIndexByRootAndStatus(blockRoot, payloadStatus);
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

  forwardIterateDescendantsDefaultStatus(blockRoot: RootHex): IterableIterator<ProtoBlock> {
    const defaultStatus = this.protoArray.getDefaultVariant(blockRoot);
    if (defaultStatus === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot,
      });
    }
    return this.forwardIterateDescendants(blockRoot, defaultStatus);
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
    const prevNode = this.protoArray.getNode(prevBlock.blockRoot, prevBlock.payloadStatus);
    const newNode = this.protoArray.getNode(newBlock.blockRoot, newBlock.payloadStatus);
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

      // For the first slot of the epoch, a block is it's own target
      const nextRoot = block.blockRoot === block.targetRoot ? block.parentRoot : block.targetRoot;
      // Use default variant (PENDING for Gloas, FULL for pre-Gloas)
      // For Gloas: we search for PENDING blocks because dependent root is determined by the block itself,
      // not the payload. In state-transition, block parentage is independent of payload status,
      // so linking by PENDING block in fork-choice is correct.
      const defaultStatus = this.protoArray.getDefaultVariant(nextRoot);
      if (defaultStatus === undefined) {
        throw Error(`No block for root ${nextRoot}`);
      }
      block = this.protoArray.getBlockReadonly(nextRoot, defaultStatus);
    }

    throw Error(`Not found dependent root for block slot ${block.slot}, epoch difference ${epochDifference}`);
  }

  /**
   * Spec: phase0/fork-choice.md#update_proposer_boost_root (`is_same_dependent_root` condition, added in
   * https://github.com/ethereum/consensus-specs/pull/5306). Proposer boost is only granted when the imported
   * block shares the same proposer-shuffling dependent root for the current epoch as the canonical head
   * computed before the block was imported. This withholds the boost from a block built on a different
   * shuffling branch than the head.
   *
   * The block is not yet in the proto-array when this runs, so its dependent root is traced from
   * its parent
   */
  private isProposerBoostSameDependentRoot(headRootHex: RootHex, blockParentRootHex: RootHex): boolean {
    const epoch = computeEpochAtSlot(this.fcStore.currentSlot);
    // Genesis block parent
    if (epoch <= MIN_SEED_LOOKAHEAD) {
      return true;
    }

    const dependentSlot = computeStartSlotAtEpoch(epoch - MIN_SEED_LOOKAHEAD) - 1;
    const headDependentRoot = this.protoArray.getAncestorOrNull(headRootHex, dependentSlot)?.blockRoot;
    const blockDependentRoot = this.protoArray.getAncestorOrNull(blockParentRootHex, dependentSlot)?.blockRoot;
    // On lookup failure, we lean on the conservative side and withold the boost
    if (headDependentRoot === undefined || blockDependentRoot === undefined) {
      return false;
    }

    return headDependentRoot === blockDependentRoot;
  }

  /**
   * Return true if the block is "weak" ie. its weight is below REORG_HEAD_WEIGHT_THRESHOLD of the
   * total attester weight per slot.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/phase0/fork-choice.md#is_head_weak
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.11/specs/gloas/fork-choice.md#modified-is_head_weak
   */
  private isHeadWeak(blockRoot: RootHex): boolean {
    // The default variant is PENDING for gloas, FULL pre-gloas. PENDING is the variant gloas measures
    // support on, ie. support for the beacon block root regardless of its payload status.
    // Only ever called on a block already in fork choice, so a miss is a broken invariant.
    const node = this.protoArray.getNodeDefaultStatus(blockRoot);
    if (node === undefined) {
      // this is called for head or the boosted block's parent, both of which should always be
      // in forkchoice, otherwise we have a serious error
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }

    const reorgThreshold = getCommitteeFraction(this.fcStore.justified.totalBalance, {
      slotsPerEpoch: SLOTS_PER_EPOCH,
      committeePercent: this.config.REORG_HEAD_WEIGHT_THRESHOLD,
    });

    if (!isForkPostGloas(this.config.getForkName(node.slot))) {
      return node.weight < reorgThreshold;
    }

    let headWeight = node.attestationScore;

    const {equivocatingIndices} = this.fcStore;
    // Equivocators are extremely rare (none in normal operation), and with none the added weight is
    // always 0. Return before fetching the state and walking the block's committees.
    if (equivocatingIndices.size > 0) {
      const state = this.fcStore.stateGetter({stateRoot: node.stateRoot});
      // Only ever called on the head or the boosted block's parent, so the state is always cached.
      // A miss is a broken invariant, not a recoverable state.
      if (state === null) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.BEACON_STATE_ERROR,
          error: new Error(`Missing state for isHeadWeak, blockRoot=${blockRoot} stateRoot=${node.stateRoot}`),
        });
      }

      const epoch = computeEpochAtSlot(node.slot);
      for (let index = 0; index < state.getBeaconCommitteeCountPerSlot(epoch); index++) {
        for (const validatorIndex of state.getBeaconCommittee(node.slot, index)) {
          if (equivocatingIndices.has(validatorIndex)) {
            // the spec specifies to use effective_balance of the justified state
            let balance = this.fcStore.justified.balances[validatorIndex];
            if (!balance) {
              // 0 (zeroed by getEffectiveBalanceIncrementsZeroInactive) or undefined (validator not in
              // the justified state) - fall back to the head state's effective balance
              balance = state.effectiveBalanceIncrements[validatorIndex];
            }
            headWeight += BigInt(balance) * EFFECTIVE_BALANCE_INCREMENT_BIGINT;
          }
        }
      }
    }

    return headWeight < reorgThreshold;
  }

  /**
   * Return true if the parent block is "strong" ie. its weight exceeds REORG_PARENT_WEIGHT_THRESHOLD
   * of the total attester weight per slot.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/phase0/fork-choice.md#is_parent_strong
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/gloas/fork-choice.md#modified-is_parent_strong
   */
  private isParentStrong(parentRoot: RootHex): boolean {
    const node = this.protoArray.getNodeDefaultStatus(parentRoot);
    // If parentNode is unavailable, give up reorg
    if (node === undefined) {
      return false;
    }

    const parentThreshold = getCommitteeFraction(this.fcStore.justified.totalBalance, {
      slotsPerEpoch: SLOTS_PER_EPOCH,
      committeePercent: this.config.REORG_PARENT_WEIGHT_THRESHOLD,
    });

    // pre-gloas uses get_weight() (boost-inclusive), gloas uses get_attestation_score() (boost-excluded)
    const parentWeight = isForkPostGloas(this.config.getForkName(node.slot)) ? node.attestationScore : node.weight;
    return parentWeight > parentThreshold;
  }

  /**
   * Return true if the block is timely for the current slot.
   * Child class can overwrite this for testing purpose.
   */
  protected isBlockReceivedTimely(block: BeaconBlock, blockDelaySec: number): boolean {
    const fork = this.config.getForkName(block.slot);
    const isBeforeLateBlockCutoff = blockDelaySec * 1000 < this.config.getAttestationDueMs(fork);
    return this.fcStore.currentSlot === block.slot && isBeforeLateBlockCutoff;
  }

  /**
   * Return true if the block arrived before the PTC (payload-timeliness committee) deadline,
   * ie. block_timeliness[PTC_TIMELINESS_INDEX]. should_apply_proposer_boost uses this as the
   * definition of an "early" proposer equivocation: only a sibling seen by the PTC deadline
   * proves the proposer equivocated soon enough that honest nodes could have withheld the boost.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/fork-choice.md#modified-record_block_timeliness
   *
   * Child class can overwrite this for testing purpose.
   */
  protected isBlockPtcTimely(block: BeaconBlock, blockDelaySec: number): boolean {
    const ptcThresholdMs = this.config.getSlotComponentDurationMs(this.config.PAYLOAD_ATTESTATION_DUE_BPS);
    return this.fcStore.currentSlot === block.slot && blockDelaySec * 1000 < ptcThresholdMs;
  }

  /**
   * Return true if THIS node finished importing the block before the attestation cutoff, ie. the
   * block was imported in a timely manner for its own slot.
   * This is not part of the spec, we use this to determine late canonical blocks.
   */
  protected isBlockImportedTimely(block: BeaconBlock, importDelaySec: number): boolean {
    const fork = this.config.getForkName(block.slot);
    const isBeforeLateBlockCutoff = importDelaySec * 1000 < this.config.getAttestationDueMs(fork);
    return this.fcStore.currentSlot === block.slot && isBeforeLateBlockCutoff;
  }

  /**
   * Determine whether proposer boost should be applied to `proposerBoostRoot`.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/fork-choice.md#new-should_apply_proposer_boost
   *
   * Pre-gloas blocks always receive the boost (unconditional, backward compatible). For gloas
   * blocks the boost is withheld when the parent is a weak block from the previous slot and the
   * proposer of that parent equivocated (published another PTC-timely block at the same slot).
   */
  private shouldApplyProposerBoost(): boolean {
    if (!this.proposerBoostRoot) {
      return false;
    }

    const boostedBlock = this.getBlockHexDefaultStatus(this.proposerBoostRoot);
    // Pre-gloas blocks always get boost
    if (!boostedBlock || !isGloasBlock(boostedBlock)) {
      return true;
    }

    const parentBlock = this.getBlockHexDefaultStatus(boostedBlock.parentRoot);
    if (!parentBlock) {
      return true;
    }

    // Apply proposer boost if parent is not from the previous slot
    if (parentBlock.slot + 1 < boostedBlock.slot) {
      return true;
    }

    // Apply proposer boost if parent is not weak
    if (!this.isHeadWeak(parentBlock.blockRoot)) {
      return true;
    }

    // Parent is weak and from the previous slot: apply boost only if there are no early
    // equivocations, ie. no other PTC-timely block at the parent's slot from the same proposer.
    return !this.protoArray.hasEquivocatingBlock(
      parentBlock.proposerIndex,
      parentBlock.slot,
      parentBlock.blockRoot,
      // Only a sibling seen before the PTC deadline counts. A late released one might not have been
      // seen by the proposer, so it cannot be expected to reorg it and is not denied the boost for it.
      true
    );
  }

  /**
   * Return true if another block at the same slot from the same proposer is known to fork choice.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/phase0/fork-choice.md#is_proposer_equivocation
   */
  private isProposerEquivocation(block: ProtoBlock): boolean {
    // Any known sibling counts, timely or not. Timeliness only matters for withholding the boost from
    // the next proposer, the reorg itself is safe to attempt whenever the equivocation is visible.
    return this.protoArray.hasEquivocatingBlock(block.proposerIndex, block.slot, block.blockRoot, false);
  }

  /**
   * The proposer boost to apply to `proposerBoostRoot`, propagated up the branch by
   * applyScoreChanges() together with the deltas.
   */
  private getProposerBoost(): {root: RootHex; score: bigint} | null {
    if (!this.proposerBoostRoot) {
      return null;
    }

    const proposerBoostScore =
      this.justifiedProposerBoostScore ??
      getCommitteeFraction(this.fcStore.justified.totalBalance, {
        slotsPerEpoch: SLOTS_PER_EPOCH,
        committeePercent: this.config.PROPOSER_SCORE_BOOST,
      });
    this.justifiedProposerBoostScore = proposerBoostScore;

    return {root: this.proposerBoostRoot, score: proposerBoostScore};
  }

  /**
   * https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/phase0/fork-choice.md#is_proposing_on_time
   */
  private isProposingOnTime(secFromSlot: number, slot: Slot): boolean {
    const fork = this.config.getForkName(slot);
    const proposerReorgCutoff = this.config.getProposerReorgCutoffMs(fork);
    return secFromSlot * 1000 <= proposerReorgCutoff;
  }

  private getPreMergeExecStatus(executionStatus: BlockExecutionStatus): ExecutionStatus.PreMerge {
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
    executionStatus: BlockExecutionStatus
  ): ExecutionStatus.Valid | ExecutionStatus.Syncing {
    if (executionStatus === ExecutionStatus.PreMerge)
      throw Error(
        `Invalid post-merge execution status: expected: ${ExecutionStatus.Syncing} or ${ExecutionStatus.Valid}, got ${executionStatus}`
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
   * - unrealizedJustified: Already available in `CheckpointWithBalance`
   * Since this balances are already available the getter is just `() => balances`, without cache interaction
   *
   * @returns Whether either checkpoint was updated.
   */
  private updateCheckpoints(
    justifiedCheckpoint: CheckpointWithHex,
    finalizedCheckpoint: CheckpointWithHex,
    getJustifiedBalances: () => JustifiedBalances
  ): boolean {
    let updated = false;

    // Update justified checkpoint.
    if (justifiedCheckpoint.epoch > this.fcStore.justified.checkpoint.epoch) {
      this.fcStore.justified = {checkpoint: justifiedCheckpoint, balances: getJustifiedBalances()};
      this.justifiedProposerBoostScore = null;
      updated = true;
    }

    // Update finalized checkpoint.
    if (finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      this.fcStore.finalizedCheckpoint = finalizedCheckpoint;
      this.justifiedProposerBoostScore = null;
      updated = true;
    }

    return updated;
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
    indexedAttestation: IndexedAttestation,
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
    }

    if (!forceImport && targetEpoch + 1 < epochNow) {
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
    // We don't care which variant it is, just need to find the block
    const defaultStatus = this.protoArray.getDefaultVariant(beaconBlockRootHex);
    const block = defaultStatus !== undefined ? this.protoArray.getBlock(beaconBlockRootHex, defaultStatus) : undefined;
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

    if (isGloasBlock(block)) {
      // For Gloas blocks, attestation index must be 0 or 1
      if (attestationData.index !== 0 && attestationData.index !== 1) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {
            code: InvalidAttestationCode.INVALID_DATA_INDEX,
            index: attestationData.index,
          },
        });
      }

      // Same-slot attestations can only vote for the PENDING variant
      if (block.slot === slot && attestationData.index !== 0) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {
            code: InvalidAttestationCode.INVALID_DATA_INDEX,
            index: attestationData.index,
          },
        });
      }

      // If attesting for a full node, the payload must be known
      if (attestationData.index === 1) {
        const fullNodeIndex = this.protoArray.getNodeIndexByRootAndStatus(beaconBlockRootHex, PayloadStatus.FULL);
        if (fullNodeIndex === undefined) {
          throw new ForkChoiceError({
            code: ForkChoiceErrorCode.INVALID_ATTESTATION,
            err: {
              code: InvalidAttestationCode.UNKNOWN_PAYLOAD_STATUS,
              beaconBlockRoot: beaconBlockRootHex,
            },
          });
        }
      }
    }

    this.validatedAttestationDatas.add(attDataRoot);
  }

  /**
   * Add a validator's latest message to the tracked votes.
   * Always sync voteCurrentIndices and voteNextIndices so that it'll not throw in computeDeltas()
   *
   * Modified for Gloas to accept slot and payloadPresent.
   * Spec: gloas/fork-choice.md#modified-update_latest_messages
   *
   * For backward compatibility with Fulu (pre-Gloas):
   * - Accepts both epoch-derived and slot parameters
   * - payloadPresent defaults to true for Fulu (payloads embedded in blocks)
   */
  private addLatestMessage(
    validatorIndex: ValidatorIndex,
    nextSlot: Slot,
    nextRoot: RootHex,
    nextPayloadStatus: PayloadStatus
  ): void {
    // should not happen, attestation is validated before this step
    // Get the node index for the voted block
    const nextIndex = this.protoArray.getNodeIndexByRootAndStatus(nextRoot, nextPayloadStatus);
    if (nextIndex === undefined) {
      throw new Error(`Could not find proto index for nextRoot ${nextRoot} with payloadStatus ${nextPayloadStatus}`);
    }

    // ensure there is no undefined entries in Votes arrays
    if (this.voteNextSlots.length < validatorIndex + 1) {
      for (let i = this.voteNextSlots.length; i < validatorIndex + 1; i++) {
        this.voteNextSlots[i] = INIT_VOTE_SLOT;
        this.voteCurrentIndices[i] = this.voteNextIndices[i] = NULL_VOTE_INDEX;
      }
    }

    const existingNextSlot = this.voteNextSlots[validatorIndex];
    if (existingNextSlot === INIT_VOTE_SLOT || computeEpochAtSlot(nextSlot) > computeEpochAtSlot(existingNextSlot)) {
      // nextIndex is transfered to currentIndex in computeDeltas()
      this.voteNextIndices[validatorIndex] = nextIndex;
      this.voteNextSlots[validatorIndex] = nextSlot;
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
      if (slot < currentSlot) {
        this.queuedAttestations.delete(slot);
        for (const [blockRoot, validatorVotes] of byRoot.entries()) {
          const blockRootHex = blockRoot;
          for (const [validatorIndex, payloadStatus] of validatorVotes.entries()) {
            // equivocatingIndices was checked in onAttestation
            this.addLatestMessage(validatorIndex, slot, blockRootHex, payloadStatus);
          }

          if (slot === currentSlot - 1) {
            this.queuedAttestationsPreviousSlot += validatorVotes.size;
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
   *
   * @returns Whether an epoch-boundary checkpoint was updated.
   */
  private onTick(time: Slot): boolean {
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
      return false;
    }

    // If a new epoch, pull-up justification and finalization from previous epoch.
    return this.updateCheckpoints(
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

    const isShufflingStable = isForkPostFulu(this.config.getForkName(slot)) || slot % SLOTS_PER_EPOCH !== 0;
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

  /** Returns whether it recomputed the head, so the caller can avoid a redundant `updateHead()`. */
  private runFastConfirmation(): boolean {
    const fastConfirmationRule = this.fastConfirmationRule;
    const fastConfirmationContext = this.fastConfirmationContext;
    if (!fastConfirmationRule || !fastConfirmationContext) return false;

    if (this.fastConfirmationPaused) {
      // Keep consumers on a safe, available root while the rule is paused
      this.fcStore.confirmedRoot = this.fcStore.finalizedCheckpoint.rootHex;
      try {
        this.notifyConfirmedRoot();
      } catch (err) {
        // Runs outside the timed try/catch below; a throw would escape to the clock listener
        this.logger?.debug("Fast confirmation notify failed", {slot: this.fcStore.currentSlot}, err as Error);
      }
      return false;
    }

    withObservedDuration(this.metrics?.fastConfirmation.totalDuration.startTimer(), () => {
      try {
        withObservedDuration(
          this.metrics?.fastConfirmation.stepsDuration.startTimer({
            step: FastConfirmationSteps.updateHead,
          }),
          () => this.updateHead()
        );

        const result = fastConfirmationRule.onSlotStartAfterPastAttestationsApplied(fastConfirmationContext);
        this.fcStore.confirmedRoot = result.confirmedRoot;
        this.notifyConfirmedRoot();
      } catch (err) {
        this.logger?.debug(
          "Fast confirmation failed",
          {slot: this.fcStore.currentSlot, head: this.head.blockRoot, confirmedRoot: this.fcStore.confirmedRoot},
          err as Error
        );
      }
    });

    return true;
  }

  private createFastConfirmationContext(): FastConfirmationContext {
    const confirmationByzantineThreshold = this.config.CONFIRMATION_BYZANTINE_THRESHOLD;
    if (!confirmationByzantineThreshold) {
      throw new Error("CONFIRMATION_BYZANTINE_THRESHOLD must be set to use fast confirmation");
    }

    return {
      config: {
        CONFIRMATION_BYZANTINE_THRESHOLD: confirmationByzantineThreshold,
        PROPOSER_SCORE_BOOST: this.config.PROPOSER_SCORE_BOOST,
      },
      getCurrentSlot: () => this.fcStore.currentSlot,
      getHead: () => this.head,
      getBlock: (root: RootHex) => this.getBlockHexDefaultStatus(root),
      getAncestor: (root: RootHex, slot: Slot) => this.getAncestor(root, slot).blockRoot,
      isDescendant: (ancestor: RootHex, descendant: RootHex) => {
        const ancestorStatus = this.protoArray.getDefaultVariant(ancestor);
        const descendantStatus = this.protoArray.getDefaultVariant(descendant);
        if (ancestorStatus === undefined || descendantStatus === undefined) return false;
        return this.isDescendant(ancestor, ancestorStatus, descendant, descendantStatus);
      },
      getLatestMessage: (validatorIndex: ValidatorIndex) => {
        const nextIndex = this.voteNextIndices[validatorIndex];
        if (nextIndex === undefined || nextIndex === NULL_VOTE_INDEX) {
          return null;
        }
        const node = this.protoArray.nodes[nextIndex];
        if (!node) return null;
        return {root: node.blockRoot, epoch: computeEpochAtSlot(this.voteNextSlots[validatorIndex])};
      },
      getUnrealizedJustified: () => ({
        checkpoint: this.fcStore.unrealizedJustified.checkpoint,
        balances: this.fcStore.unrealizedJustified.balances,
      }),
      getFinalizedCheckpoint: () => this.fcStore.finalizedCheckpoint,
      getEquivocatingIndices: () => this.fcStore.equivocatingIndices,
      getTrackedVotesCount: () => {
        let count = 0;
        for (let i = 0; i < this.voteNextIndices.length; i++) {
          if (this.voteNextIndices[i] !== NULL_VOTE_INDEX) {
            count++;
          }
        }
        return count;
      },
    };
  }
}

// https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/phase0/fork-choice.md#calculate_committee_fraction
// Calculates proposer boost score when committeePercent = config.PROPOSER_SCORE_BOOST
function getCommitteeFraction(
  justifiedTotalActiveBalanceByIncrement: number,
  config: {slotsPerEpoch: number; committeePercent: number}
): bigint {
  const committeeWeightGwei =
    (BigInt(justifiedTotalActiveBalanceByIncrement) * EFFECTIVE_BALANCE_INCREMENT_BIGINT) /
    BigInt(config.slotsPerEpoch);
  return (committeeWeightGwei * BigInt(config.committeePercent)) / 100n;
}
