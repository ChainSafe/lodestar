import {ChainForkConfig} from "@lodestar/config";
import bindings from "@lodestar/native";
import {
  type BlockSummary,
  type KeepHeadReason,
  NO_BLOCK,
  NO_NODE,
  type AttestationData as NativeAttestationData,
  ExecutionStatus as NativeExecutionStatus,
  ForkChoice as NativeStore,
} from "@lodestar/native/fork-choice";
import {PTC_SIZE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  IBeaconStateView,
  ZERO_HASH,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getAttesterSlashableIndices,
  isExecutionBlockBodyType,
  isStatePostBellatrix,
} from "@lodestar/state-transition";
import {
  AttesterSlashing,
  BeaconBlock,
  IndexedAttestation,
  Root,
  RootHex,
  Slot,
  ValidatorIndex,
  isGloasBeaconBlock,
  phase0,
  ssz,
} from "@lodestar/types";
import {Logger, fromHex, toRootHex, withObservedDuration} from "@lodestar/utils";
import {ForkChoiceMetrics} from "../metrics.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "../protoArray/errors.js";
import {
  BlockExecutionStatus,
  ExecutionStatus,
  HEX_ZERO_HASH,
  LVHExecResponse,
  PayloadExecutionStatus,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  PtcQuorum,
  getPtcVerdict,
  isGloasBlock,
} from "../protoArray/interface.js";
import {DEFAULT_PRUNE_THRESHOLD} from "../protoArray/protoArray.js";
import {ForkChoiceError, ForkChoiceErrorCode, InvalidAttestationCode, InvalidBlockCode} from "./errors.js";
import {
  type FastConfirmationContext,
  FastConfirmationRule,
  FastConfirmationSteps,
  type IFastConfirmationRule,
  type IFastConfirmationSpecStore,
} from "./fastConfirmation/fastConfirmationRule.js";
import {ForkChoiceOpts, UpdateAndGetHeadOpt, UpdateHeadOpt} from "./forkChoice.js";
import {
  AncestorResult,
  AncestorStatus,
  EpochDifference,
  IForkChoice,
  NotReorgedReason,
  ShouldOverrideForkChoiceUpdateResult,
} from "./interface.js";
import {CheckpointWithHex, IForkChoiceStore, equalCheckpointWithHex, toCheckpointWithHex} from "./store.js";

/** The anchor of a fork choice store: a block and the facts of its post-state */
export type NativeForkChoiceAnchor = {
  /** The anchor block's default variant: FULL before Gloas, PENDING from Gloas on */
  block: ProtoBlock;
  /** Slot of the anchor state, at or after the anchor block's slot */
  stateSlot: Slot;
  genesisTime: number;
  genesisValidatorsRoot: Root;
  /** The anchor state's `current_justified_checkpoint` */
  justifiedCheckpoint: phase0.Checkpoint;
  /** The anchor state's `finalized_checkpoint` */
  finalizedCheckpoint: phase0.Checkpoint;
  /** The anchor block's own payload: the bid's `block_hash` from Gloas on. Null before the merge */
  payloadBlockHash: Root | null;
  /** The anchor block's Gloas bid `parent_block_hash` */
  bidParentBlockHash: Root | null;
};

// Node ids are `blockIndex * 3 + <spec payload status>`, the numbering of the native store
const SPEC_EMPTY = 0;
const SPEC_FULL = 1;
const SPEC_PENDING = 2;

const PTC_VOTED = 1;
const PTC_PAYLOAD_PRESENT = 2;
const PTC_BLOB_DATA_AVAILABLE = 4;
const PTC_THRESHOLD = Math.floor(PTC_SIZE / 2);

const KEEP_HEAD_REASONS: Record<KeepHeadReason, NotReorgedReason> = {
  head_timely: NotReorgedReason.HeadBlockIsTimely,
  shuffling_not_stable: NotReorgedReason.NotShufflingStable,
  not_ffg_competitive: NotReorgedReason.NotFFGCompetitive,
  finalization_not_ok: NotReorgedReason.ChainLongUnfinality,
  parent_not_previous_slot: NotReorgedReason.ParentBlockDistanceMoreThanOneSlot,
  not_proposing_on_time: NotReorgedReason.NotProposingOnTime,
  not_proposing_next_slot: NotReorgedReason.ReorgMoreThanOneSlot,
  proposer_boost_not_worn_off: NotReorgedReason.ProposerBoostNotWornOff,
  head_not_weak: NotReorgedReason.HeadBlockNotWeak,
  parent_not_strong: NotReorgedReason.ParentBlockNotStrong,
};

const EXECUTION_STATUS_FROM_NATIVE: Record<number, ExecutionStatus> = {
  [NativeExecutionStatus.PreMerge]: ExecutionStatus.PreMerge,
  [NativeExecutionStatus.Valid]: ExecutionStatus.Valid,
  [NativeExecutionStatus.Syncing]: ExecutionStatus.Syncing,
  [NativeExecutionStatus.Invalid]: ExecutionStatus.Invalid,
};

const EXECUTION_STATUS_TO_NATIVE = {
  [ExecutionStatus.PreMerge]: NativeExecutionStatus.PreMerge,
  [ExecutionStatus.Valid]: NativeExecutionStatus.Valid,
  [ExecutionStatus.Syncing]: NativeExecutionStatus.Syncing,
  [ExecutionStatus.Invalid]: NativeExecutionStatus.Invalid,
};

type NativeScores = {weights: BigUint64Array; attestationScores: BigUint64Array; bestChildren: Uint32Array};

/**
 * `IForkChoice` on the Zig fork choice store (`src/fork_choice`).
 *
 * The native store owns the block tree, the votes and every decision. This class owns what the
 * rest of the node reads: one `ProtoBlock` per fork choice node, indexed by the store's node ids,
 * and the checkpoints mirrored into `fcStore` so its events fire. Beacon states never cross into
 * the store; it asks for justified balances and committees through the provider callbacks.
 *
 * Differences from `ForkChoice`, all following the spec the store is written against:
 * - the anchor is both the justified and the finalized checkpoint
 * - `should_override_forkchoice_update` is gone from the spec, so `shouldOverrideForkChoiceUpdate`
 *   never overrides and `predictProposerHead` is the head
 * - `prune` drops every block that does not descend from the finalized block, not only the ones
 *   before it
 */
export class NativeForkChoice implements IForkChoice {
  irrecoverableError?: Error;

  private readonly store: NativeStore;
  /** By node id. A pre-Gloas block has its single FULL variant in the PENDING slot */
  private nodes: (ProtoBlock | undefined)[] = [];
  /** By block index: the node id the block hangs from, undefined for the root block */
  private parentNodes: (number | undefined)[] = [];
  private blockIndexByRoot = new Map<RootHex, number>();
  private head: ProtoBlock;
  private pruneThreshold = DEFAULT_PRUNE_THRESHOLD;
  private previousProposerBoostRoot: RootHex = HEX_ZERO_HASH;
  private queuedAttestationsPreviousSlot = 0;
  private voteChangesTotal = 0;
  /** Post-state of the block being imported, the fallback source of justified balances */
  private importingState: IBeaconStateView | null = null;
  /** Balances the provider last handed to the store, for the checkpoint they belong to */
  private providedBalances: {checkpoint: CheckpointWithHex; balances: EffectiveBalanceIncrements} | null = null;
  private scores: NativeScores | null = null;
  private latestMessages: {slots: Float64Array; nodes: Uint32Array} | null = null;

