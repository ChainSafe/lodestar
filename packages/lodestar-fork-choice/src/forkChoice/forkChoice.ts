/* eslint-disable max-len */
import {fromHexString, toHexString, readOnlyForEach, readOnlyMap} from "@chainsafe/ssz";
import {
  Slot,
  ValidatorIndex,
  BeaconBlock,
  Root,
  BeaconState,
  IndexedAttestation,
  Gwei,
} from "@chainsafe/lodestar-types";
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
import {ILatestMessage, IQueuedAttestation} from "./interface";

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
 * - Justified balances are not updated automatically, updateBalances MUST be called when Store justifiedCheckpoint is updated
 */
export class ForkChoice {
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
  balances: Gwei[];
  /**
   * Attestations that arrived at the current slot and must be queued for later processing.
   * NOT currently tracked in the protoArray
   */
  queuedAttesations: Set<IQueuedAttestation>;

  /**
   * Instantiates a Fork Choice from some existing components
   *
   * This is useful if the existing components have been loaded from disk after a process restart.
   */
  constructor({
    config,
    fcStore,
    protoArray,
    queuedAttesations,
  }: {
    config: IBeaconConfig;
    fcStore: IForkChoiceStore;
    protoArray: ProtoArray;
    queuedAttesations: Set<IQueuedAttestation>;
  }) {
    this.config = config;
    this.fcStore = fcStore;
    this.protoArray = protoArray;
    this.votes = [];
    this.balances = [];
    this.queuedAttesations = queuedAttesations;
  }

  /**
   * Instantiates a ForkChoice from genesis parameters
   */
  public static fromGenesis(config: IBeaconConfig, fcStore: IForkChoiceStore, genesisBlock: BeaconBlock): ForkChoice {
    const protoArray = ProtoArray.initialize({
      slot: genesisBlock.slot,
      parentRoot: toHexString(genesisBlock.parentRoot),
      stateRoot: toHexString(genesisBlock.stateRoot),
      blockRoot: toHexString(fcStore.finalizedCheckpoint.root),
      justifiedEpoch: fcStore.justifiedCheckpoint.epoch,
      finalizedEpoch: fcStore.finalizedCheckpoint.epoch,
    });

    return new ForkChoice({
      config,
      fcStore,
      protoArray,
      queuedAttesations: new Set(),
    });
  }

