import {toHexString} from "@chainsafe/ssz";
import {
  SAFE_SLOTS_TO_UPDATE_JUSTIFIED,
  SLOTS_PER_HISTORICAL_ROOT,
  SLOTS_PER_EPOCH,
  INTERVALS_PER_SLOT,
} from "@lodestar/params";
import {bellatrix, Slot, ValidatorIndex, phase0, allForks, ssz, RootHex, Epoch, Root} from "@lodestar/types";
import {
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  computeEpochAtSlot,
  ZERO_HASH,
  EffectiveBalanceIncrements,
  CachedBeaconStateAllForks,
  isBellatrixBlockBodyType,
  isBellatrixStateType,
  isExecutionEnabled,
} from "@lodestar/state-transition";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";

import {computeDeltas} from "../protoArray/computeDeltas.js";
import {HEX_ZERO_HASH, VoteTracker, ProtoBlock, ExecutionStatus} from "../protoArray/interface.js";
import {ProtoArray} from "../protoArray/protoArray.js";

import {IForkChoiceMetrics} from "../metrics.js";
import {ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode, InvalidAttestationCode} from "./errors.js";
import {IForkChoice, LatestMessage, QueuedAttestation, PowBlockHex} from "./interface.js";
import {IForkChoiceStore, CheckpointWithHex, toCheckpointWithHex, JustifiedBalances} from "./store.js";

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
  private readonly votes: VoteTracker[] = [];

  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   */
  private readonly queuedAttestations = new Set<QueuedAttestation>();

  // Note: as of Jun 2022 Lodestar metrics show that 100% of the times updateHead() is called, synced = false.
  // Because we are processing attestations from gossip, recomputing scores is always necessary
  // /** Avoid having to compute detas all the times. */
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
    private readonly proposerBoostEnabled: boolean,
    private readonly metrics?: IForkChoiceMetrics | null
  ) {
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
  getHead(): ProtoBlock {
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
  updateHead(): ProtoBlock {
    // balances is not changed but votes are changed

    this.metrics?.forkChoiceRequests.inc();
    const timer = this.metrics?.forkChoiceFindHead.startTimer();

    // NOTE: In current Lodestar metrics, 100% of forkChoiceRequests this.synced = false.
    // No need to cache computeDeltas()
    //
    // TODO: In current Lodestar metrics, 100% of forkChoiceRequests result in a changed head.
    // No need to cache the head anymore

    // Check if scores need to be calculated/updated
    // eslint-disable-next-line prefer-const
    const justifiedBalances = this.fcStore.justified.balances;
    const deltas = computeDeltas(this.protoArray.indices, this.votes, justifiedBalances, justifiedBalances);
    /**
     * The structure in line with deltas to propogate boost up the branch
     * starting from the proposerIndex
     */
    let proposerBoost: {root: RootHex; score: number} | null = null;
    if (this.proposerBoostEnabled && this.proposerBoostRoot) {
      const proposerBoostScore =
        this.justifiedProposerBoostScore ??
        computeProposerBoostScoreFromBalances(this.fcStore.justified.balances, {
          slotsPerEpoch: SLOTS_PER_EPOCH,
          proposerScoreBoost: this.config.PROPOSER_SCORE_BOOST,
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

    timer?.();

    return (this.head = headNode);
  }

  /** Very expensive function, iterates the entire ProtoArray. Called only in debug API */
  getHeads(): ProtoBlock[] {
    return this.protoArray.nodes.filter((node) => node.bestChild === undefined);
  }

  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.fcStore.finalizedCheckpoint;
  }

  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.justified.checkpoint;
  }

  getBestJustifiedCheckpoint(): CheckpointWithHex {
    return this.fcStore.bestJustified.checkpoint;
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
    block: allForks.BeaconBlock,
    state: CachedBeaconStateAllForks,
    blockDelaySec: number,
    currentSlot: Slot,
    /**
     * Compute by running process_justification_and_finalization on `state`, and returning
     * state.justified_checkpoint, state.finalized_checkpoint
     */
    unrealized: {
      justifiedCheckpoint: phase0.Checkpoint;
      finalizedCheckpoint: phase0.Checkpoint;
    },
    executionStatus: ExecutionStatus
  ): void {
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

    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toHexString(blockRoot);

    // Add proposer score boost if the block is timely
    // before attesting interval = before 1st interval
    if (
      this.proposerBoostEnabled &&
      this.fcStore.currentSlot === slot &&
      blockDelaySec < this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT
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

    const currentJustifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const stateJustifiedEpoch = currentJustifiedCheckpoint.epoch;

    const justifiedCheckpoint = toCheckpointWithHex(state.currentJustifiedCheckpoint);
    const finalizedCheckpoint = toCheckpointWithHex(state.finalizedCheckpoint);

    // Justified balances for `justifiedCheckpoint` are new to the fork-choice. Compute them on demand only if
    // the justified checkpoint changes
    this.updateCheckpoints(state.slot, justifiedCheckpoint, finalizedCheckpoint, () =>
      this.fcStore.justifiedBalancesGetter(justifiedCheckpoint, state)
    );

    const unrealizedJustifiedCheckpoint = toCheckpointWithHex(unrealized.justifiedCheckpoint);
    const unrealizedFinalizedCheckpoint = toCheckpointWithHex(unrealized.finalizedCheckpoint);

    // Un-realized checkpoints
    // Update best known unrealized justified & finalized checkpoints
    if (unrealizedJustifiedCheckpoint.epoch > this.fcStore.unrealizedJustified.checkpoint.epoch) {
      this.fcStore.unrealizedJustified = {
        checkpoint: unrealizedJustifiedCheckpoint,
        balances: this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state),
      };
    }
    if (unrealized.finalizedCheckpoint.epoch > this.fcStore.unrealizedFinalizedCheckpoint.epoch) {
      this.fcStore.unrealizedFinalizedCheckpoint = unrealizedFinalizedCheckpoint;
    }

    // If block is from past epochs, try to update store's justified & finalized checkpoints right away
    if (computeEpochAtSlot(block.slot) < computeEpochAtSlot(currentSlot)) {
      // Compute justified balances for unrealizedJustifiedCheckpoint on demand
      this.updateCheckpoints(state.slot, unrealizedJustifiedCheckpoint, unrealizedFinalizedCheckpoint, () =>
        this.fcStore.justifiedBalancesGetter(unrealizedJustifiedCheckpoint, state)
      );
    }

    const targetSlot = computeStartSlotAtEpoch(computeEpochAtSlot(slot));
    const targetRoot = slot === targetSlot ? blockRoot : state.blockRoots.get(targetSlot % SLOTS_PER_HISTORICAL_ROOT);

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    this.protoArray.onBlock(
      {
        slot: slot,
        blockRoot: blockRootHex,
        parentRoot: parentRootHex,
        targetRoot: toHexString(targetRoot),
        stateRoot: toHexString(block.stateRoot),

        justifiedEpoch: stateJustifiedEpoch,
        justifiedRoot: toHexString(state.currentJustifiedCheckpoint.root),
        finalizedEpoch: finalizedCheckpoint.epoch,
        finalizedRoot: toHexString(state.finalizedCheckpoint.root),
        unrealizedJustifiedEpoch: unrealizedJustifiedCheckpoint.epoch,
        unrealizedJustifiedRoot: unrealizedJustifiedCheckpoint.rootHex,
        unrealizedFinalizedEpoch: unrealizedFinalizedCheckpoint.epoch,
        unrealizedFinalizedRoot: unrealizedFinalizedCheckpoint.rootHex,

        ...(isBellatrixBlockBodyType(block.body) && isBellatrixStateType(state) && isExecutionEnabled(state, block)
          ? {
              executionPayloadBlockHash: toHexString(block.body.executionPayload.blockHash),
              executionStatus: this.getPostMergeExecStatus(executionStatus),
            }
          : {executionPayloadBlockHash: null, executionStatus: this.getPreMergeExecStatus(executionStatus)}),
      },
      currentSlot
    );
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
  onAttestation(attestation: phase0.IndexedAttestation, attDataRoot?: string): void {
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

    this.validateOnAttestation(attestation, slot, blockRootHex, targetEpoch, attDataRoot);

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

  getLatestMessage(validatorIndex: ValidatorIndex): LatestMessage | undefined {
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
    if (this.fcStore.currentSlot >= currentSlot) return;
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
  /** Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root. */
  getBlock(blockRoot: Root): ProtoBlock | null {
    return this.getBlockHex(toHexString(blockRoot));
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlockHex(blockRoot: RootHex): boolean {
    return this.protoArray.hasBlock(blockRoot) && this.isDescendantOfFinalized(blockRoot);
  }

  /**
   * Returns a `ProtoBlock` if the block is known **and** a descendant of the finalized root.
   */
  getBlockHex(blockRoot: RootHex): ProtoBlock | null {
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

  prune(finalizedRoot: RootHex): ProtoBlock[] {
    return this.protoArray.maybePrune(finalizedRoot);
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

  /** Returns the distance of common ancestor of nodes to newNode. Returns null if newNode is descendant of prevNode */
  getCommonAncestorDistance(prevBlock: ProtoBlock, newBlock: ProtoBlock): number | null {
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

  private getPreMergeExecStatus(executionStatus: ExecutionStatus): ExecutionStatus.PreMerge {
    if (executionStatus !== ExecutionStatus.PreMerge)
      throw Error(`Invalid pre-merge execution status: expected: ${ExecutionStatus.PreMerge}, got ${executionStatus}`);
    return executionStatus;
  }

  private getPostMergeExecStatus(executionStatus: ExecutionStatus): ExecutionStatus.Valid | ExecutionStatus.Syncing {
    if (executionStatus === ExecutionStatus.PreMerge)
      throw Error(
        `Invalid post-merge execution status: expected: ${ExecutionStatus.Syncing} or ${ExecutionStatus.Valid} , got ${executionStatus}`
      );
    return executionStatus;
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
  private shouldUpdateJustifiedCheckpoint(newJustifiedCheckpoint: CheckpointWithHex, stateSlot: Slot): boolean {
    // To address the bouncing attack, only update conflicting justified checkpoints in the first 1/3 of the epoch.
    // Otherwise, delay consideration until the next epoch boundary with bestJustifiedCheckpoint
    // See https://ethresear.ch/t/prevention-of-bouncing-attack-on-ffg/6114 for more detailed analysis and discussion.
    if (computeSlotsSinceEpochStart(this.fcStore.currentSlot) < SAFE_SLOTS_TO_UPDATE_JUSTIFIED) {
      return true;
    }

    const justifiedSlot = computeStartSlotAtEpoch(this.fcStore.justified.checkpoint.epoch);

    // This sanity check is not in the spec, but the invariant is implied
    if (justifiedSlot >= stateSlot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ATTEMPT_TO_REVERT_JUSTIFICATION,
        store: justifiedSlot,
        state: stateSlot,
      });
    }

    // at regular sync time we don't want to wait for clock time next epoch to update bestJustifiedCheckpoint
    if (computeEpochAtSlot(stateSlot) < computeEpochAtSlot(this.fcStore.currentSlot)) {
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
    if (justifiedAncestor !== this.fcStore.justified.checkpoint.rootHex) {
      return false;
    }

    return true;
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
   * - bestJustified: Already available in `CheckpointHexWithBalance`
   * - unrealizedJustified: Already available in `CheckpointHexWithBalance`
   * Since this balances are already available the getter is just `() => balances`, without cache iteraction
   */
  private updateCheckpoints(
    stateSlot: Slot,
    justifiedCheckpoint: CheckpointWithHex,
    finalizedCheckpoint: CheckpointWithHex,
    getJustifiedBalances: () => JustifiedBalances
  ): void {
    // Update justified checkpoint.
    if (justifiedCheckpoint.epoch > this.fcStore.justified.checkpoint.epoch) {
      if (justifiedCheckpoint.epoch > this.fcStore.bestJustified.checkpoint.epoch) {
        this.fcStore.bestJustified = {checkpoint: justifiedCheckpoint, balances: getJustifiedBalances()};
      }

      if (this.shouldUpdateJustifiedCheckpoint(justifiedCheckpoint, stateSlot)) {
        this.fcStore.justified = {checkpoint: justifiedCheckpoint, balances: getJustifiedBalances()};
        this.justifiedProposerBoostScore = null;
      }
    }

    // Update finalized checkpoint.
    if (finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      this.fcStore.finalizedCheckpoint = finalizedCheckpoint;
      this.fcStore.justified = {checkpoint: justifiedCheckpoint, balances: getJustifiedBalances()};
      this.justifiedProposerBoostScore = null;
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
    attDataRoot?: string
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
    const attestationCacheKey = attDataRoot ?? toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestationData));

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
      // Delay consideration in the fork choice until their slot is in the past.
      if (attestation.slot < currentSlot) {
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
    // Reset proposer boost if this is a new slot.
    if (this.proposerBoostRoot) {
      // Since previous weight was boosted, we need would now need to recalculate the scores without the boost
      this.proposerBoostRoot = null;
    }

    // Not a new epoch, return.
    if (computeSlotsSinceEpochStart(time) !== 0) {
      return;
    }

    // Reason: A better justifiedCheckpoint from a block is only updated immediately if in the first 1/3 of the epoch
    // This addresses a bouncing attack, see https://ethresear.ch/t/prevention-of-bouncing-attack-on-ffg/6114
    if (this.fcStore.bestJustified.checkpoint.epoch > this.fcStore.justified.checkpoint.epoch) {
      // TODO: Is this check necessary? It checks that bestJustifiedCheckpoint is still descendant of finalized
      // From https://github.com/ChainSafe/lodestar/commit/6a0745e9db27dfce67b6e6c25bba452283dbbea9#
      const finalizedSlot = computeStartSlotAtEpoch(this.fcStore.finalizedCheckpoint.epoch);
      const ancestorAtFinalizedSlot = this.getAncestor(this.fcStore.bestJustified.checkpoint.rootHex, finalizedSlot);
      if (ancestorAtFinalizedSlot === this.fcStore.finalizedCheckpoint.rootHex) {
        // Provide pre-computed balances for bestJustified, will never trigger .justifiedBalancesGetter()
        this.fcStore.justified = this.fcStore.bestJustified;
        this.justifiedProposerBoostScore = null;
      }
    }

    // Update store.justified_checkpoint if a better unrealized justified checkpoint is known
    this.updateCheckpoints(
      time,
      this.fcStore.unrealizedJustified.checkpoint,
      this.fcStore.unrealizedFinalizedCheckpoint,
      // Provide pre-computed balances for unrealizedJustified, will never trigger .justifiedBalancesGetter()
      () => this.fcStore.unrealizedJustified.balances
    );
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
  config: IChainConfig,
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
        `Invalid terminal block hash, expected: ${toHexString(config.TERMINAL_BLOCK_HASH)}, actual: ${toHexString(
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
    if (!powBlockParent) throw Error("onBlock preCachedData must include powBlockParent");

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
