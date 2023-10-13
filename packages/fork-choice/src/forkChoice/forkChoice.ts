import {toHexString} from "@chainsafe/ssz";
import {fromHex} from "@lodestar/utils";
import {SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH, INTERVALS_PER_SLOT} from "@lodestar/params";
import {bellatrix, Slot, ValidatorIndex, phase0, allForks, ssz, RootHex, Epoch, Root} from "@lodestar/types";
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
} from "../protoArray/interface.js";
import {ProtoArray} from "../protoArray/protoArray.js";
import {ProtoArrayError, ProtoArrayErrorCode} from "../protoArray/errors.js";

import {ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode, InvalidAttestationCode} from "./errors.js";
import {
  IForkChoice,
  LatestMessage,
  QueuedAttestation,
  PowBlockHex,
  EpochDifference,
  AncestorResult,
  AncestorStatus,
  ForkChoiceMetrics,
} from "./interface.js";
import {IForkChoiceStore, CheckpointWithHex, toCheckpointWithHex, JustifiedBalances} from "./store.js";

export type ForkChoiceOpts = {
  proposerBoostEnabled?: boolean;
  computeUnrealized?: boolean;
};

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
  private readonly queuedAttestations = new Set<QueuedAttestation>();

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
    private readonly opts?: ForkChoiceOpts
  ) {
    this.head = this.updateHead();
    this.balances = this.fcStore.justified.balances;
  }

  getMetrics(): ForkChoiceMetrics {
    return {
      votes: this.votes.length,
      queuedAttestations: this.queuedAttestations.size,
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
    if (this.opts?.proposerBoostEnabled && this.proposerBoostRoot) {
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

    return (this.head = headNode);
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
    block: allForks.BeaconBlock,
    state: CachedBeaconStateAllForks,
    blockDelaySec: number,
    currentSlot: Slot,
    executionStatus: MaybeValidExecutionStatus
  ): ProtoBlock {
    const {parentRoot, slot} = block;
    const parentRootHex = toHexString(parentRoot);
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
    const blockRootHex = toHexString(blockRoot);

    // Add proposer score boost if the block is timely
    // before attesting interval = before 1st interval
    if (
      this.opts?.proposerBoostEnabled &&
      this.fcStore.currentSlot === slot &&
      blockDelaySec < this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT &&
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

      ...(isExecutionBlockBodyType(block.body) && isExecutionStateType(state) && isExecutionEnabled(state, block)
        ? {
            executionPayloadBlockHash: toHexString(block.body.executionPayload.blockHash),
            executionPayloadNumber: block.body.executionPayload.blockNumber,
            executionStatus: this.getPostMergeExecStatus(executionStatus),
          }
        : {executionPayloadBlockHash: null, executionStatus: this.getPreMergeExecStatus(executionStatus)}),
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
    const blockRootHex = toHexString(beaconBlockRoot);
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
      this.queuedAttestations.add({
        slot: slot,
        attestingIndices: attestation.attestingIndices,
        blockRoot: blockRootHex,
        targetEpoch,
      });
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
    intersectingIndices.forEach((validatorIndex) => this.fcStore.equivocatingIndices.add(validatorIndex));
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
    return this.hasBlockHexUnsafe(toHexString(blockRoot));
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
    // at most `2 * (blockEpoch - atEpoch + 1)` iterations to find the dependant root.

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

  private getPreMergeExecStatus(executionStatus: MaybeValidExecutionStatus): ExecutionStatus.PreMerge {
    if (executionStatus !== ExecutionStatus.PreMerge)
      throw Error(`Invalid pre-merge execution status: expected: ${ExecutionStatus.PreMerge}, got ${executionStatus}`);
    return executionStatus;
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

    // If a new epoch, pull-up justification and finalization from previous epoch
    this.updateCheckpoints(
      this.fcStore.unrealizedJustified.checkpoint,
      this.fcStore.unrealizedFinalizedCheckpoint,
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
