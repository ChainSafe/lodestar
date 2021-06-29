/* eslint-disable max-len */
import {fromHexString, readonlyValues, toHexString} from "@chainsafe/ssz";
import {SAFE_SLOTS_TO_UPDATE_JUSTIFIED, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {Slot, ValidatorIndex, Gwei, phase0, allForks, ssz, BlockRootHex, Epoch} from "@chainsafe/lodestar-types";
import {
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  computeEpochAtSlot,
  ZERO_HASH,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {computeDeltas, HEX_ZERO_HASH, IVoteTracker, ProtoArray} from "../protoArray";
import {ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode, InvalidAttestationCode} from "./errors";
import {IForkChoiceStore} from "./store";
import {IBlockSummary, toBlockSummary} from "./blockSummary";
import {IForkChoice, ILatestMessage, IQueuedAttestation} from "./interface";
import {IForkChoiceMetrics} from "../metrics";

/**
 * Provides an implementation of "Ethereum 2.0 Phase 0 -- Beacon Chain Fork Choice":
 *
 * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#ethereum-20-phase-0----beacon-chain-fork-choice
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
  config: IBeaconConfig;
  /**
   * Storage for `ForkChoice`, modelled off the spec `Store` object.
   */
  fcStore: IForkChoiceStore;
  /**
   * The underlying representation of the block DAG.
   */
  protoArray: ProtoArray;
  /**
   * Votes currently tracked in the protoArray
   * Indexed by validator index
   * Each vote contains the latest message and previous message
   */
  votes: IVoteTracker[];
  /**
   * Balances currently tracked in the protoArray
   * Indexed by validator index
   *
   * This should be the balances of the state at fcStore.justifiedCheckpoint
   */
  justifiedBalances: Gwei[];
  /**
   * Balances tracked in the protoArray, or soon to be tracked
   * Indexed by validator index
   *
   * This should be the balances of the state at fcStore.bestJustifiedCheckpoint
   */
  bestJustifiedBalances: Gwei[];
  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   */
  queuedAttestations: Set<IQueuedAttestation>;

  /**
   * Avoid having to compute detas all the times.
   */
  synced: boolean;

  /**
   * Cached head
   */
  head: IBlockSummary;

  /**
   * Fork choice metrics.
   */
  private readonly metrics: IForkChoiceMetrics | null | undefined;

  /**
   * Instantiates a Fork Choice from some existing components
   *
   * This is useful if the existing components have been loaded from disk after a process restart.
   */
  constructor({
    config,
    fcStore,
    protoArray,
    queuedAttestations,
    justifiedBalances,
    metrics,
  }: {
    config: IBeaconConfig;
    fcStore: IForkChoiceStore;
    protoArray: ProtoArray;
    queuedAttestations: Set<IQueuedAttestation>;
    justifiedBalances: Gwei[];
    metrics?: IForkChoiceMetrics | null;
  }) {
    this.config = config;
    this.fcStore = fcStore;
    this.protoArray = protoArray;
    this.votes = [];
    this.justifiedBalances = justifiedBalances;
    this.bestJustifiedBalances = justifiedBalances;
    this.queuedAttestations = queuedAttestations;
    this.synced = false;
    this.metrics = metrics;
    this.head = this.updateHead();
  }

  /**
   * Returns the block root of an ancestor of `blockRoot` at the given `slot`.
   * (Note: `slot` refers to the block that is *returned*, not the one that is supplied.)
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#get_ancestor
   */
  getAncestor(blockRoot: phase0.Root, ancestorSlot: Slot): Uint8Array {
    const blockRootHex = toHexString(blockRoot);
    const block = this.protoArray.getBlock(blockRootHex);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot.valueOf() as Uint8Array,
      });
    }

    if (block.slot > ancestorSlot) {
      // Search for a slot that is lte the target slot.
      // We check for lower slots to account for skip slots.
      for (const node of this.protoArray.iterateNodes(blockRootHex)) {
        if (node.slot <= ancestorSlot) {
          return fromHexString(node.blockRoot);
        }
      }
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
        descendantRoot: blockRoot.valueOf() as Uint8Array,
        ancestorSlot,
      });
    } else {
      // Root is older or equal than queried slot, thus a skip slot. Return most recent root prior to slot.
      return blockRoot.valueOf() as Uint8Array;
    }
  }

  /**
   * Get the cached head root
   */
  getHeadRoot(): Uint8Array {
    const head = this.getHead();
    return head.blockRoot;
  }

  /**
   * Get the cached head
   */
  getHead(): IBlockSummary {
    return this.head;
  }

  /**
   * Run the fork choice rule to determine the head.
   * Update the head cache.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#get_head
   */
  updateHead(): IBlockSummary {
    // balances is not changed but votes are changed

    let timer;
    this.metrics?.forkChoiceRequests.inc();

    try {
      if (!this.synced) {
        timer = this.metrics?.forkChoiceFindHead.startTimer();
        const deltas = computeDeltas(
          this.protoArray.indices,
          this.votes,
          this.justifiedBalances,
          this.justifiedBalances
        );
        this.protoArray.applyScoreChanges(
          deltas,
          this.fcStore.justifiedCheckpoint.epoch,
          this.fcStore.finalizedCheckpoint.epoch
        );
        this.synced = true;
      }
      const headRoot = this.protoArray.findHead(toHexString(this.fcStore.justifiedCheckpoint.root));
      const headIndex = this.protoArray.indices.get(headRoot);
      if (headIndex === undefined) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
          root: fromHexString(headRoot),
        });
      }
      const headNode = this.protoArray.nodes[headIndex];
      if (headNode === undefined) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
          root: fromHexString(headRoot),
        });
      }
      return (this.head = toBlockSummary(headNode));
    } catch (e) {
      this.metrics?.forkChoiceErrors.inc();
      throw e;
    } finally {
      if (timer) timer();
    }
  }

  getHeads(): IBlockSummary[] {
    return this.protoArray.nodes.filter((node) => !node.bestChild).map(toBlockSummary);
  }

  getFinalizedCheckpoint(): phase0.Checkpoint {
    return this.fcStore.finalizedCheckpoint;
  }

  getJustifiedCheckpoint(): phase0.Checkpoint {
    return this.fcStore.justifiedCheckpoint;
  }

  getBestJustifiedCheckpoint(): phase0.Checkpoint {
    return this.fcStore.bestJustifiedCheckpoint;
  }

  /**
   * Add `block` to the fork choice DAG.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#on_block
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
  onBlock(block: allForks.BeaconBlock, state: allForks.BeaconState, justifiedBalances?: Gwei[]): void {
    const {parentRoot, slot} = block;
    const parentRootHex = toHexString(parentRoot);
    // Parent block must be known
    if (!this.protoArray.hasBlock(parentRootHex)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.UNKNOWN_PARENT,
          root: parentRoot.valueOf() as Uint8Array,
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
    const blockAncestor = this.getAncestor(parentRoot, finalizedSlot);
    const finalizedRoot = this.fcStore.finalizedCheckpoint.root;
    if (!ssz.Root.equals(blockAncestor, finalizedRoot)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT,
          finalizedRoot: finalizedRoot.valueOf() as Uint8Array,
          blockAncestor,
        },
      });
    }

    let shouldUpdateJustified = false;
    const {currentJustifiedCheckpoint, finalizedCheckpoint} = state;
    // Update justified checkpoint.
    if (currentJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) {
      if (!justifiedBalances) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNABLE_TO_SET_JUSTIFIED_CHECKPOINT,
          error: new Error("No validator balances supplied"),
        });
      }
      if (currentJustifiedCheckpoint.epoch > this.fcStore.bestJustifiedCheckpoint.epoch) {
        // `valueOf` coerses the checkpoint, which may be tree-backed, into a javascript object
        // See https://github.com/ChainSafe/lodestar/issues/2258
        this.updateBestJustified(currentJustifiedCheckpoint.valueOf() as phase0.Checkpoint, justifiedBalances);
      }
      if (this.shouldUpdateJustifiedCheckpoint(state)) {
        // wait to update until after finalized checkpoint is set
        shouldUpdateJustified = true;
      }
    }

    // Update finalized checkpoint.
    if (finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      // `valueOf` coerses the checkpoint, which may be tree-backed, into a javascript object
      // See https://github.com/ChainSafe/lodestar/issues/2258
      this.fcStore.finalizedCheckpoint = finalizedCheckpoint.valueOf() as phase0.Checkpoint;

      if (
        (!ssz.phase0.Checkpoint.equals(this.fcStore.justifiedCheckpoint, currentJustifiedCheckpoint) &&
          currentJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) ||
        !ssz.Root.equals(
          this.getAncestor(this.fcStore.justifiedCheckpoint.root, finalizedSlot),
          this.fcStore.finalizedCheckpoint.root
        )
      ) {
        shouldUpdateJustified = true;
      }
    }

    // This needs to be performed after finalized checkpoint has been updated
    if (shouldUpdateJustified) {
      if (!justifiedBalances) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNABLE_TO_SET_JUSTIFIED_CHECKPOINT,
          error: new Error("No validator balances supplied"),
        });
      }
      // `valueOf` coerses the checkpoint, which may be tree-backed, into a javascript object
      // See https://github.com/ChainSafe/lodestar/issues/2258
      this.updateJustified(currentJustifiedCheckpoint.valueOf() as phase0.Checkpoint, justifiedBalances);
    }

    const targetSlot = computeStartSlotAtEpoch(computeEpochAtSlot(slot));
    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const targetRoot = slot === targetSlot ? blockRoot : state.blockRoots[targetSlot % SLOTS_PER_HISTORICAL_ROOT];

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    this.protoArray.onBlock({
      slot: slot,
      blockRoot: toHexString(blockRoot),
      parentRoot: parentRootHex,
      targetRoot: toHexString(targetRoot),
      stateRoot: toHexString(block.stateRoot),
      justifiedEpoch: currentJustifiedCheckpoint.epoch,
      finalizedEpoch: finalizedCheckpoint.epoch,
    });
  }

  /**
   * Register `attestation` with the fork choice DAG so that it may influence future calls to `getHead`.
   *
   * ## Specification
   *
   * Approximates:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#on_attestation
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
    const epoch = attestationData.target.epoch;
    if (ssz.Root.equals(beaconBlockRoot, ZERO_HASH)) {
      return;
    }

    this.validateOnAttestation(attestation);

    if (slot < this.fcStore.currentSlot) {
      for (const validatorIndex of readonlyValues(attestation.attestingIndices)) {
        this.addLatestMessage(validatorIndex, epoch, blockRootHex);
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
        attestingIndices: Array.from(readonlyValues(attestation.attestingIndices)),
        blockRoot: beaconBlockRoot.valueOf() as Uint8Array,
        targetEpoch: epoch,
      });
    }
  }

  getLatestMessage(validatorIndex: ValidatorIndex): ILatestMessage | undefined {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      return undefined;
    }
    return {
      epoch: vote.nextEpoch,
      root: fromHexString(vote.nextRoot),
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
  }

  getTime(): Slot {
    return this.fcStore.currentSlot;
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  hasBlock(blockRoot: phase0.Root): boolean {
    return this.protoArray.hasBlock(toHexString(blockRoot)) && this.isDescendantOfFinalized(blockRoot);
  }

  /**
   * Returns a `IBlockSummary` if the block is known **and** a descendant of the finalized root.
   */
  getBlock(blockRoot: phase0.Root): IBlockSummary | null {
    const block = this.protoArray.getBlock(toHexString(blockRoot));
    if (!block) {
      return null;
    }
    // If available, use the parent_root to perform the lookup since it will involve one
    // less lookup. This involves making the assumption that the finalized block will
    // always have `block.parent_root` of `None`.
    if (!this.isDescendantOfFinalized(blockRoot)) {
      return null;
    }
    return toBlockSummary(block);
  }

  getJustifiedBlock(): IBlockSummary {
    const block = this.getBlock(this.fcStore.justifiedCheckpoint.root);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: this.fcStore.justifiedCheckpoint.root.valueOf() as Uint8Array,
      });
    }
    return block;
  }

  getFinalizedBlock(): IBlockSummary {
    const block = this.getBlock(this.fcStore.finalizedCheckpoint.root);
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: this.fcStore.finalizedCheckpoint.root.valueOf() as Uint8Array,
      });
    }
    return block;
  }

  /**
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  isDescendantOfFinalized(blockRoot: phase0.Root): boolean {
    return this.protoArray.isDescendant(toHexString(this.fcStore.finalizedCheckpoint.root), toHexString(blockRoot));
  }

  /**
   * Returns true if the `descendantRoot` has an ancestor with `ancestorRoot`.
   *
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot===descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: phase0.Root, descendantRoot: phase0.Root): boolean {
    return this.protoArray.isDescendant(toHexString(ancestorRoot), toHexString(descendantRoot));
  }

  prune(finalizedRoot: phase0.Root): IBlockSummary[] {
    return this.protoArray.maybePrune(toHexString(finalizedRoot)).map(toBlockSummary);
  }

  setPruneThreshold(threshold: number): void {
    this.protoArray.pruneThreshold = threshold;
  }

  /**
   * Iterates backwards through block summaries, starting from a block root
   */
  iterateBlockSummaries(blockRoot: phase0.Root): IBlockSummary[] {
    return this.protoArray.iterateNodes(toHexString(blockRoot)).map(toBlockSummary);
  }

  /**
   * The same to iterateBlockSummaries but this gets non-ancestor nodes instead of ancestor nodes.
   */
  iterateNonAncestors(blockRoot: phase0.Root): IBlockSummary[] {
    return this.protoArray.iterateNonAncestorNodes(toHexString(blockRoot)).map(toBlockSummary);
  }

  getCanonicalBlockSummaryAtSlot(slot: Slot): IBlockSummary | null {
    const head = this.getHeadRoot();
    return this.iterateBlockSummaries(head).find((summary) => summary.slot === slot) || null;
  }

  forwardIterateBlockSummaries(): IBlockSummary[] {
    return this.protoArray.nodes.map(toBlockSummary);
  }

  getBlockSummariesByParentRoot(parentRoot: phase0.Root): IBlockSummary[] {
    const hexParentRoot = toHexString(parentRoot);
    return this.protoArray.nodes.filter((node) => node.parentRoot === hexParentRoot).map(toBlockSummary);
  }

  getBlockSummariesAtSlot(slot: Slot): IBlockSummary[] {
    return this.protoArray.nodes.filter((node) => node.slot === slot).map(toBlockSummary);
  }

  private updateJustified(justifiedCheckpoint: phase0.Checkpoint, justifiedBalances: Gwei[]): void {
    this.synced = false;
    this.justifiedBalances = justifiedBalances;
    this.fcStore.justifiedCheckpoint = justifiedCheckpoint;
  }

  private updateBestJustified(justifiedCheckpoint: phase0.Checkpoint, justifiedBalances: Gwei[]): void {
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
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#should_update_justified_checkpoint
   */
  private shouldUpdateJustifiedCheckpoint(state: allForks.BeaconState): boolean {
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
    const justifiedAncestor = this.getAncestor(newJustifiedCheckpoint.root, justifiedSlot);
    if (!ssz.Root.equals(justifiedAncestor, this.fcStore.justifiedCheckpoint.root)) {
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
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#validate_on_attestation
   */
  private validateOnAttestation(indexedAttestation: phase0.IndexedAttestation): void {
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

    const epochNow = computeEpochAtSlot(this.fcStore.currentSlot);
    const attestationData = indexedAttestation.data;
    const {target, slot, beaconBlockRoot} = attestationData;
    const {epoch: targetEpoch, root: targetRoot} = target;

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

    if (this.fcStore.currentSlot < slot + 1) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.FUTURE_SLOT,
          attestationSlot: slot,
          latestPermissibleSlot: this.fcStore.currentSlot - 1,
        },
      });
    }

    // Attestation target must be for a known block.
    //
    // We do not delay the block for later processing to reduce complexity and DoS attack
    // surface.
    if (!this.protoArray.hasBlock(toHexString(targetRoot))) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT,
          root: targetRoot.valueOf() as Uint8Array,
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
    const block = this.protoArray.getBlock(toHexString(beaconBlockRoot));
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK,
          beaconBlockRoot: beaconBlockRoot.valueOf() as Uint8Array,
        },
      });
    }

    // If an attestation points to a block that is from an earlier slot than the attestation,
    // then all slots between the block and attestation must be skipped. Therefore if the block
    // is from a prior epoch to the attestation, then the target root must be equal to the root
    // of the block that is being attested to.
    const expectedTarget =
      target.epoch > computeEpochAtSlot(block.slot) ? beaconBlockRoot : fromHexString(block.targetRoot);

    if (!ssz.Root.equals(expectedTarget, targetRoot)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.INVALID_TARGET,
          attestation: targetRoot.valueOf() as Uint8Array,
          local: expectedTarget.valueOf() as Uint8Array,
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
  }

  /**
   * Add a validator's latest message to the tracked votes
   */
  private addLatestMessage(validatorIndex: ValidatorIndex, nextEpoch: Epoch, nextRoot: BlockRootHex): void {
    this.synced = false;
    const vote = this.votes[validatorIndex];
    if (!vote) {
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
        const blockRootHex = toHexString(blockRoot);
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
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#on_tick
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
    const currentSlot = time;
    if (computeSlotsSinceEpochStart(currentSlot) !== 0) {
      return;
    }

    if (this.fcStore.bestJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) {
      this.updateJustified(this.fcStore.bestJustifiedCheckpoint, this.bestJustifiedBalances);
    }
  }
}
