import {toHexString} from "@chainsafe/ssz";
import {SAFE_SLOTS_TO_UPDATE_JUSTIFIED, SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot, ValidatorIndex, phase0, allForks, ssz, RootHex, Epoch, Root} from "@chainsafe/lodestar-types";
import {
  getCurrentInterval,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  computeEpochAtSlot,
  ZERO_HASH,
  bellatrix,
  EffectiveBalanceIncrements,
  BeaconStateAllForks,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainConfig, IChainForkConfig} from "@chainsafe/lodestar-config";

import {computeDeltas} from "../protoArray/computeDeltas.js";
import {HEX_ZERO_HASH, IVoteTracker, IProtoBlock, ExecutionStatus} from "../protoArray/interface.js";
import {ProtoArray} from "../protoArray/protoArray.js";

import {IForkChoiceMetrics} from "../metrics.js";
import {ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode, InvalidAttestationCode} from "./errors.js";
import {IForkChoice, ILatestMessage, IQueuedAttestation, OnBlockPrecachedData} from "./interface.js";
import {IForkChoiceStore, CheckpointWithHex, toCheckpointWithHex} from "./store.js";

/* eslint-disable max-len */

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
  /**
   * Votes currently tracked in the protoArray
   * Indexed by validator index
   * Each vote contains the latest message and previous message
   */
  private readonly votes: IVoteTracker[] = [];

  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   */
  private readonly queuedAttestations = new Set<IQueuedAttestation>();

  /**
   * Balances tracked in the protoArray, or soon to be tracked
   * Indexed by validator index
   *
   * This should be the balances of the state at fcStore.bestJustifiedCheckpoint
   */
  private bestJustifiedBalances: EffectiveBalanceIncrements;

  /** Avoid having to compute detas all the times. */
  private synced = false;
  /** Cached head */
  private head: IProtoBlock;
  /**
   * Only cache attestation data root hex if it's tree backed since it's available.
   **/
  private validatedAttestationDatas = new Set<string>();
  /** Boost the entire branch with this proposer root as the leaf */
  private proposerBoostRoot: RootHex | null = null;
  /** Score to use in proposer boost, evaluated lazily from justified balances */
  private justifiedProposerBoostScore: number | null = null;
  /**
   * Instantiates a Fork Choice from some existing components
   *
   * This is useful if the existing components have been loaded from disk after a process restart.
   */
  constructor(
    private readonly config: IChainForkConfig,
    private readonly fcStore: IForkChoiceStore,
    /** The underlying representation of the block DAG. */
    private readonly protoArray: ProtoArray,
    /**
     * Balances currently tracked in the protoArray
     * Indexed by validator index
     *
     * This should be the balances of the state at fcStore.justifiedCheckpoint
     */
    private justifiedBalances: EffectiveBalanceIncrements,
    private readonly proposerBoostEnabled: boolean,
    private readonly metrics?: IForkChoiceMetrics | null
  ) {
    this.bestJustifiedBalances = justifiedBalances;
    this.head = this.updateHead();
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
    const block = this.protoArray.getBlock(blockRoot);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot,
      });
    }

    if (block.slot > ancestorSlot) {
      // Search for a slot that is lte the target slot.
      // We check for lower slots to account for skip slots.
      for (const node of this.protoArray.iterateAncestorNodes(blockRoot)) {
        if (node.slot <= ancestorSlot) {
          return node.blockRoot;
        }
      }
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
        descendantRoot: blockRoot,
        ancestorSlot,
      });
    } else {
      // Root is older or equal than queried slot, thus a skip slot. Return most recent root prior to slot.
      return blockRoot;
    }
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
  getHead(): IProtoBlock {
    return this.head;
  }

  /**
   * Get the proposer boost root
   */
  getProposerBoostRoot(): RootHex {
    return this.proposerBoostRoot ?? HEX_ZERO_HASH;
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
  updateHead(): IProtoBlock {
    // balances is not changed but votes are changed

    let timer;
    this.metrics?.forkChoiceRequests.inc();
    try {
      let deltas: number[];

      // Check if scores need to be calculated/updated
      if (!this.synced) {
        // eslint-disable-next-line prefer-const
        timer = this.metrics?.forkChoiceFindHead.startTimer();
        // eslint-disable-next-line prefer-const
        deltas = computeDeltas(this.protoArray.indices, this.votes, this.justifiedBalances, this.justifiedBalances);
        /**
         * The structure in line with deltas to propogate boost up the branch
         * starting from the proposerIndex
         */
        let proposerBoost: {root: RootHex; score: number} | null = null;
        if (this.proposerBoostEnabled && this.proposerBoostRoot) {
          const proposerBoostScore =
            this.justifiedProposerBoostScore ??
            computeProposerBoostScoreFromBalances(this.justifiedBalances, {
              slotsPerEpoch: SLOTS_PER_EPOCH,
              proposerScoreBoost: this.config.PROPOSER_SCORE_BOOST,
            });
          proposerBoost = {root: this.proposerBoostRoot, score: proposerBoostScore};
          this.justifiedProposerBoostScore = proposerBoostScore;
        }

        this.protoArray.applyScoreChanges({
          deltas,
          proposerBoost,
          justifiedEpoch: this.fcStore.justifiedCheckpoint.epoch,
          justifiedRoot: this.fcStore.justifiedCheckpoint.rootHex,
          finalizedEpoch: this.fcStore.finalizedCheckpoint.epoch,
          finalizedRoot: this.fcStore.finalizedCheckpoint.rootHex,
        });
        this.synced = true;
      }

      const headRoot = this.protoArray.findHead(this.fcStore.justifiedCheckpoint.rootHex);
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
      return (this.head = headNode);
    } catch (e) {
      this.metrics?.forkChoiceErrors.inc();
      throw e;
    } finally {
      if (timer) timer();
    }
  }

  /** Very expensive function, iterates the entire ProtoArray. Called only in debug API */
  getHeads(): IProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.bestChild === undefined);
  }

  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.finalizedCheckpoint;
  }

  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.justifiedCheckpoint;
  }

  getBestJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.bestJustifiedCheckpoint;
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
  onBlock(block: allForks.BeaconBlock, state: BeaconStateAllForks, preCachedData?: OnBlockPrecachedData): void {
    const {parentRoot, slot} = block;
    const parentRootHex = toHexString(parentRoot);
    // Parent block must be known
    if (!this.protoArray.hasBlock(parentRootHex)) {
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

    if (
      preCachedData?.isMergeTransitionBlock ||
      (bellatrix.isBellatrixStateType(state) &&
        bellatrix.isBellatrixBlockBodyType(block.body) &&
        bellatrix.isMergeTransitionBlock(state, block.body))
    )
      assertValidTerminalPowBlock(this.config, (block as unknown) as bellatrix.BeaconBlock, preCachedData);

    let shouldUpdateJustified = false;
    const {finalizedCheckpoint} = state;
    const currentJustifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const stateJustifiedEpoch = currentJustifiedCheckpoint.epoch;

    // Update justified checkpoint.
    if (stateJustifiedEpoch > this.fcStore.justifiedCheckpoint.epoch) {
      const {justifiedBalances} = preCachedData || {};
      if (!justifiedBalances) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNABLE_TO_SET_JUSTIFIED_CHECKPOINT,
          error: new Error("No validator balances supplied"),
        });
      }
      if (stateJustifiedEpoch > this.fcStore.bestJustifiedCheckpoint.epoch) {
        this.updateBestJustified(currentJustifiedCheckpoint, justifiedBalances);
      }
      if (this.shouldUpdateJustifiedCheckpoint(state)) {
        // wait to update until after finalized checkpoint is set
        shouldUpdateJustified = true;
      }
    }

    // Update finalized checkpoint.
    if (finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      this.fcStore.finalizedCheckpoint = toCheckpointWithHex(finalizedCheckpoint);
      shouldUpdateJustified = true;
      this.synced = false;
    }

    // This needs to be performed after finalized checkpoint has been updated
    if (shouldUpdateJustified) {
      const {justifiedBalances} = preCachedData || {};
      if (!justifiedBalances) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNABLE_TO_SET_JUSTIFIED_CHECKPOINT,
          error: new Error("No validator balances supplied"),
        });
      }

      this.updateJustified(currentJustifiedCheckpoint, justifiedBalances);
    }

    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toHexString(blockRoot);

    // Add proposer score boost if the block is timely
    if (this.proposerBoostEnabled && slot === this.fcStore.currentSlot) {
      const {blockDelaySec} = preCachedData || {};
      if (blockDelaySec === undefined) {
        throw Error("Missing blockDelaySec info for proposerBoost");
      }

      const proposerInterval = getCurrentInterval(this.config, blockDelaySec);
      if (proposerInterval < 1) {
        this.proposerBoostRoot = blockRootHex;
        this.synced = false;
      }
    }

    const targetSlot = computeStartSlotAtEpoch(computeEpochAtSlot(slot));
    const targetRoot = slot === targetSlot ? blockRoot : state.blockRoots.get(targetSlot % SLOTS_PER_HISTORICAL_ROOT);

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    this.protoArray.onBlock({
      slot: slot,
      blockRoot: blockRootHex,
      parentRoot: parentRootHex,
      targetRoot: toHexString(targetRoot),
      stateRoot: toHexString(block.stateRoot),

      justifiedEpoch: stateJustifiedEpoch,
      justifiedRoot: toHexString(state.currentJustifiedCheckpoint.root),
      finalizedEpoch: finalizedCheckpoint.epoch,
      finalizedRoot: toHexString(state.finalizedCheckpoint.root),

      ...(bellatrix.isBellatrixBlockBodyType(block.body) &&
      bellatrix.isBellatrixStateType(state) &&
      bellatrix.isExecutionEnabled(state, block.body)
        ? {
            executionPayloadBlockHash: toHexString(block.body.executionPayload.blockHash),
            executionStatus: this.getPostMergeExecStatus(preCachedData),
          }
        : {executionPayloadBlockHash: null, executionStatus: this.getPreMergeExecStatus(preCachedData)}),
    });
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
  onAttestation(attestation: phase0.IndexedAttestation): void {
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
    const blockRootHex = toHexString(beaconBlockRoot);
    const targetEpoch = attestationData.target.epoch;
    if (ssz.Root.equals(beaconBlockRoot, ZERO_HASH)) {
      return;
    }

    this.validateOnAttestation(attestation, slot, blockRootHex, targetEpoch);

    if (slot < this.fcStore.currentSlot) {
      for (const validatorIndex of attestation.attestingIndices) {
        this.addLatestMessage(validatorIndex, targetEpoch, blockRootHex);
      }
    } else {
      // The spec declares:
      //
      // ```
      // Attestations can only affect the fork choice of subsequent slots.
      // Delay consideration in the fork choice until their slot is in the past.
      // ```
      this.queuedAttestations.add({
        slot: slot,
        attestingIndices: attestation.attestingIndices,
        blockRoot: blockRootHex,
        targetEpoch,
      });
    }
  }

  getLatestMessage(validatorIndex: ValidatorIndex): ILatestMessage | undefined {
    const vote = this.votes[validatorIndex];
    if (vote === undefined) {
      return undefined;
    }
    return {
      epoch: vote.nextEpoch,
      root: vote.nextRoot,
    };
  }

  /**
   * Call `onTick` for all slots between `fcStore.getCurrentSlot()` and the provided `currentSlot`.
   */
  updateTime(currentSlot: Slot): void {
    while (this.fcStore.currentSlot < currentSlot) {
      const previousSlot = this.fcStore.currentSlot;
      // Note: we are relying upon `onTick` to update `fcStore.time` to ensure we don't get stuck in a loop.
      this.onTick(previousSlot + 1);
    }

    // Process any attestations that might now be eligible.
    this.processAttestationQueue();
    this.validatedAttestationDatas = new Set();
  }

  getTime(): Slot {
    return this.fcStore.currentSlot;
  }

  /** Returns `true` if the block is known **and** a descendant of the finalized root. */
  hasBlock(blockRoot: Root): boolean {
    return this.hasBlockHex(toHexString(blockRoot));
  }
  /** Returns a `IProtoBlock` if the block is known **and** a descendant of the finalized root. */
  getBlock(blockRoot: Root): IProtoBlock | null {
    return this.getBlockHex(toHexString(blockRoot));
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlockHex(blockRoot: RootHex): boolean {
    return this.protoArray.hasBlock(blockRoot) && this.isDescendantOfFinalized(blockRoot);
  }

  /**
   * Returns a `IProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlockHex(blockRoot: RootHex): IProtoBlock | null {
    const block = this.protoArray.getBlock(blockRoot);
    if (!block) {
      return null;
    }
    // If available, use the parent_root to perform the lookup since it will involve one
    // less lookup. This involves making the assumption that the finalized block will
    // always have `block.parent_root` of `None`.
    if (!this.isDescendantOfFinalized(blockRoot)) {
      return null;
    }
    return block;
  }

  getJustifiedBlock(): IProtoBlock {
    const block = this.getBlockHex(this.fcStore.justifiedCheckpoint.rootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: this.fcStore.justifiedCheckpoint.rootHex,
      });
    }
    return block;
  }

  getFinalizedBlock(): IProtoBlock {
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
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  isDescendantOfFinalized(blockRoot: RootHex): boolean {
    return this.protoArray.isDescendant(this.fcStore.finalizedCheckpoint.rootHex, blockRoot);
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

  prune(finalizedRoot: RootHex): IProtoBlock[] {
    return this.protoArray.maybePrune(finalizedRoot);
  }

  setPruneThreshold(threshold: number): void {
    this.protoArray.pruneThreshold = threshold;
  }

  /**
   * Iterates backwards through block summaries, starting from a block root.
   * Return only the non-finalized blocks.
   */
  iterateAncestorBlocks(blockRoot: RootHex): IterableIterator<IProtoBlock> {
    return this.protoArray.iterateAncestorNodes(blockRoot);
  }

  /**
   * Returns all blocks backwards starting from a block root.
   * Return only the non-finalized blocks.
   */
  getAllAncestorBlocks(blockRoot: RootHex): IProtoBlock[] {
    const blocks = this.protoArray.getAllAncestorNodes(blockRoot);
    // the last node is the previous finalized one, it's there to check onBlock finalized checkpoint only.
    return blocks.slice(0, blocks.length - 1);
  }

  /**
   * The same to iterateAncestorBlocks but this gets non-ancestor nodes instead of ancestor nodes.
   */
  getAllNonAncestorBlocks(blockRoot: RootHex): IProtoBlock[] {
    return this.protoArray.getAllNonAncestorNodes(blockRoot);
  }

  getCanonicalBlockAtSlot(slot: Slot): IProtoBlock | null {
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

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  forwarditerateAncestorBlocks(): IProtoBlock[] {
    return this.protoArray.nodes;
  }

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  getBlockSummariesByParentRoot(parentRoot: RootHex): IProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.parentRoot === parentRoot);
  }

  /** Very expensive function, iterates the entire ProtoArray. TODO: Is this function even necessary? */
  getBlockSummariesAtSlot(slot: Slot): IProtoBlock[] {
    const nodes = this.protoArray.nodes;
    const blocksAtSlot: IProtoBlock[] = [];
    for (let i = 0, len = nodes.length; i < len; i++) {
      const node = nodes[i];
      if (node.slot === slot) {
        blocksAtSlot.push(node);
      }
    }
    return blocksAtSlot;
  }

  /** Returns the distance of common ancestor of nodes to newNode. Returns null if newNode is descendant of prevNode */
  getCommonAncestorDistance(prevBlock: IProtoBlock, newBlock: IProtoBlock): number | null {
    const prevNode = this.protoArray.getNode(prevBlock.blockRoot);
    const newNode = this.protoArray.getNode(newBlock.blockRoot);
    if (!prevNode) throw Error(`No node if forkChoice for blockRoot ${prevBlock.blockRoot}`);
    if (!newNode) throw Error(`No node if forkChoice for blockRoot ${newBlock.blockRoot}`);

    const commonAncestor = this.protoArray.getCommonAncestor(prevNode, newNode);
    // No common ancestor, should never happen. Return null to not throw
    if (!commonAncestor) return null;

    // If common node is one of both nodes, then they are direct descendants, return null
    if (commonAncestor.blockRoot === prevNode.blockRoot || commonAncestor.blockRoot === newNode.blockRoot) {
      return null;
    }

    return newNode.slot - commonAncestor.slot;
  }

  /**
   * Optimistic sync validate till validated latest hash, invalidate any decendant branch if invalidate till hash provided
   * TODO: implementation:
   * 1. verify is_merge_block if the mergeblock has not yet been validated
   * 2. Throw critical error and exit if a block in finalized chain gets invalidated
   */
  validateLatestHash(_latestValidHash: RootHex, _invalidateTillHash: RootHex | null): void {
    // Silently ignore for now if all calls were valid
    return;
  }

  private getPreMergeExecStatus(preCachedData?: OnBlockPrecachedData): ExecutionStatus.PreMerge {
    const executionStatus = preCachedData?.executionStatus || ExecutionStatus.PreMerge;
    if (executionStatus !== ExecutionStatus.PreMerge)
      throw Error(`Invalid pre-merge execution status: expected: ${ExecutionStatus.PreMerge}, got ${executionStatus}`);
    return executionStatus;
  }

  private getPostMergeExecStatus(
    preCachedData?: OnBlockPrecachedData
  ): ExecutionStatus.Valid | ExecutionStatus.Syncing {
    const executionStatus = preCachedData?.executionStatus || ExecutionStatus.Syncing;
    if (executionStatus === ExecutionStatus.PreMerge)
      throw Error(
        `Invalid post-merge execution status: expected: ${ExecutionStatus.Syncing} or ${ExecutionStatus.Valid} , got ${executionStatus}`
      );
    return executionStatus;
  }

  private updateJustified(justifiedCheckpoint: CheckpointWithHex, justifiedBalances: EffectiveBalanceIncrements): void {
    this.synced = false;
    this.justifiedBalances = justifiedBalances;
    this.justifiedProposerBoostScore = null;
    this.fcStore.justifiedCheckpoint = justifiedCheckpoint;
  }

  private updateBestJustified(
    justifiedCheckpoint: CheckpointWithHex,
    justifiedBalances: EffectiveBalanceIncrements
  ): void {
    this.bestJustifiedBalances = justifiedBalances;
    this.fcStore.bestJustifiedCheckpoint = justifiedCheckpoint;
  }

  /**
   * Returns `true` if the given `store` should be updated to set
   * `state.current_justified_checkpoint` its `justified_checkpoint`.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#should_update_justified_checkpoint
   */
  private shouldUpdateJustifiedCheckpoint(state: BeaconStateAllForks): boolean {
    const {slot, currentJustifiedCheckpoint} = state;
    const newJustifiedCheckpoint = currentJustifiedCheckpoint;

    if (computeSlotsSinceEpochStart(this.fcStore.currentSlot) < SAFE_SLOTS_TO_UPDATE_JUSTIFIED) {
      return true;
    }

    const justifiedSlot = computeStartSlotAtEpoch(this.fcStore.justifiedCheckpoint.epoch);

    // This sanity check is not in the spec, but the invariant is implied
    if (justifiedSlot >= slot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ATTEMPT_TO_REVERT_JUSTIFICATION,
        store: justifiedSlot,
        state: slot,
      });
    }

    // at regular sync time we don't want to wait for clock time next epoch to update bestJustifiedCheckpoint
    if (computeEpochAtSlot(slot) < computeEpochAtSlot(this.fcStore.currentSlot)) {
      return true;
    }

    // We know that the slot for `new_justified_checkpoint.root` is not greater than
    // `state.slot`, since a state cannot justify its own slot.
    //
    // We know that `new_justified_checkpoint.root` is an ancestor of `state`, since a `state`
    // only ever justifies ancestors.
    //
    // A prior `if` statement protects against a justified_slot that is greater than
    // `state.slot`
    const justifiedAncestor = this.getAncestor(toHexString(newJustifiedCheckpoint.root), justifiedSlot);
    if (justifiedAncestor !== this.fcStore.justifiedCheckpoint.rootHex) {
      return false;
    }

    return true;
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
    targetEpoch: Epoch
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

    const attestationData = indexedAttestation.data;
    // AttestationData is expected to internally cache its root to make this hashTreeRoot() call free
    const attestationCacheKey = toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestationData));

    if (!this.validatedAttestationDatas.has(attestationCacheKey)) {
      this.validateAttestationData(indexedAttestation.data, slot, blockRootHex, targetEpoch, attestationCacheKey);
    }
  }

  private validateAttestationData(
    attestationData: phase0.AttestationData,
    slot: Slot,
    beaconBlockRootHex: string,
    targetEpoch: Epoch,
    attestationCacheKey: string
  ): void {
    const epochNow = computeEpochAtSlot(this.fcStore.currentSlot);
    const targetRootHex = toHexString(attestationData.target.root);

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
    } else if (targetEpoch + 1 < epochNow) {
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

    this.validatedAttestationDatas.add(attestationCacheKey);
  }

  /**
   * Add a validator's latest message to the tracked votes
   */
  private addLatestMessage(validatorIndex: ValidatorIndex, nextEpoch: Epoch, nextRoot: RootHex): void {
    this.synced = false;
    const vote = this.votes[validatorIndex];
    if (vote === undefined) {
      this.votes[validatorIndex] = {
        currentRoot: HEX_ZERO_HASH,
        nextRoot,
        nextEpoch,
      };
    } else if (nextEpoch > vote.nextEpoch) {
      vote.nextRoot = nextRoot;
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
    for (const attestation of this.queuedAttestations.values()) {
      if (attestation.slot <= currentSlot) {
        this.queuedAttestations.delete(attestation);
        const {blockRoot, targetEpoch} = attestation;
        const blockRootHex = blockRoot;
        for (const validatorIndex of attestation.attestingIndices) {
          this.addLatestMessage(validatorIndex, targetEpoch, blockRootHex);
        }
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
    if (this.proposerBoostRoot) {
      // Since previous weight was boosted, we need would now need to recalculate the
      // scores but without the boost
      this.proposerBoostRoot = null;
      this.synced = false;
    }

    const currentSlot = time;
    if (computeSlotsSinceEpochStart(currentSlot) !== 0) {
      return;
    }

    const {bestJustifiedCheckpoint, justifiedCheckpoint, finalizedCheckpoint} = this.fcStore;
    // Update store.justified_checkpoint if a better checkpoint on the store.finalized_checkpoint chain
    if (bestJustifiedCheckpoint.epoch > justifiedCheckpoint.epoch) {
      const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
      const ancestorAtFinalizedSlot = this.getAncestor(bestJustifiedCheckpoint.rootHex, finalizedSlot);
      if (ancestorAtFinalizedSlot === finalizedCheckpoint.rootHex) {
        this.updateJustified(this.fcStore.bestJustifiedCheckpoint, this.bestJustifiedBalances);
      }
    }
  }
}

function assertValidTerminalPowBlock(
  config: IChainConfig,
  block: bellatrix.BeaconBlock,
  preCachedData?: OnBlockPrecachedData
): void {
  if (!ssz.Root.equals(config.TERMINAL_BLOCK_HASH, ZERO_HASH)) {
    if (computeEpochAtSlot(block.slot) < config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH)
      throw Error(`Terminal block activation epoch ${config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH} not reached`);

    // powBock.blockhash is hex, so we just pick the corresponding root
    if (!ssz.Root.equals(block.body.executionPayload.parentHash, config.TERMINAL_BLOCK_HASH))
      throw new Error(
        `Invalid terminal block hash, expected: ${toHexString(config.TERMINAL_BLOCK_HASH)}, actual: ${toHexString(
          block.body.executionPayload.parentHash
        )}`
      );
  } else {
    // If no TERMINAL_BLOCK_HASH override, check ttd

    // Delay powBlock checks if the payload execution status is unknown because of
    // syncing response in notifyNewPayload call while verifying
    if (preCachedData?.executionStatus === ExecutionStatus.Syncing) return;

    const {powBlock, powBlockParent} = preCachedData || {};
    if (!powBlock) throw Error("onBlock preCachedData must include powBlock");
    if (!powBlockParent) throw Error("onBlock preCachedData must include powBlock");

    const isTotalDifficultyReached = powBlock.totalDifficulty >= config.TERMINAL_TOTAL_DIFFICULTY;
    const isParentTotalDifficultyValid = powBlockParent.totalDifficulty < config.TERMINAL_TOTAL_DIFFICULTY;
    if (!isTotalDifficultyReached || !isParentTotalDifficultyValid)
      throw Error(
        `Invalid terminal POW block: total difficulty not reached ${powBlockParent.totalDifficulty} < ${powBlock.totalDifficulty}`
      );
  }
}

function computeProposerBoostScore(
  {
    justifiedTotalActiveBalanceByIncrement,
    justifiedActiveValidators,
  }: {justifiedTotalActiveBalanceByIncrement: number; justifiedActiveValidators: number},
  config: {slotsPerEpoch: number; proposerScoreBoost: number}
): number {
  const avgBalanceByIncrement = Math.floor(justifiedTotalActiveBalanceByIncrement / justifiedActiveValidators);
  const committeeSize = Math.floor(justifiedActiveValidators / config.slotsPerEpoch);
  const committeeWeight = committeeSize * avgBalanceByIncrement;
  const proposerScore = Math.floor((committeeWeight * config.proposerScoreBoost) / 100);
  return proposerScore;
}

export function computeProposerBoostScoreFromBalances(
  justifiedBalances: EffectiveBalanceIncrements,
  config: {slotsPerEpoch: number; proposerScoreBoost: number}
): number {
  let justifiedTotalActiveBalanceByIncrement = 0,
    justifiedActiveValidators = 0;
  for (let i = 0; i < justifiedBalances.length; i++) {
    if (justifiedBalances[i] > 0) {
      justifiedActiveValidators += 1;
      // justified balances here are by increment
      justifiedTotalActiveBalanceByIncrement += justifiedBalances[i];
    }
  }
  return computeProposerBoostScore({justifiedTotalActiveBalanceByIncrement, justifiedActiveValidators}, config);
}