  private readonly fastConfirmationRule?: IFastConfirmationRule;
  private readonly fastConfirmationContext?: FastConfirmationContext;
  private fastConfirmationPaused = false;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly fcStore: IForkChoiceStore,
    anchor: NativeForkChoiceAnchor,
    readonly metrics: ForkChoiceMetrics | null,
    private readonly opts?: ForkChoiceOpts,
    private readonly logger?: Logger
  ) {
    if (opts?.proposerBoost === false) {
      throw Error("The native fork choice always applies proposer boost");
    }

    const {block} = anchor;
    const anchorHasPayload = anchor.payloadBlockHash !== null && !ssz.Root.equals(anchor.payloadBlockHash, ZERO_HASH);
    this.store = new NativeStore(
      new bindings.BeaconConfig(config, anchor.genesisValidatorsRoot),
      anchor.genesisTime,
      {
        root: fromHex(block.blockRoot),
        parentRoot: fromHex(block.parentRoot),
        slot: anchor.stateSlot,
        proposerIndex: block.proposerIndex,
        stateRoot: fromHex(block.stateRoot),
        justifiedCheckpoint: anchor.justifiedCheckpoint,
        finalizedCheckpoint: anchor.finalizedCheckpoint,
        unrealizedJustifiedCheckpoint: anchor.justifiedCheckpoint,
        unrealizedFinalizedCheckpoint: anchor.finalizedCheckpoint,
        payloadBlockHash: anchor.payloadBlockHash ?? undefined,
        bidParentBlockHash: anchor.bidParentBlockHash ?? undefined,
        // A Gloas payload is only judged when its envelope arrives
        executionStatus: !anchorHasPayload
          ? NativeExecutionStatus.PreMerge
          : isGloasBlock(block)
            ? NativeExecutionStatus.Syncing
            : EXECUTION_STATUS_TO_NATIVE[block.executionStatus],
      },
      {
        justifiedBalances: (epoch, root) => this.provideJustifiedBalances(epoch, root),
        slotCommitteeMembers: (root, slot) => this.provideSlotCommitteeMembers(root, slot),
      }
    );
    this.insertBlock(0, block);

    // Bring the clock up to the slot the caller starts at; the anchor may be older
    this.store.onTick(this.store.timeAtSlotMs(Math.max(fcStore.currentSlot, this.store.currentSlot)));
    this.fcStore.currentSlot = this.store.currentSlot;
    this.syncCheckpoints();
    this.head = this.updateHead();

    if (this.opts?.fastConfirmation) {
      this.fastConfirmationRule = new FastConfirmationRule(this.fcStore, metrics, this.logger);
      this.fastConfirmationContext = this.createFastConfirmationContext();
      metrics?.fastConfirmation.paused.set(0);
    }

    metrics?.forkChoice.votes.addCollect(() => {
      metrics.forkChoice.votes.set(this.store.voteCount);
      metrics.forkChoice.queuedAttestations.set(this.queuedAttestationsPreviousSlot);
      metrics.forkChoice.balancesLength.set(this.fcStore.justified.balances.length);
      metrics.forkChoice.nodes.set(this.nodeCount());
      metrics.forkChoice.indices.set(this.blockIndexByRoot.size);
    });
  }

  // Head

  getHeadRoot(): RootHex {
    return this.getHead().blockRoot;
  }

  getHead(): ProtoBlock {
    return this.head;
  }

  updateHead(): ProtoBlock {
    this.previousProposerBoostRoot = this.getProposerBoostRoot();
    const head = this.nodes[this.store.getHead()];
    if (head === undefined) {
      throw Error("Native fork choice head has no block summary");
    }
    this.head = head;

    const computeDeltasMetrics = this.metrics?.forkChoice.computeDeltas;
    if (computeDeltasMetrics) {
      const voteChangesTotal = this.store.voteChangesTotal;
      computeDeltasMetrics.deltasCount.set(this.nodeCount());
      computeDeltasMetrics.equivocatingValidators.set(this.store.equivocatingCount);
      computeDeltasMetrics.newVoteValidators.set(voteChangesTotal - this.voteChangesTotal);
      this.voteChangesTotal = voteChangesTotal;
    }
    return head;
  }

  updateAndGetHead(opt: UpdateAndGetHeadOpt): {
    head: ProtoBlock;
    isHeadTimely?: boolean;
    notReorgedReason?: NotReorgedReason;
  } {
    const canonicalHeadBlock = opt.mode === UpdateHeadOpt.GetPredictedProposerHead ? this.getHead() : this.updateHead();
    switch (opt.mode) {
      case UpdateHeadOpt.GetPredictedProposerHead:
        return {head: this.predictProposerHead(canonicalHeadBlock)};
      case UpdateHeadOpt.GetProposerHead: {
        const {
          proposerHead: head,
          isHeadTimely,
          notReorgedReason,
        } = this.getProposerHead(canonicalHeadBlock, opt.msFromSlot, opt.slot);
        return {head, isHeadTimely, notReorgedReason};
      }
      default:
        return {head: canonicalHeadBlock};
    }
  }

  /** `should_override_forkchoice_update` was removed from the spec, see `src/fork_choice/README.md` */
  shouldOverrideForkChoiceUpdate(
    _headBlock: ProtoBlock,
    _msFromSlot: number,
    _currentSlot: Slot
  ): ShouldOverrideForkChoiceUpdateResult {
    return {shouldOverrideFcu: false, reason: NotReorgedReason.ProposerBoostReorgDisabled};
  }

  predictProposerHead(headBlock: ProtoBlock): ProtoBlock {
    return headBlock;
  }

  /**
   * Spec `get_proposer_head`. `msFromSlot` is how far into `slot` the proposer is, which the
   * store reads from its own clock, so the clock is brought up to that moment first.
   */
  getProposerHead(
    headBlock: ProtoBlock,
    msFromSlot: number,
    slot: Slot
  ): {proposerHead: ProtoBlock; isHeadTimely: boolean; notReorgedReason?: NotReorgedReason} {
    const isHeadTimely = headBlock.timeliness;
    if (!this.opts?.proposerBoostReorg) {
      return {proposerHead: headBlock, isHeadTimely, notReorgedReason: NotReorgedReason.ProposerBoostReorgDisabled};
    }

    const headNode = this.getNodeId(headBlock.blockRoot, headBlock.payloadStatus);
    if (headNode === undefined) {
      return {proposerHead: headBlock, isHeadTimely, notReorgedReason: NotReorgedReason.HeadBlockNotAvailable};
    }
    if (this.parentNodes[Math.floor(headNode / 3)] === undefined) {
      return {proposerHead: headBlock, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotAvailable};
    }

    this.store.onTick(this.store.timeAtSlotMs(slot) + Math.max(0, Math.floor(msFromSlot)));
    const decision = this.store.getProposerHead(headNode, slot);
    if (typeof decision === "string") {
      return {proposerHead: headBlock, isHeadTimely, notReorgedReason: KEEP_HEAD_REASONS[decision]};
    }

    const parentBlock = this.nodes[decision];
    if (parentBlock === undefined) {
      return {proposerHead: headBlock, isHeadTimely, notReorgedReason: NotReorgedReason.ParentBlockNotAvailable};
    }
    this.logger?.verbose("Performing single-slot reorg to remove current weak head", {
      slot,
      proposerHead: parentBlock.blockRoot,
      weakHead: headBlock.blockRoot,
    });
    return {proposerHead: parentBlock, isHeadTimely};
  }

  getHeads(): ProtoBlock[] {
    const {bestChildren} = this.getScores();
    const heads: ProtoBlock[] = [];
    for (const id of this.nodeIds()) {
      if (bestChildren[id] === NO_NODE) {
        heads.push(this.nodes[id] as ProtoBlock);
      }
    }
    return heads;
  }

  /** Exact Gwei weights of the leaves of the filtered block tree, for the compliance tests */
  getViableHeads(): {root: RootHex; payloadStatus: PayloadStatus; weight: bigint}[] {
    return this.store.viableHeads().map(({root, payloadStatus, weight}) => {
      const rootHex = toRootHex(root);
      const blockIndex = this.blockIndexByRoot.get(rootHex);
      const node = blockIndex === undefined ? undefined : this.nodes[blockIndex * 3 + payloadStatus];
      if (node === undefined) {
        throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: rootHex});
      }
      return {root: rootHex, payloadStatus: node.payloadStatus, weight};
    });
  }

  getAllNodes(): ProtoNode[] {
    const ids = this.nodeIds();
    const positionById = new Map<number, number>();
    for (const [position, id] of ids.entries()) {
      positionById.set(id, position);
    }
    const {weights, attestationScores, bestChildren} = this.getScores();
    return ids.map((id) => {
      let bestDescendant = bestChildren[id];
      while (bestDescendant !== NO_NODE && bestChildren[bestDescendant] !== NO_NODE) {
        bestDescendant = bestChildren[bestDescendant];
      }
      const parent = id % 3 === SPEC_PENDING ? this.parentNodes[Math.floor(id / 3)] : id - (id % 3) + SPEC_PENDING;
      return {
        ...(this.nodes[id] as ProtoBlock),
        parent: parent === undefined ? undefined : positionById.get(parent),
        weight: weights[id],
        attestationScore: attestationScores[id],
        bestChild: positionById.get(bestChildren[id]),
        bestDescendant: positionById.get(bestDescendant),
      };
    });
  }

  // Fast confirmation

  getConfirmedRoot(): RootHex {
    return this.fastConfirmationRule?.getConfirmedRoot() ?? this.fcStore.justified.checkpoint.rootHex;
  }

  getConfirmedBlock(): ProtoBlock | null {
    return this.getBlockHexDefaultStatus(this.getConfirmedRoot());
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

  resumeFastConfirmation(): void {
    this.toggleFastConfirmation(false);
  }

  pauseFastConfirmation(): void {
    this.toggleFastConfirmation(true);
  }

  private toggleFastConfirmation(paused: boolean): void {
    if (!this.fastConfirmationRule || paused === this.fastConfirmationPaused) return;
    this.fastConfirmationPaused = paused;
    if (paused) {
      this.fcStore.confirmedRoot = this.fcStore.finalizedCheckpoint.rootHex;
      this.notifyConfirmedRoot();
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
      this.logger?.debug("Fast confirmation produced root not in fork choice", {confirmedRoot});
      return;
    }
    this.fcStore.notifyFastConfirmation?.({
      block: confirmedRoot,
      slot: confirmedBlock.slot,
      currentSlot: this.fcStore.currentSlot,
    });
  }

  /** Returns whether it recomputed the head */
  private runFastConfirmation(): boolean {
    const fastConfirmationRule = this.fastConfirmationRule;
    const fastConfirmationContext = this.fastConfirmationContext;
    if (!fastConfirmationRule || !fastConfirmationContext) return false;

    if (this.fastConfirmationPaused) {
      this.fcStore.confirmedRoot = this.fcStore.finalizedCheckpoint.rootHex;
      this.notifyConfirmedRoot();
      return false;
    }

    withObservedDuration(this.metrics?.fastConfirmation.totalDuration.startTimer(), () => {
      try {
        withObservedDuration(
          this.metrics?.fastConfirmation.stepsDuration.startTimer({step: FastConfirmationSteps.updateHead}),
          () => this.updateHead()
        );
        const result = fastConfirmationRule.onSlotStartAfterPastAttestationsApplied(fastConfirmationContext);
        this.fcStore.confirmedRoot = result.confirmedRoot;
      } catch (err) {
        const previousConfirmedRoot = this.fcStore.confirmedRoot;
        const finalizedRoot = this.fcStore.finalizedCheckpoint.rootHex;
        this.fcStore.confirmedRoot = finalizedRoot;
        if (previousConfirmedRoot !== finalizedRoot) {
          this.metrics?.fastConfirmation.resets.inc();
          this.metrics?.fastConfirmation.fallbacks.inc();
        }
        const finalizedBlock = this.getBlockHexDefaultStatus(finalizedRoot);
        if (finalizedBlock !== null) {
          this.metrics?.fastConfirmation.confirmedEpoch.set(computeEpochAtSlot(finalizedBlock.slot));
          this.metrics?.fastConfirmation.slot.set(finalizedBlock.slot);
        }
        this.logger?.warn(
          "Fast confirmation failed, reverting to finalized",
          {
            slot: this.fcStore.currentSlot,
            head: this.head.blockRoot,
            previousConfirmedRoot,
            confirmedRoot: finalizedRoot,
          },
          err as Error
        );
      }
    });

    this.notifyConfirmedRoot();
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
        const ancestorBlock = this.getDefaultNode(ancestor);
        const descendantBlock = this.getDefaultNode(descendant);
        if (ancestorBlock === undefined || descendantBlock === undefined) return false;
        return this.isDescendant(ancestor, ancestorBlock.payloadStatus, descendant, descendantBlock.payloadStatus);
      },
      getLatestMessage: (validatorIndex: ValidatorIndex) => {
        const {slots, nodes} = this.getLatestMessages();
        const node = validatorIndex < nodes.length ? this.nodes[nodes[validatorIndex]] : undefined;
        if (node === undefined) return null;
        return {
          root: node.blockRoot,
          payloadStatus: node.payloadStatus,
          epoch: computeEpochAtSlot(slots[validatorIndex]),
        };
      },
      getParentNodePayloadStatus: (blockRoot: RootHex) => {
        const blockIndex = this.blockIndexByRoot.get(blockRoot);
        const parentNode = blockIndex === undefined ? undefined : this.parentNodes[blockIndex];
        return parentNode === undefined ? null : (this.nodes[parentNode]?.payloadStatus ?? null);
      },
      getUnrealizedJustified: () => ({
        checkpoint: this.fcStore.unrealizedJustified.checkpoint,
        balances: this.fcStore.unrealizedJustified.balances,
      }),
      getFinalizedCheckpoint: () => this.fcStore.finalizedCheckpoint,
      getEquivocatingIndices: () => this.fcStore.equivocatingIndices,
      getTrackedVotesCount: () => {
        let count = 0;
        for (const node of this.getLatestMessages().nodes) {
          if (node !== NO_NODE) count++;
        }
        return count;
      },
    };
  }

  // Checkpoints and time

  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.finalizedCheckpoint;
  }

  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.justified.checkpoint;
  }

  getUnrealizedJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.unrealizedJustified.checkpoint;
  }

  getUnrealizedFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.unrealizedFinalizedCheckpoint;
  }

  getFinalizedCheckpointSlot(): Slot {
    return computeStartSlotAtEpoch(this.fcStore.finalizedCheckpoint.epoch);
  }

  getProposerBoostRoot(): RootHex {
    return toRootHex(this.store.proposerBoostRoot);
  }

  getPreviousProposerBoostRoot(): RootHex {
    return this.previousProposerBoostRoot;
  }

  getTime(): Slot {
    return this.fcStore.currentSlot;
  }

  updateTime(currentSlot: Slot): void {
    while (this.fcStore.currentSlot < currentSlot) {
      const slot = this.fcStore.currentSlot + 1;
      this.mutated();
      const queuedVoteCount = this.store.queuedVoteCount;
      this.store.onTick(this.store.timeAtSlotMs(slot));
      this.queuedAttestationsPreviousSlot = queuedVoteCount - this.store.queuedVoteCount;
      this.fcStore.currentSlot = slot;
      const didUpdateCheckpoints = this.syncCheckpoints();
      const didRecomputeHead = this.runFastConfirmation();
      // A checkpoint pulled up at the epoch boundary can move the head before the next block arrives
      if (didUpdateCheckpoints && !didRecomputeHead) {
        this.updateHead();
      }
    }
  }

  /** Mirrors the store's checkpoints into `fcStore`, whose setters emit the chain events */
  private syncCheckpoints(): boolean {
    const checkpoints = this.store.checkpoints();
    let updated = false;

    const unrealizedJustified = toCheckpointWithHex(checkpoints.unrealizedJustified);
    if (!equalCheckpointWithHex(unrealizedJustified, this.fcStore.unrealizedJustified.checkpoint)) {
      // Captured while the block's state is at hand: the epoch boundary tick that realizes this
      // checkpoint has no state to fall back to
      this.fcStore.unrealizedJustified = {
        checkpoint: unrealizedJustified,
        balances: this.balancesOf(unrealizedJustified),
      };
    }
    const unrealizedFinalized = toCheckpointWithHex(checkpoints.unrealizedFinalized);
    if (!equalCheckpointWithHex(unrealizedFinalized, this.fcStore.unrealizedFinalizedCheckpoint)) {
      this.fcStore.unrealizedFinalizedCheckpoint = unrealizedFinalized;
    }

    const justified = toCheckpointWithHex(checkpoints.justified);
    if (!equalCheckpointWithHex(justified, this.fcStore.justified.checkpoint)) {
      this.fcStore.justified = {checkpoint: justified, balances: this.balancesOf(justified)};
      updated = true;
    }
    const finalized = toCheckpointWithHex(checkpoints.finalized);
    if (!equalCheckpointWithHex(finalized, this.fcStore.finalizedCheckpoint)) {
      this.fcStore.finalizedCheckpoint = finalized;
      updated = true;
    }
    return updated;
  }

  private balancesOf(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements {
    for (const known of [this.providedBalances, this.fcStore.unrealizedJustified, this.fcStore.justified]) {
      if (known !== null && equalCheckpointWithHex(known.checkpoint, checkpoint)) {
        return known.balances;
      }
    }
    if (this.importingState === null) {
      // The anchor's balances are the ones the store was created with
      if (this.blockIndexByRoot.size === 0) return this.fcStore.justified.balances;
      throw Error(`No balances for justified checkpoint ${checkpoint.epoch} ${checkpoint.rootHex}`);
    }
    return this.fcStore.justifiedBalancesGetter(checkpoint, this.importingState);
  }

  private provideJustifiedBalances(epoch: number, root: Uint8Array): EffectiveBalanceIncrements {
    // The store hands out a view of its own memory, valid for this call only
    const checkpoint = toCheckpointWithHex({epoch, root: root.slice()});
    const balances = this.balancesOf(checkpoint);
    this.providedBalances = {checkpoint, balances};
    return balances;
  }

  private provideSlotCommitteeMembers(root: Uint8Array, slot: Slot): Uint32Array {
    const blockRoot = toRootHex(root);
    const block = this.getDefaultNode(blockRoot);
    const state = block === undefined ? null : this.fcStore.stateGetter({stateRoot: block.stateRoot});
    if (state === null) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.BEACON_STATE_ERROR,
        error: Error(`Missing state for isHeadWeak, blockRoot=${blockRoot}`),
      });
    }
    const members: number[] = [];
    const committeeCount = state.getBeaconCommitteeCountPerSlot(computeEpochAtSlot(slot));
    for (let index = 0; index < committeeCount; index++) {
      members.push(...state.getBeaconCommittee(slot, index));
    }
    return Uint32Array.from(members);
  }

  // Handlers

  onBlock(
    block: BeaconBlock,
    state: IBeaconStateView,
    receiveDelayMs: number,
    importDelayMs: number,
    currentSlot: Slot,
    executionStatus: BlockExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): ProtoBlock {
    const {parentRoot, slot} = block;
    const parentRootHex = toRootHex(parentRoot);
    const bid = isGloasBeaconBlock(block) ? block.body.signedExecutionPayloadBid.message : null;
    const parentHashHex = bid === null ? null : toRootHex(bid.parentBlockHash);
    const parentBlock = this.getParent(parentRootHex, parentHashHex);
    if (parentBlock === null) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {code: InvalidBlockCode.UNKNOWN_PARENT, root: parentRootHex, hash: parentHashHex},
      });
    }

    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(blockRoot);
    const justifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const finalizedCheckpoint = toCheckpointWithHex(state.finalizedCheckpoint);
    const blockEpoch = computeEpochAtSlot(slot);

    // The parent's unrealized checkpoints carry over when the block cannot change them, see
    // `ForkChoice.onBlock`
    let unrealizedJustifiedCheckpoint: CheckpointWithHex;
    let unrealizedFinalizedCheckpoint: CheckpointWithHex;
    if (!this.opts?.computeUnrealized) {
      unrealizedJustifiedCheckpoint = justifiedCheckpoint;
      unrealizedFinalizedCheckpoint = finalizedCheckpoint;
    } else if (
      block.body.proposerSlashings.length === 0 &&
      block.body.attesterSlashings.length === 0 &&
      parentBlock.unrealizedJustifiedEpoch === blockEpoch &&
      parentBlock.unrealizedFinalizedEpoch + 1 >= blockEpoch
    ) {
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
      const unrealized = state.computeUnrealizedCheckpoints();
      unrealizedJustifiedCheckpoint = toCheckpointWithHex(unrealized.justifiedCheckpoint);
      unrealizedFinalizedCheckpoint = toCheckpointWithHex(unrealized.finalizedCheckpoint);
    }

    const hasPayload =
      bid === null &&
      isExecutionBlockBodyType(block.body) &&
      isStatePostBellatrix(state) &&
      state.isExecutionStateType &&
      state.isExecutionEnabled(block);
    const payload = hasPayload && isExecutionBlockBodyType(block.body) ? block.body.executionPayload : null;
    if (bid === null && payload === null && executionStatus !== ExecutionStatus.PreMerge) {
      throw Error(`Invalid pre-merge execution status: expected: ${ExecutionStatus.PreMerge}, got ${executionStatus}`);
    }
    if ((bid !== null || payload !== null) && executionStatus === ExecutionStatus.PreMerge) {
      throw Error(`Invalid post-merge execution status: got ${executionStatus}`);
    }

    const payloadBlockHash = bid?.blockHash ?? payload?.blockHash;
    const summary: BlockSummary = {
      root: blockRoot,
      parentRoot,
      slot,
      proposerIndex: block.proposerIndex,
      stateRoot: block.stateRoot,
      justifiedCheckpoint,
      finalizedCheckpoint,
      unrealizedJustifiedCheckpoint,
      unrealizedFinalizedCheckpoint,
      payloadBlockHash,
      bidParentBlockHash: bid?.parentBlockHash,
      // A zero hash is no payload, and a Gloas payload is only judged when its envelope arrives
      executionStatus:
        payloadBlockHash === undefined || ssz.Root.equals(payloadBlockHash, ZERO_HASH)
          ? NativeExecutionStatus.PreMerge
          : bid !== null
            ? NativeExecutionStatus.Syncing
            : EXECUTION_STATUS_TO_NATIVE[executionStatus],
      arrivalMsIntoSlot: Math.max(0, Math.floor(receiveDelayMs)),
    };

    let blockIndex: number;
    this.mutated();
    this.importingState = state;
    try {
      blockIndex = this.store.onBlock(summary);
    } catch (e) {
      throw this.toInvalidBlockError(e, block, parentRootHex, parentHashHex);
    } finally {
      // Checkpoints the store adopted during the call are mirrored while the state is at hand
      this.syncCheckpoints();
      this.importingState = null;
    }

    const [timeliness, ptcTimeliness] = this.store.blockTimeliness(blockIndex);
    const targetSlot = computeStartSlotAtEpoch(blockEpoch);
    const targetRoot = slot === targetSlot ? blockRoot : state.getBlockRootAtSlot(targetSlot);
    const fork = this.config.getForkName(slot);
    const protoBlock: ProtoBlock = {
      slot,
      blockRoot: blockRootHex,
      parentRoot: parentRootHex,
      targetRoot: toRootHex(targetRoot),
      stateRoot: toRootHex(block.stateRoot),
      timeliness,
      ptcTimeliness,
      importedTimely: currentSlot === slot && importDelayMs < this.config.getAttestationDueMs(fork),
      proposerIndex: block.proposerIndex,

      justifiedEpoch: justifiedCheckpoint.epoch,
      justifiedRoot: justifiedCheckpoint.rootHex,
      finalizedEpoch: finalizedCheckpoint.epoch,
      finalizedRoot: finalizedCheckpoint.rootHex,
      unrealizedJustifiedEpoch: unrealizedJustifiedCheckpoint.epoch,
      unrealizedJustifiedRoot: unrealizedJustifiedCheckpoint.rootHex,
      unrealizedFinalizedEpoch: unrealizedFinalizedCheckpoint.epoch,
      unrealizedFinalizedRoot: unrealizedFinalizedCheckpoint.rootHex,

      ...(parentHashHex !== null
        ? {
            // Until its payload arrives a Gloas block reports the parent payload its bid builds on
            executionPayloadBlockHash: parentHashHex,
            executionPayloadNumber:
              parentBlock.executionPayloadBlockHash === null ? 0 : parentBlock.executionPayloadNumber,
            executionPayloadGasLimit:
              parentBlock.executionPayloadBlockHash === null ? 0 : parentBlock.executionPayloadGasLimit,
            executionStatus: executionStatus as ExecutionStatus.Valid | ExecutionStatus.Syncing,
            dataAvailabilityStatus,
          }
        : payload !== null
          ? {
              executionPayloadBlockHash: toRootHex(payload.blockHash),
              executionPayloadNumber: payload.blockNumber,
              executionPayloadGasLimit: payload.gasLimit,
              executionStatus: executionStatus as ExecutionStatus.Valid | ExecutionStatus.Syncing,
              dataAvailabilityStatus,
            }
          : {
              executionPayloadBlockHash: null,
              executionStatus: ExecutionStatus.PreMerge,
              dataAvailabilityStatus: DataAvailabilityStatus.PreData,
            }),

      payloadStatus: parentHashHex !== null ? PayloadStatus.PENDING : PayloadStatus.FULL,
      parentBlockHash: parentHashHex,
    };

    this.insertBlock(blockIndex, protoBlock);
    this.refreshExecutionStatuses();
    return protoBlock;
  }

  onAttestation(attestation: IndexedAttestation, _attDataRoot: string, forceImport?: boolean): void {
    const {data, attestingIndices} = attestation;
    // The spec aliases the zero hash to genesis; such votes carry no information
    if (ssz.Root.equals(data.beaconBlockRoot, ZERO_HASH)) {
      return;
    }
    if (attestingIndices.length === 0) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {code: InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD},
      });
    }

    this.mutated();
    try {
      this.store.onAttestation(
        data.slot,
        data.index,
        data.beaconBlockRoot,
        data.target.epoch,
        data.target.root,
        Uint32Array.from(attestingIndices),
        forceImport === true
      );
    } catch (e) {
      throw this.toInvalidAttestationError(e, data);
    }
  }

  onAttesterSlashing(slashing: AttesterSlashing): void {
    const {attestation1, attestation2} = slashing;
    this.mutated();
    this.store.onAttesterSlashing(
      toNativeAttestationData(attestation1.data),
      Uint32Array.from(attestation1.attestingIndices),
      toNativeAttestationData(attestation2.data),
      Uint32Array.from(attestation2.attestingIndices)
    );
    for (const validatorIndex of getAttesterSlashableIndices(slashing)) {
      this.fcStore.equivocatingIndices.add(validatorIndex);
    }
  }

  notifyPtcMessages(
    blockRoot: RootHex,
    slot: Slot,
    ptcIndices: number[],
    payloadPresent: boolean,
    blobDataAvailable: boolean
  ): void {
    const before = this.getPtcQuorum(blockRoot);
    if (before === null) {
      return;
    }
    this.mutated();
    this.store.onPtcVotes(fromHex(blockRoot), slot, Uint16Array.from(ptcIndices), payloadPresent, blobDataAvailable);
    const after = this.getPtcQuorum(blockRoot);
    if (after === null) {
      return;
    }
    const verdict = getPtcVerdict(after);
    if (verdict === null || verdict === getPtcVerdict(before)) {
      return;
    }

    this.metrics?.forkChoice.ptcQuorum.inc({verdict: verdict ? "true" : "false"});
    this.logger?.verbose("PTC quorum reached", {slot, blockRoot, verdict, ...after});
    this.fcStore.notifyPtcQuorum?.({blockRoot, slot, verdict, ...after});
  }

  onExecutionPayload(
    blockRoot: RootHex,
    executionPayloadBlockHash: RootHex,
    executionPayloadNumber: number,
    executionPayloadGasLimit: number,
    executionStatus: PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): void {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    const pendingNode = blockIndex === undefined ? undefined : this.nodes[blockIndex * 3 + SPEC_PENDING];
    if (blockIndex === undefined || pendingNode === undefined) {
      throw new ProtoArrayError({code: ProtoArrayErrorCode.UNKNOWN_BLOCK, root: blockRoot});
    }
    if (!isGloasBlock(pendingNode)) {
      throw new ProtoArrayError({code: ProtoArrayErrorCode.PRE_GLOAS_BLOCK, root: blockRoot});
    }
    if (this.nodes[blockIndex * 3 + SPEC_FULL] !== undefined) {
      return;
    }

    this.mutated();
    this.store.onExecutionPayload(fromHex(blockRoot), EXECUTION_STATUS_TO_NATIVE[executionStatus]);
    this.nodes[blockIndex * 3 + SPEC_FULL] = {
      ...pendingNode,
      payloadStatus: PayloadStatus.FULL,
      executionStatus,
      executionPayloadBlockHash,
      executionPayloadNumber,
      executionPayloadGasLimit,
      dataAvailabilityStatus,
    };
    this.refreshExecutionStatuses();
  }

  validateLatestHash(execResponse: LVHExecResponse): void {
    this.mutated();
    try {
      if (execResponse.executionStatus === ExecutionStatus.Valid) {
        this.store.onPayloadValid(fromHex(execResponse.latestValidExecHash));
      } else {
        this.store.onPayloadInvalid(
          fromHex(execResponse.invalidateFromParentBlockRoot),
          fromHex(execResponse.invalidateFromParentBlockHash),
          execResponse.latestValidExecHash === null ? undefined : fromHex(execResponse.latestValidExecHash)
        );
      }
    } catch (e) {
      const code = nativeErrorCode(e);
      // The engine contradicting a verdict it already gave is a consensus failure
      if (code === "PayloadInvalidToValid" || code === "PayloadValidToInvalid") {
        this.irrecoverableError = e as Error;
      }
      return;
    }
    this.refreshExecutionStatuses();
  }

  /** Brings every node's `executionStatus` in line with the store, which derives it per node */
  private refreshExecutionStatuses(): void {
    let statuses: Uint8Array;
    try {
      statuses = this.store.executionStatuses();
    } catch (e) {
      // The justified block stands on an invalidated payload: there is no head to compute
      this.irrecoverableError = e as Error;
      return;
    }
    for (let id = 0; id < this.nodes.length; id++) {
      const node = this.nodes[id];
      if (node === undefined || node.executionPayloadBlockHash === null) continue;
      const status = EXECUTION_STATUS_FROM_NATIVE[statuses[id]];
      // A node past the merge with no payload left to judge below it stands on validated ground
      node.executionStatus = status === ExecutionStatus.PreMerge ? ExecutionStatus.Valid : status;
    }
  }

  prune(finalizedRoot: RootHex): ProtoBlock[] {
    const finalizedIndex = this.blockIndexByRoot.get(finalizedRoot);
    if (finalizedIndex === undefined) {
      throw new ProtoArrayError({code: ProtoArrayErrorCode.FINALIZED_NODE_UNKNOWN, root: finalizedRoot});
    }
    if (finalizedRoot !== this.fcStore.finalizedCheckpoint.rootHex) {
      throw Error(
        `Cannot prune to ${finalizedRoot}, the finalized root is ${this.fcStore.finalizedCheckpoint.rootHex}`
      );
    }
    if (finalizedIndex < this.pruneThreshold) {
      return [];
    }

    this.mutated();
    const remap = this.store.prune();
    if (remap === undefined) {
      return [];
    }

    const removed: ProtoBlock[] = [];
    const nodes: (ProtoBlock | undefined)[] = [];
    const parentNodes: (number | undefined)[] = [];
    const blockIndexByRoot = new Map<RootHex, number>();
    for (const id of this.nodeIds()) {
      const node = this.nodes[id] as ProtoBlock;
      const blockIndex = remap[Math.floor(id / 3)];
      if (blockIndex === NO_BLOCK) {
        removed.push(node);
        continue;
      }
      nodes[blockIndex * 3 + (id % 3)] = node;
      blockIndexByRoot.set(node.blockRoot, blockIndex);
    }
    for (const [oldIndex, blockIndex] of remap.entries()) {
      const parentNode = this.parentNodes[oldIndex];
      if (blockIndex === NO_BLOCK || parentNode === undefined) continue;
      const parentIndex = remap[Math.floor(parentNode / 3)];
      parentNodes[blockIndex] = parentIndex === NO_BLOCK ? undefined : parentIndex * 3 + (parentNode % 3);
    }
    this.nodes = nodes;
    this.parentNodes = parentNodes;
    this.blockIndexByRoot = blockIndexByRoot;
    return removed;
  }

  setPruneThreshold(threshold: number): void {
    this.pruneThreshold = threshold;
  }

  // Payload timeliness committee

  getPTCVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    const votes = this.ptcVotesOf(blockRootHex);
    return votes === null ? null : Array.from(votes, (vote) => (vote & PTC_PAYLOAD_PRESENT) !== 0);
  }

  getPTCVoteCounts(blockRootHex: RootHex): {
    attesterCount: number;
    payloadPresentCount: number;
    dataAvailableCount: number;
  } | null {
    const votes = this.ptcVotesOf(blockRootHex);
    if (votes === null) return null;
    let attesterCount = 0;
    let payloadPresentCount = 0;
    let dataAvailableCount = 0;
    for (const vote of votes) {
      if (vote & PTC_VOTED) attesterCount++;
      if (vote & PTC_PAYLOAD_PRESENT) payloadPresentCount++;
      if (vote & PTC_BLOB_DATA_AVAILABLE) dataAvailableCount++;
    }
    return {attesterCount, payloadPresentCount, dataAvailableCount};
  }

  getPtcQuorum(blockRootHex: RootHex): PtcQuorum | null {
    const counts = this.getPTCVoteCounts(blockRootHex);
    if (counts === null) return null;
    const majority = (yes: number): boolean | null => {
      if (yes > PTC_THRESHOLD) return true;
      if (counts.attesterCount - yes > PTC_THRESHOLD) return false;
      return null;
    };
    return {
      payloadPresent: majority(counts.payloadPresentCount),
      blobDataAvailable: majority(counts.dataAvailableCount),
    };
  }

  getPayloadTimelinessVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    const votes = this.ptcVotesOf(blockRootHex);
    return votes === null
      ? null
      : Array.from(votes, (vote) => (vote & PTC_VOTED ? (vote & PTC_PAYLOAD_PRESENT) !== 0 : null));
  }

  getPayloadDataAvailabilityVotes(blockRootHex: RootHex): (boolean | null)[] | null {
    const votes = this.ptcVotesOf(blockRootHex);
    return votes === null
      ? null
      : Array.from(votes, (vote) => (vote & PTC_VOTED ? (vote & PTC_BLOB_DATA_AVAILABLE) !== 0 : null));
  }

  /** PTC votes of a Gloas block, null for an unknown or pre-Gloas root */
  private ptcVotesOf(blockRoot: RootHex): Uint8Array | null {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    const node = blockIndex === undefined ? undefined : this.nodes[blockIndex * 3 + SPEC_PENDING];
    if (blockIndex === undefined || node === undefined || !isGloasBlock(node)) {
      return null;
    }
    return this.store.ptcVotes(blockIndex);
  }

  shouldExtendPayload(blockRoot: RootHex): boolean {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    if (blockIndex === undefined || this.nodes[blockIndex * 3 + SPEC_FULL] === undefined) {
      return false;
    }
    return this.store.shouldExtendPayload(blockIndex);
  }

  shouldBuildOnFull(head: ProtoBlock, slot: Slot): boolean {
    if (head.payloadStatus === PayloadStatus.PENDING) {
      throw new Error("shouldBuildOnFull called with PENDING head");
    }
    if (!isGloasBlock(head)) {
      return true;
    }
    const headNode = this.getNodeId(head.blockRoot, head.payloadStatus);
    if (headNode === undefined) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: head.blockRoot});
    }
    return this.store.shouldBuildOnFull(headNode, slot);
  }

  recordPayloadInclusionListSatisfaction(blockRoot: RootHex, satisfied: boolean): boolean {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    if (blockIndex === undefined) {
      return false;
    }
    this.mutated();
    const changed = this.store.recordInclusionListSatisfaction(blockIndex, satisfied);
    if (changed && !satisfied) {
      this.metrics?.forkChoice.unsatisfiedInclusionListBlocks.inc();
      this.logger?.verbose("Payload does not satisfy the inclusion list constraints, not extending it", {blockRoot});
    }
    return changed;
  }

  isPayloadInclusionListSatisfied(blockRoot: RootHex): boolean {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    return blockIndex !== undefined && this.store.isPayloadInclusionListSatisfied(blockIndex);
  }

  getPayloadInclusionListSatisfaction(blockRoot: RootHex): boolean | null {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    return blockIndex === undefined ? null : (this.store.inclusionListSatisfaction(blockIndex) ?? null);
  }

  // Block queries

  hasBlock(blockRoot: Root): boolean {
    return this.hasBlockHex(toRootHex(blockRoot));
  }

  hasBlockHex(blockRoot: RootHex): boolean {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    return blockIndex !== undefined && this.isFinalizedRootOrDescendant(blockIndex);
  }

  hasBlockUnsafe(blockRoot: Root): boolean {
    return this.hasBlockHexUnsafe(toRootHex(blockRoot));
  }

  hasBlockHexUnsafe(blockRoot: RootHex): boolean {
    return this.blockIndexByRoot.has(blockRoot);
  }

  hasPayloadUnsafe(blockRoot: Root): boolean {
    return this.hasPayloadHexUnsafe(toRootHex(blockRoot));
  }

  hasPayloadHexUnsafe(blockRoot: RootHex): boolean {
    return this.getNodeId(blockRoot, PayloadStatus.FULL) !== undefined;
  }

  getBlock(blockRoot: Root, payloadStatus: PayloadStatus): ProtoBlock | null {
    return this.getBlockHex(toRootHex(blockRoot), payloadStatus);
  }

  getBlockDefaultStatus(blockRoot: Root): ProtoBlock | null {
    return this.getBlockHexDefaultStatus(toRootHex(blockRoot));
  }

  getBlockHex(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock | null {
    const id = this.getNodeId(blockRoot, payloadStatus);
    if (id === undefined || !this.isFinalizedRootOrDescendant(Math.floor(id / 3))) {
      return null;
    }
    return {...(this.nodes[id] as ProtoBlock)};
  }

  getBlockHexDefaultStatus(blockRoot: RootHex): ProtoBlock | null {
    const node = this.getDefaultNode(blockRoot);
    return node === undefined ? null : this.getBlockHex(blockRoot, node.payloadStatus);
  }

  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    if (blockIndex === undefined) {
      return null;
    }
    const defaultNode = this.nodes[blockIndex * 3 + SPEC_PENDING] as ProtoBlock;
    if (!isGloasBlock(defaultNode)) {
      return defaultNode.executionPayloadBlockHash === blockHash ? defaultNode : null;
    }
    for (const status of [SPEC_FULL, SPEC_EMPTY]) {
      const node = this.nodes[blockIndex * 3 + status];
      if (node !== undefined && node.executionPayloadBlockHash === blockHash) {
        return node;
      }
    }
    return null;
  }

  getJustifiedBlock(): ProtoBlock {
    return this.getExistingBlock(this.fcStore.justified.checkpoint.rootHex);
  }

  getFinalizedBlock(): ProtoBlock {
    return this.getExistingBlock(this.fcStore.finalizedCheckpoint.rootHex);
  }

  private getExistingBlock(blockRoot: RootHex): ProtoBlock {
    const block = this.getBlockHexDefaultStatus(blockRoot);
    if (block === null) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }
    return block;
  }

  getSlotsPresent(windowStart: number): number {
    let count = 0;
    for (const blockIndex of this.blockIndexByRoot.values()) {
      if ((this.nodes[blockIndex * 3 + SPEC_PENDING] as ProtoBlock).slot > windowStart) count++;
    }
    return count;
  }

  getCanonicalPayloadCounts(fromSlot: Slot, toSlot: Slot, head: ProtoBlock): {full: number; empty: number} {
    let full = 0;
    let empty = 0;
    let id = this.getNodeId(head.blockRoot, head.payloadStatus);
    while (id !== undefined) {
      const node = this.nodes[id] as ProtoBlock;
      if (node.slot < fromSlot) break;
      if (
        node.slot !== 0 &&
        node.slot <= toSlot &&
        isGloasBlock(node) &&
        node.payloadStatus !== PayloadStatus.PENDING
      ) {
        if (node.payloadStatus === PayloadStatus.FULL) full++;
        else empty++;
      }
      id = this.parentNodes[Math.floor(id / 3)];
    }
    return {full, empty};
  }

  getAncestor(blockRoot: RootHex, ancestorSlot: Slot): ProtoNode {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    if (blockIndex === undefined) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }
    const id = this.store.getAncestor(blockIndex * 3 + SPEC_PENDING, ancestorSlot);
    const node = this.nodes[id];
    // The store stops at its root block; a root above the requested slot is not the ancestor
    if (node === undefined || (node.slot > ancestorSlot && this.parentNodes[Math.floor(id / 3)] === undefined)) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR, descendantRoot: blockRoot, ancestorSlot});
    }
    const {weights, attestationScores} = this.getScores();
    return {...node, weight: weights[id], attestationScore: attestationScores[id]};
  }

  isDescendant(
    ancestorRoot: RootHex,
    ancestorPayloadStatus: PayloadStatus,
    descendantRoot: RootHex,
    descendantPayloadStatus: PayloadStatus
  ): boolean {
    const ancestorId = this.getNodeId(ancestorRoot, ancestorPayloadStatus);
    if (ancestorId === undefined) {
      return false;
    }
    const ancestorNode = this.nodes[ancestorId] as ProtoBlock;
    if (ancestorRoot === descendantRoot && ancestorPayloadStatus === descendantPayloadStatus) {
      return true;
    }
    for (const node of this.iterateAncestorBlocks(descendantRoot, descendantPayloadStatus)) {
      if (node.blockRoot === ancestorNode.blockRoot) {
        return (
          node.payloadStatus === ancestorNode.payloadStatus || ancestorNode.payloadStatus === PayloadStatus.PENDING
        );
      }
      if (node.slot <= ancestorNode.slot) {
        return false;
      }
    }
    return false;
  }

  *iterateAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): IterableIterator<ProtoBlock> {
    let id = this.getNodeId(blockRoot, payloadStatus);
    while (id !== undefined) {
      id = this.parentNodes[Math.floor(id / 3)];
      if (id !== undefined) {
        yield this.nodes[id] as ProtoBlock;
      }
    }
  }

  getAllAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock[] {
    const id = this.getNodeId(blockRoot, payloadStatus);
    if (id === undefined) {
      return [];
    }
    const start = this.nodes[id] as ProtoBlock;
    const ancestors = Array.from(this.iterateAncestorBlocks(blockRoot, payloadStatus));
    return start.payloadStatus === PayloadStatus.PENDING ? ancestors : [start, ...ancestors];
  }

  getAllNonAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock[] {
    return this.getAllAncestorAndNonAncestorBlocks(blockRoot, payloadStatus).nonAncestors;
  }

  /**
   * `nonAncestors` are the EMPTY, FULL and pre-Gloas variants of every block imported up to the
   * start block that are not on its chain, the root block aside.
   */
  getAllAncestorAndNonAncestorBlocks(
    blockRoot: RootHex,
    payloadStatus: PayloadStatus
  ): {ancestors: ProtoBlock[]; nonAncestors: ProtoBlock[]} {
    const startId = this.getNodeId(blockRoot, payloadStatus);
    if (startId === undefined) {
      return {ancestors: [], nonAncestors: []};
    }

    const ancestorIds = new Set<number>([startId]);
    for (
      let id = this.parentNodes[Math.floor(startId / 3)];
      id !== undefined;
      id = this.parentNodes[Math.floor(id / 3)]
    ) {
      ancestorIds.add(id);
    }
    const ancestors = Array.from(ancestorIds, (id) => this.nodes[id] as ProtoBlock);

    const nonAncestors: ProtoBlock[] = [];
    for (let blockIndex = Math.floor(startId / 3); blockIndex > 0; blockIndex--) {
      for (const status of [SPEC_FULL, SPEC_EMPTY, SPEC_PENDING]) {
        const id = blockIndex * 3 + status;
        const node = this.nodes[id];
        if (node !== undefined && node.payloadStatus !== PayloadStatus.PENDING && !ancestorIds.has(id)) {
          nonAncestors.push(node);
        }
      }
    }
    return {ancestors, nonAncestors};
  }

  getAllAncestorAndNonAncestorBlocksDefaultStatus(blockRoot: RootHex): {
    ancestors: ProtoBlock[];
    nonAncestors: ProtoBlock[];
  } {
    const node = this.getDefaultNode(blockRoot);
    if (node === undefined) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }
    return this.getAllAncestorAndNonAncestorBlocks(blockRoot, node.payloadStatus);
  }

  getCanonicalBlockByRoot(blockRoot: Root): ProtoBlock | null {
    const blockRootHex = toRootHex(blockRoot);
    if (blockRootHex === this.head.blockRoot) {
      return this.head;
    }
    for (const block of this.iterateAncestorBlocks(this.head.blockRoot, this.head.payloadStatus)) {
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
    for (const block of this.iterateAncestorBlocks(this.head.blockRoot, this.head.payloadStatus)) {
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
    for (const block of this.iterateAncestorBlocks(this.head.blockRoot, this.head.payloadStatus)) {
      if (slot >= block.slot) {
        return block;
      }
    }
    return null;
  }

  forwarditerateAncestorBlocks(): ProtoBlock[] {
    return this.nodeIds().map((id) => this.nodes[id] as ProtoBlock);
  }

  *forwardIterateDescendants(blockRoot: RootHex, payloadStatus: PayloadStatus): IterableIterator<ProtoBlock> {
    const startId = this.getNodeId(blockRoot, payloadStatus);
    if (startId === undefined) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }
    const rootsInChain = new Set([blockRoot]);
    for (const id of this.nodeIds()) {
      const node = this.nodes[id] as ProtoBlock;
      if (Math.floor(id / 3) > Math.floor(startId / 3) && rootsInChain.has(node.parentRoot)) {
        rootsInChain.add(node.blockRoot);
        yield node;
      }
    }
  }

  forwardIterateDescendantsDefaultStatus(blockRoot: RootHex): IterableIterator<ProtoBlock> {
    const node = this.getDefaultNode(blockRoot);
    if (node === undefined) {
      throw new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: blockRoot});
    }
    return this.forwardIterateDescendants(blockRoot, node.payloadStatus);
  }

  getBlockSummariesByParentRoot(parentRoot: RootHex): ProtoBlock[] {
    return this.defaultNodes().filter((node) => node.parentRoot === parentRoot);
  }

  getBlockSummariesAtSlot(slot: Slot): ProtoBlock[] {
    return this.defaultNodes().filter((node) => node.slot === slot);
  }

  getCommonAncestorDepth(prevBlock: ProtoBlock, newBlock: ProtoBlock): AncestorResult {
    let prevIndex = this.blockIndexByRoot.get(prevBlock.blockRoot);
    let newIndex = this.blockIndexByRoot.get(newBlock.blockRoot);
    if (
      this.getNodeId(prevBlock.blockRoot, prevBlock.payloadStatus) === undefined ||
      this.getNodeId(newBlock.blockRoot, newBlock.payloadStatus) === undefined
    ) {
      return {code: AncestorStatus.BlockUnknown};
    }

    // A parent's block index is always lower than its child's
    while (prevIndex !== undefined && newIndex !== undefined && prevIndex !== newIndex) {
      if (prevIndex > newIndex) prevIndex = this.parentBlockIndex(prevIndex);
      else newIndex = this.parentBlockIndex(newIndex);
    }
    if (prevIndex === undefined || newIndex === undefined) {
      return {code: AncestorStatus.NoCommonAncenstor};
    }

    const commonAncestor = this.nodes[prevIndex * 3 + SPEC_PENDING] as ProtoBlock;
    if (commonAncestor.blockRoot === prevBlock.blockRoot || commonAncestor.blockRoot === newBlock.blockRoot) {
      return {code: AncestorStatus.Descendant};
    }
    return {code: AncestorStatus.CommonAncestor, depth: Math.max(newBlock.slot, prevBlock.slot) - commonAncestor.slot};
  }

  getDependentRoot(block: ProtoBlock, epochDifference: EpochDifference): RootHex {
    const beforeSlot = block.slot - (block.slot % SLOTS_PER_EPOCH) - epochDifference * SLOTS_PER_EPOCH;

    // Close to genesis the dependent root is the genesis block root
    if (beforeSlot <= 0) {
      const genesisBlock = this.nodes[SPEC_PENDING];
      if (genesisBlock === undefined || genesisBlock.slot !== 0) {
        throw Error("Genesis block not available");
      }
      return genesisBlock.blockRoot;
    }

    const finalizedSlot = this.getFinalizedBlock().slot;
    while (block.slot >= finalizedSlot) {
      if (block.slot < beforeSlot) {
        return block.blockRoot;
      }
      if (block.slot === beforeSlot) {
        return block.parentRoot;
      }

      // A block at the first slot of its epoch is its own target
      const nextRoot = block.blockRoot === block.targetRoot ? block.parentRoot : block.targetRoot;
      const nextBlock = this.getDefaultNode(nextRoot);
      if (nextBlock === undefined) {
        throw Error(`No block for root ${nextRoot}`);
      }
      block = nextBlock;
    }

    throw Error(`Not found dependent root for block slot ${block.slot}, epoch difference ${epochDifference}`);
  }

  // Node bookkeeping

  private nodeCount(): number {
    let count = 0;
    for (const node of this.nodes) {
      if (node !== undefined) count++;
    }
    return count;
  }

  private mutated(): void {
    this.scores = null;
    this.latestMessages = null;
  }

  private getScores(): NativeScores {
    this.scores ??= {
      weights: this.store.weights(),
      attestationScores: this.store.attestationScores(),
      bestChildren: this.store.bestChildren(),
    };
    return this.scores;
  }

  private getLatestMessages(): {slots: Float64Array; nodes: Uint32Array} {
    this.latestMessages ??= this.store.latestMessages();
    return this.latestMessages;
  }

  private insertBlock(blockIndex: number, block: ProtoBlock): void {
    this.blockIndexByRoot.set(block.blockRoot, blockIndex);
    this.parentNodes[blockIndex] = this.store.parentNode(blockIndex);
    if (isGloasBlock(block)) {
      this.nodes[blockIndex * 3 + SPEC_PENDING] = {...block, payloadStatus: PayloadStatus.PENDING};
      this.nodes[blockIndex * 3 + SPEC_EMPTY] = {...block, payloadStatus: PayloadStatus.EMPTY};
    } else {
      this.nodes[blockIndex * 3 + SPEC_PENDING] = {...block, payloadStatus: PayloadStatus.FULL};
    }
  }

  /** Ids of the existing nodes, block by block in import order: PENDING or pre-Gloas, EMPTY, FULL */
  private nodeIds(): number[] {
    const ids: number[] = [];
    for (let blockIndex = 0; blockIndex * 3 < this.nodes.length; blockIndex++) {
      for (const status of [SPEC_PENDING, SPEC_EMPTY, SPEC_FULL]) {
        if (this.nodes[blockIndex * 3 + status] !== undefined) {
          ids.push(blockIndex * 3 + status);
        }
      }
    }
    return ids;
  }

  /** One node per block: FULL before Gloas, PENDING from Gloas on */
  private defaultNodes(): ProtoBlock[] {
    return Array.from(
      this.blockIndexByRoot.values(),
      (blockIndex) => this.nodes[blockIndex * 3 + SPEC_PENDING] as ProtoBlock
    );
  }

  private getDefaultNode(blockRoot: RootHex): ProtoBlock | undefined {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    return blockIndex === undefined ? undefined : this.nodes[blockIndex * 3 + SPEC_PENDING];
  }

  private getNodeId(blockRoot: RootHex, payloadStatus: PayloadStatus): number | undefined {
    const blockIndex = this.blockIndexByRoot.get(blockRoot);
    if (blockIndex === undefined) {
      return undefined;
    }
    if (!isGloasBlock(this.nodes[blockIndex * 3 + SPEC_PENDING] as ProtoBlock)) {
      if (payloadStatus !== PayloadStatus.FULL) {
        throw new ProtoArrayError({code: ProtoArrayErrorCode.INVALID_NODE_INDEX, index: payloadStatus});
      }
      return blockIndex * 3 + SPEC_PENDING;
    }
    const status =
      payloadStatus === PayloadStatus.PENDING
        ? SPEC_PENDING
        : payloadStatus === PayloadStatus.EMPTY
          ? SPEC_EMPTY
          : SPEC_FULL;
    const id = blockIndex * 3 + status;
    return this.nodes[id] === undefined ? undefined : id;
  }

  private parentBlockIndex(blockIndex: number): number | undefined {
    const parentNode = this.parentNodes[blockIndex];
    return parentNode === undefined ? undefined : Math.floor(parentNode / 3);
  }

  /** The variant of the parent a block with this bid `parent_block_hash` builds on */
  private getParent(parentRoot: RootHex, parentBlockHash: RootHex | null): ProtoBlock | null {
    const parent = this.getDefaultNode(parentRoot);
    if (parent === undefined) {
      return null;
    }
    // A pre-Gloas parent has one variant, also for the first Gloas block
    if (parentBlockHash === null || !isGloasBlock(parent)) {
      return parent;
    }
    return this.getBlockHexAndBlockHash(parentRoot, parentBlockHash);
  }

  private isFinalizedRootOrDescendant(blockIndex: number): boolean {
    const node = this.nodes[blockIndex * 3 + SPEC_PENDING] as ProtoBlock;
    const {epoch, rootHex} = this.fcStore.finalizedCheckpoint;
    if (
      (node.finalizedEpoch === epoch && node.finalizedRoot === rootHex) ||
      (node.justifiedEpoch === epoch && node.justifiedRoot === rootHex) ||
      (node.unrealizedFinalizedEpoch === epoch && node.unrealizedFinalizedRoot === rootHex) ||
      (node.unrealizedJustifiedEpoch === epoch && node.unrealizedJustifiedRoot === rootHex)
    ) {
      return true;
    }
    return this.store.isFinalizedDescendant(blockIndex);
  }

  // Errors

  private toInvalidBlockError(
    e: unknown,
    block: BeaconBlock,
    parentRootHex: RootHex,
    parentHashHex: RootHex | null
  ): unknown {
    const finalized = this.fcStore.finalizedCheckpoint;
    switch (nativeErrorCode(e)) {
      case "UnknownParent":
      case "ParentPayloadNotVerified":
        return new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_BLOCK,
          err: {code: InvalidBlockCode.UNKNOWN_PARENT, root: parentRootHex, hash: parentHashHex},
        });
      case "FutureBlock":
        return new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_BLOCK,
          err: {code: InvalidBlockCode.FUTURE_SLOT, currentSlot: this.store.currentSlot, blockSlot: block.slot},
        });
      case "BlockBeforeFinalizedSlot":
        return new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_BLOCK,
          err: {
            code: InvalidBlockCode.FINALIZED_SLOT,
            finalizedSlot: computeStartSlotAtEpoch(finalized.epoch),
            blockSlot: block.slot,
          },
        });
      case "NotFinalizedDescendant":
        return new ForkChoiceError({
          code: ForkChoiceErrorCode.INVALID_BLOCK,
          err: {code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT, finalizedRoot: finalized.rootHex},
        });
      default:
        return e;
    }
  }

  private toInvalidAttestationError(e: unknown, data: phase0.AttestationData): unknown {
    const currentEpoch = computeEpochAtSlot(this.store.currentSlot);
    const beaconBlockRoot = toRootHex(data.beaconBlockRoot);
    const invalid = (err: ConstructorParameters<typeof ForkChoiceError>[0] & {err: unknown}): ForkChoiceError =>
      new ForkChoiceError(err);
    switch (nativeErrorCode(e)) {
      case "AttestationTargetEpochNotCurrentOrPrevious":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err:
            data.target.epoch > currentEpoch
              ? {code: InvalidAttestationCode.FUTURE_EPOCH, attestationEpoch: data.target.epoch, currentEpoch}
              : {code: InvalidAttestationCode.PAST_EPOCH, attestationEpoch: data.target.epoch, currentEpoch},
        });
      case "AttestationTargetEpochSlotMismatch":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {code: InvalidAttestationCode.BAD_TARGET_EPOCH, target: data.target.epoch, slot: data.slot},
        });
      case "UnknownAttestationTarget":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT, root: toRootHex(data.target.root)},
        });
      case "UnknownAttestationBlock":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK, beaconBlockRoot},
        });
      case "AttestationForFutureBlock":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {
            code: InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK,
            block: this.getDefaultNode(beaconBlockRoot)?.slot ?? data.slot,
            attestation: data.slot,
          },
        });
      case "InvalidAttestationIndex":
      case "SameSlotFullVote":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {code: InvalidAttestationCode.INVALID_DATA_INDEX, index: data.index},
        });
      case "AttestationPayloadNotVerified":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {code: InvalidAttestationCode.UNKNOWN_PAYLOAD_STATUS, beaconBlockRoot},
        });
      case "AttestationTargetNotInChain":
        return invalid({
          code: ForkChoiceErrorCode.INVALID_ATTESTATION,
          err: {
            code: InvalidAttestationCode.INVALID_TARGET,
            attestation: toRootHex(data.target.root),
            local: this.getDefaultNode(beaconBlockRoot)?.targetRoot ?? HEX_ZERO_HASH,
          },
        });
      default:
        return e;
    }
  }
}

/** The Zig error name of a failed native call */
function nativeErrorCode(e: unknown): string | undefined {
  return (e as {code?: string}).code;
}

/** Slashings may carry their attestation data with bigint slots and epochs */
function toNativeAttestationData(data: AttesterSlashing["attestation1"]["data"]): NativeAttestationData {
  return {
    slot: Number(data.slot),
    index: Number(data.index),
    beaconBlockRoot: data.beaconBlockRoot,
    source: {epoch: Number(data.source.epoch), root: data.source.root},
    target: {epoch: Number(data.target.epoch), root: data.target.root},
  };
}