  /**
   * Returns the block root of an ancestor of `block_root` at the given `slot`. (Note: `slot` refers
   * to the block that is *returned*, not the one that is supplied.)
   *
   * The result may be `Ok(None)` if the block does not descend from the finalized block. This
   * is an artifact of proto-array, sometimes it contains descendants of blocks that have been
   * pruned.
   *
   * ## Specification
   *
   * Equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/fork-choice.md#get_ancestor
   */
  public getAncestor(blockRoot: Root, ancestorSlot: Slot): Uint8Array {
    const block = this.protoArray.getBlock(toHexString(blockRoot));
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot.valueOf() as Uint8Array,
      });
    }

    if (block.slot > ancestorSlot) {
      // Search for a slot that is lte the target slot.
      // We check for lower slots to account for skip slots.
      for (const node of this.protoArray.iterateNodes(toHexString(blockRoot))) {
        if (node.slot <= ancestorSlot) {
          return fromHexString(node.blockRoot);
        }
      }
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_UNKNOWN_ANCESTOR,
        descendantRoot: blockRoot.valueOf() as Uint8Array,
        ancestorSlot,
      });
    } else {
      // Root is older or equal than queried slot, thus a skip slot. Return most recent root prior to slot.
      return blockRoot.valueOf() as Uint8Array;
    }
  }

  /**
   * Run the fork choice rule to determine the head.
   *
   * ## Specification
   *
   * Is equivalent to:
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#get_head
   */
  public getHeadRoot(): Uint8Array {
    return fromHexString(this.protoArray.findHead(toHexString(this.fcStore.justifiedCheckpoint.root)));
  }

  public getHead(): IBlockSummary {
    const headRoot = this.protoArray.findHead(toHexString(this.fcStore.justifiedCheckpoint.root));
    const headIndex = this.protoArray.indices.get(headRoot);
    if (headIndex === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_MISSING_PROTO_ARRAY_BLOCK,
        root: fromHexString(headRoot),
      });
    }
    const headNode = this.protoArray.nodes[headIndex];
    if (headNode === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_MISSING_PROTO_ARRAY_BLOCK,
        root: fromHexString(headRoot),
      });
    }
    return toBlockSummary(headNode);
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
   */
  public onBlock(block: BeaconBlock, state: BeaconState): void {
    // Parent block must be known
    if (!this.protoArray.hasBlock(toHexString(block.parentRoot))) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.UNKNOWN_PARENT,
          root: block.parentRoot.valueOf() as Uint8Array,
        },
      });
    }

    // Blocks cannot be in the future. If they are, their consideration must be delayed until
    // the are in the past.
    //
    // Note: presently, we do not delay consideration. We just drop the block.
    if (block.slot > this.fcStore.currentSlot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.FUTURE_SLOT,
          currentSlot: this.fcStore.currentSlot,
          blockSlot: block.slot,
        },
      });
    }

    // Check that block is later than the finalized epoch slot (optimization to reduce calls to
    // get_ancestor).
    const finalizedSlot = computeStartSlotAtEpoch(this.config, this.fcStore.finalizedCheckpoint.epoch);
    if (block.slot <= finalizedSlot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.FINALIZED_SLOT,
          finalizedSlot,
          blockSlot: block.slot,
        },
      });
    }

    // Check block is a descendant of the finalized block at the checkpoint finalized slot.
    const blockAncestor = this.getAncestor(block.parentRoot, finalizedSlot);
    const finalizedRoot = this.fcStore.finalizedCheckpoint.root;
    if (!this.config.types.Root.equals(blockAncestor, finalizedRoot)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT,
          finalizedRoot: finalizedRoot.valueOf() as Uint8Array,
          blockAncestor,
        },
      });
    }

    // Update justified checkpoint.
    if (state.currentJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) {
      if (state.currentJustifiedCheckpoint.epoch > this.fcStore.bestJustifiedCheckpoint.epoch) {
        this.fcStore.bestJustifiedCheckpoint = state.currentJustifiedCheckpoint;
      }
      if (this.shouldUpdateJustifiedCheckpoint(state)) {
        this.fcStore.justifiedCheckpoint = state.currentJustifiedCheckpoint;
      }
    }

    // Update finalized checkpoint.
    if (state.finalizedCheckpoint.epoch > this.fcStore.finalizedCheckpoint.epoch) {
      this.fcStore.finalizedCheckpoint = state.finalizedCheckpoint;
      const finalizedSlot = computeStartSlotAtEpoch(this.config, this.fcStore.finalizedCheckpoint.epoch);

      if (
        (!this.config.types.Checkpoint.equals(this.fcStore.justifiedCheckpoint, state.currentJustifiedCheckpoint) &&
          state.currentJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) ||
        !this.config.types.Root.equals(
          this.getAncestor(this.fcStore.justifiedCheckpoint.root, finalizedSlot),
          this.fcStore.finalizedCheckpoint.root
        )
      ) {
        this.fcStore.justifiedCheckpoint = state.currentJustifiedCheckpoint;
      }
    }

    const targetSlot = computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, block.slot));
    const targetRoot =
      block.slot === targetSlot
        ? this.config.types.BeaconBlock.hashTreeRoot(block)
        : state.blockRoots[targetSlot % this.config.params.SLOTS_PER_HISTORICAL_ROOT];

    // This does not apply a vote to the block, it just makes fork choice aware of the block so
    // it can still be identified as the head even if it doesn't have any votes.
    this.protoArray.onBlock({
      slot: block.slot,
      blockRoot: toHexString(this.config.types.BeaconBlock.hashTreeRoot(block)),
      parentRoot: toHexString(block.parentRoot),
      targetRoot: toHexString(targetRoot),
      stateRoot: toHexString(block.stateRoot),
      justifiedEpoch: state.currentJustifiedCheckpoint.epoch,
      finalizedEpoch: state.finalizedCheckpoint.epoch,
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
  public onAttestation(attestation: IndexedAttestation): void {
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
    if (this.config.types.Root.equals(attestation.data.beaconBlockRoot, ZERO_HASH)) {
      return;
    }

    this.validateOnAttestation(attestation);

    if (attestation.data.slot < this.fcStore.currentSlot) {
      readOnlyForEach(attestation.attestingIndices, (validatorIndex) => {
        this.addLatestMessage(validatorIndex, {
          root: attestation.data.beaconBlockRoot,
          epoch: attestation.data.target.epoch,
        });
      });
    } else {
      // The spec declares:
      //
      // ```
      // Attestations can only affect the fork choice of subsequent slots.
      // Delay consideration in the fork choice until their slot is in the past.
      // ```
      this.queuedAttesations.add({
        slot: attestation.data.slot,
        attestingIndices: readOnlyMap(attestation.attestingIndices, (x) => x),
        blockRoot: attestation.data.beaconBlockRoot.valueOf() as Uint8Array,
        targetEpoch: attestation.data.target.epoch,
      });
    }
  }

  public getLatestMessage(validatorIndex: ValidatorIndex): ILatestMessage | undefined {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      return undefined;
    }
    return {
      epoch: vote.nextEpoch,
      root: fromHexString(vote.nextRoot),
    };
  }

  public updateBalances(justifiedStateBalances: Gwei[]): void {
    const oldBalances = this.balances;
    const newBalances = justifiedStateBalances;

    const deltas = computeDeltas(this.protoArray.indices, this.votes, oldBalances, newBalances);

    this.protoArray.applyScoreChanges(
      deltas,
      this.fcStore.justifiedCheckpoint.epoch,
      this.fcStore.finalizedCheckpoint.epoch
    );

    this.balances = newBalances;
  }

  /**
   * Call `onTick` for all slots between `fcStore.getCurrentSlot()` and the provided `currentSlot`.
   */
  public updateTime(currentSlot: Slot): void {
    while (this.fcStore.currentSlot < currentSlot) {
      const previousSlot = this.fcStore.currentSlot;
      // Note: we are relying upon `onTick` to update `fcStore.time` to ensure we don't get stuck in a loop.
      this.onTick(previousSlot + 1);
    }

    // Process any attestations that might now be eligible.
    this.processAttestationQueue();
  }

  /**
   * Returns `true` if the block is known **and** a descendant of the finalized root.
   */
  public hasBlock(blockRoot: Root): boolean {
    return this.protoArray.hasBlock(toHexString(blockRoot)) && this.isDescendantOfFinalized(blockRoot);
  }

  /**
   * Returns a `IBlockSummary` if the block is known **and** a descendant of the finalized root.
   */
  public getBlock(blockRoot: Root): IBlockSummary | null {
    const block = this.protoArray.getBlock(toHexString(blockRoot));
    if (!block) {
      return null;
    }
    // If available, use the parent_root to perform the lookup since it will involve one
    // less lookup. This involves making the assumption that the finalized block will
    // always have `block.parent_root` of `None`.
    if (!this.isDescendantOfFinalized(block.parentRoot ? fromHexString(block.parentRoot) : blockRoot)) {
      return null;
    }
    return toBlockSummary(block);
  }

  /**
   * Return `true` if `block_root` is equal to the finalized root, or a known descendant of it.
   */
  public isDescendantOfFinalized(blockRoot: Root): boolean {
    return this.protoArray.isDescendant(toHexString(this.fcStore.finalizedCheckpoint.root), toHexString(blockRoot));
  }

  public prune(): IBlockSummary[] {
    return this.protoArray.maybePrune(toHexString(this.fcStore.finalizedCheckpoint.root)).map(toBlockSummary);
  }

  public setPruneThreshold(threshold: number): void {
    this.protoArray.pruneThreshold = threshold;
  }

  /**
   * Iterates backwards through block summaries, starting from a block root
   */
  public iterateBlockSummaries(blockRoot: Root): IBlockSummary[] {
    return this.protoArray.iterateNodes(toHexString(blockRoot)).map(toBlockSummary);
  }

  public getCanonicalBlockSummaryAtSlot(slot: Slot): IBlockSummary | null {
    const head = this.getHeadRoot();
    return this.iterateBlockSummaries(head).find((summary) => summary.slot === slot) || null;
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
  private shouldUpdateJustifiedCheckpoint(state: BeaconState): boolean {
    const newJustifiedCheckpoint = state.currentJustifiedCheckpoint;

    if (
      computeSlotsSinceEpochStart(this.config, this.fcStore.currentSlot) <
      this.config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED
    ) {
      return true;
    }

    const justifiedSlot = computeStartSlotAtEpoch(this.config, this.fcStore.justifiedCheckpoint.epoch);

    // This sanity check is not in the spec, but the invariant is implied
    if (justifiedSlot >= state.slot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_ATTEMPT_TO_REVERT_JUSTIFICATION,
        store: justifiedSlot,
        state: state.slot,
      });
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
    if (!this.config.types.Root.equals(justifiedAncestor, this.fcStore.justifiedCheckpoint.root)) {
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
  private validateOnAttestation(indexedAttestation: IndexedAttestation): void {
    // There is no point in processing an attestation with an empty bitfield. Reject
    // it immediately.
    //
    // This is not in the specification, however it should be transparent to other nodes. We
    // return early here to avoid wasting precious resources verifying the rest of it.
    if (!indexedAttestation.attestingIndices.length) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD,
        },
      });
    }

    const epochNow = computeEpochAtSlot(this.config, this.fcStore.currentSlot);
    const target = indexedAttestation.data.target;

    // Attestation must be from the current of previous epoch.
    if (target.epoch > epochNow) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.FUTURE_EPOCH,
          attestationEpoch: target.epoch,
          currentEpoch: epochNow,
        },
      });
    } else if (target.epoch + 1 < epochNow) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.PAST_EPOCH,
          attestationEpoch: target.epoch,
          currentEpoch: epochNow,
        },
      });
    }

    if (target.epoch !== computeEpochAtSlot(this.config, indexedAttestation.data.slot)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.BAD_TARGET_EPOCH,
          target: target.epoch,
          slot: indexedAttestation.data.slot,
        },
      });
    }

    // Attestation target must be for a known block.
    //
    // We do not delay the block for later processing to reduce complexity and DoS attack
    // surface.
    if (!this.protoArray.hasBlock(toHexString(target.root))) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT,
          root: target.root.valueOf() as Uint8Array,
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
    const block = this.protoArray.getBlock(toHexString(indexedAttestation.data.beaconBlockRoot));
    if (!block) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK,
          beaconBlockRoot: indexedAttestation.data.beaconBlockRoot.valueOf() as Uint8Array,
        },
      });
    }

    // If an attestation points to a block that is from an earlier slot than the attestation,
    // then all slots between the block and attestation must be skipped. Therefore if the block
    // is from a prior epoch to the attestation, then the target root must be equal to the root
    // of the block that is being attested to.
    const expectedTarget =
      target.epoch > computeEpochAtSlot(this.config, block.slot)
        ? indexedAttestation.data.beaconBlockRoot
        : fromHexString(block.targetRoot);

    if (!this.config.types.Root.equals(expectedTarget, target.root)) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.INVALID_TARGET,
          attestation: target.root.valueOf() as Uint8Array,
          local: expectedTarget.valueOf() as Uint8Array,
        },
      });
    }

    // Attestations must not be for blocks in the future. If this is the case, the attestation
    // should not be considered.
    if (block.slot > indexedAttestation.data.slot) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION,
        err: {
          code: InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK,
          block: block.slot,
          attestation: indexedAttestation.data.slot,
        },
      });
    }
  }

  /**
   * Add a validator's latest message to the tracked votes
   */
  private addLatestMessage(validatorIndex: ValidatorIndex, message: ILatestMessage): void {
    const nextRoot = toHexString(message.root);
    const vote = this.votes[validatorIndex];
    if (!vote) {
      this.votes[validatorIndex] = {
        currentRoot: HEX_ZERO_HASH,
        nextRoot,
        nextEpoch: message.epoch,
      };
    } else if (message.epoch > vote.nextEpoch) {
      vote.nextRoot = nextRoot;
      vote.nextEpoch = message.epoch;
    }
    // else its an old vote, don't count it
  }

  /**
   * Processes and removes from the queue any queued attestations which may now be eligible for
   * processing due to the slot clock incrementing.
   */
  private processAttestationQueue(): void {
    const currentSlot = this.fcStore.currentSlot;
    for (const attestation of this.queuedAttesations.values()) {
      if (attestation.slot <= currentSlot) {
        this.queuedAttesations.delete(attestation);
        for (const validatorIndex of attestation.attestingIndices) {
          this.addLatestMessage(validatorIndex, {
            root: attestation.blockRoot,
            epoch: attestation.targetEpoch,
          });
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
        code: ForkChoiceErrorCode.ERR_INCONSISTENT_ON_TICK,
        previousSlot,
        time,
      });
    }

    // Update store time
    this.fcStore.currentSlot = time;
    const currentSlot = time;
    if (computeSlotsSinceEpochStart(this.config, currentSlot) !== 0) {
      return;
    }

    if (this.fcStore.bestJustifiedCheckpoint.epoch > this.fcStore.justifiedCheckpoint.epoch) {
      this.fcStore.justifiedCheckpoint = this.fcStore.bestJustifiedCheckpoint;
    }
  }
}
