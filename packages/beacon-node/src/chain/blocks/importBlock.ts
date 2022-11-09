import {altair, ssz} from "@lodestar/types";
import {MAX_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  RootCache,
} from "@lodestar/state-transition";
import {ForkChoiceError, ForkChoiceErrorCode, EpochDifference} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {toCheckpointHex} from "../stateCache/index.js";
import {isOptimsticBlock} from "../../util/forkChoice.js";
import {ChainEvent} from "../emitter.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import {RegenCaller} from "../regen/interface.js";
import type {BeaconChain} from "../chain.js";
import {FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {PendingEvents} from "./utils/pendingEvents.js";
import {getCheckpointFromState} from "./utils/checkpoint.js";

/**
 * Fork-choice allows to import attestations from current (0) or past (1) epoch.
 */
const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;

/**
 * Imports a fully verified block into the chain state. Produces multiple permanent side-effects.
 *
 * Import block:
 * - Observe attestations
 * - Add validators to the pubkey cache
 * - Load shuffling caches
 * - Do weak subjectivy check
 * - Register block with fork-hoice
 * - Register state and block to the validator monitor
 * - For each attestation
 *   - Get indexed attestation
 *   - Register attestation with fork-choice
 *   - Register attestation with validator monitor (only after sync)
 * - Write block and state to hot db
 * - Write block and state to snapshot_cache
 * - head_tracker.register_block(block_root, parent_root, slot)
 * - Send events after everything is done
 */
export async function importBlock(
  this: BeaconChain,
  fullyVerifiedBlock: FullyVerifiedBlock,
  opts: ImportBlockOpts
): Promise<void> {
  const {block, postState, parentBlockSlot, executionStatus} = fullyVerifiedBlock;
  const pendingEvents = new PendingEvents(this.emitter);

  // - Observe attestations
  // TODO
  // - Add validators to the pubkey cache
  // TODO
  // - Load shuffling caches
  // TODO
  // - Do weak subjectivy check
  // TODO

  // - Register block with fork-hoice

  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec = (fullyVerifiedBlock.seenTimestampSec - postState.genesisTime) % this.config.SECONDS_PER_SLOT;
  const blockRoot = toHexString(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  // Should compute checkpoint balances before forkchoice.onBlock
  this.checkpointBalancesCache.processState(blockRoot, postState);
  this.forkChoice.onBlock(block.message, postState, blockDelaySec, this.clock.currentSlot, executionStatus);

  // - Register state and block to the validator monitor
  // TODO

  const currentEpoch = computeEpochAtSlot(this.forkChoice.getTime());
  const blockEpoch = computeEpochAtSlot(block.message.slot);

  // - For each attestation
  //   - Get indexed attestation
  //   - Register attestation with fork-choice
  //   - Register attestation with validator monitor (only after sync)
  // Only process attestations of blocks with relevant attestations for the fork-choice:
  // If current epoch is N, and block is epoch X, block may include attestations for epoch X or X - 1.
  // The latest block that is useful is at epoch N - 1 which may include attestations for epoch N - 1 or N - 2.
  if (!opts.skipImportingAttestations && blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT) {
    const attestations = block.message.body.attestations;
    const rootCache = new RootCache(postState);
    const invalidAttestationErrorsByCode = new Map<string, {error: Error; count: number}>();

    for (const attestation of attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        const {target, slot, beaconBlockRoot} = attestation.data;

        const attDataRoot = toHexString(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));
        this.seenAggregatedAttestations.add(
          target.epoch,
          attDataRoot,
          {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
          true
        );
        // Duplicated logic from fork-choice onAttestation validation logic.
        // Attestations outside of this range will be dropped as Errors, so no need to import
        if (target.epoch <= currentEpoch && target.epoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT) {
          this.forkChoice.onAttestation(indexedAttestation, attDataRoot);
        }

        // Note: To avoid slowing down sync, only register attestations within FORK_CHOICE_ATT_EPOCH_LIMIT
        this.seenBlockAttesters.addIndices(blockEpoch, indexedAttestation.attestingIndices);

        const correctHead = ssz.Root.equals(rootCache.getBlockRootAtSlot(slot), beaconBlockRoot);
        this.metrics?.registerAttestationInBlock(indexedAttestation, parentBlockSlot, correctHead);

        // don't want to log the processed attestations here as there are so many attestations and it takes too much disc space,
        // users may want to keep more log files instead of unnecessary processed attestations log
        // see https://github.com/ChainSafe/lodestar/pull/4032
        pendingEvents.push(ChainEvent.attestation, attestation);
      } catch (e) {
        // a block has a lot of attestations and it may has same error, we don't want to log all of them
        if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
          let errWithCount = invalidAttestationErrorsByCode.get(e.type.err.code);
          if (errWithCount === undefined) {
            errWithCount = {error: e as Error, count: 1};
            invalidAttestationErrorsByCode.set(e.type.err.code, errWithCount);
          } else {
            errWithCount.count++;
          }
        } else {
          // always log other errors
          this.logger.warn("Error processing attestation from block", {slot: block.message.slot}, e as Error);
        }
      }
    }

    for (const {error, count} of invalidAttestationErrorsByCode.values()) {
      this.logger.warn(
        "Error processing attestations from block",
        {slot: block.message.slot, erroredAttestations: count},
        error
      );
    }
  }

  // FORK_CHOICE_ATT_EPOCH_LIMIT is for attestation to become valid
  // but AttesterSlashing could be found before that time and still able to submit valid attestations
  // until slashed validator become inactive, see computeActivationExitEpoch() function
  if (
    !opts.skipImportingAttestations &&
    blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT - 1 - MAX_SEED_LOOKAHEAD
  ) {
    for (const slashing of block.message.body.attesterSlashings) {
      try {
        // all AttesterSlashings are valid before reaching this
        this.forkChoice.onAttesterSlashing(slashing);
      } catch (e) {
        this.logger.warn("Error processing AttesterSlashing from block", {slot: block.message.slot}, e as Error);
      }
    }
  }

  // - Write block and state to hot db
  // - Write block and state to snapshot_cache
  if (block.message.slot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.checkpointStateCache.add(cp, checkpointState);
    pendingEvents.push(ChainEvent.checkpoint, cp, checkpointState);

    // Note: in-lined code from previos handler of ChainEvent.checkpoint
    this.logger.verbose("Checkpoint processed", toCheckpointHex(cp));

    const activeValidatorsCount = checkpointState.epochCtx.currentShuffling.activeIndices.length;
    this.metrics?.currentActiveValidators.set(activeValidatorsCount);
    this.metrics?.currentValidators.set({status: "active"}, activeValidatorsCount);

    const parentBlockSummary = this.forkChoice.getBlock(checkpointState.latestBlockHeader.parentRoot);

    if (parentBlockSummary) {
      const justifiedCheckpoint = checkpointState.currentJustifiedCheckpoint;
      const justifiedEpoch = justifiedCheckpoint.epoch;
      const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
      if (justifiedEpoch > preJustifiedEpoch) {
        this.emitter.emit(ChainEvent.justified, justifiedCheckpoint, checkpointState);
        this.logger.verbose("Checkpoint justified", toCheckpointHex(cp));
        this.metrics?.previousJustifiedEpoch.set(checkpointState.previousJustifiedCheckpoint.epoch);
        this.metrics?.currentJustifiedEpoch.set(cp.epoch);
      }
      const finalizedCheckpoint = checkpointState.finalizedCheckpoint;
      const finalizedEpoch = finalizedCheckpoint.epoch;
      const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
      if (finalizedEpoch > preFinalizedEpoch) {
        this.emitter.emit(ChainEvent.finalized, finalizedCheckpoint, checkpointState);
        this.logger.verbose("Checkpoint finalized", toCheckpointHex(cp));
        this.metrics?.finalizedEpoch.set(cp.epoch);
      }
    }
  }

  // Emit ChainEvent.forkChoiceHead event
  const oldHead = this.forkChoice.getHead();
  const newHead = this.recomputeForkChoiceHead();
  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    // new head

    pendingEvents.push(ChainEvent.head, {
      block: newHead.blockRoot,
      epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(newHead.slot)) === newHead.slot,
      slot: newHead.slot,
      state: newHead.stateRoot,
      previousDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.previous),
      currentDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.current),
      executionOptimistic: isOptimsticBlock(newHead),
    });

    this.metrics?.forkChoice.changedHead.inc();

    const distance = this.forkChoice.getCommonAncestorDistance(oldHead, newHead);
    if (distance !== null) {
      // chain reorg
      this.logger.verbose("Chain reorg", {
        depth: distance,
        previousHead: oldHead.blockRoot,
        previousHeadParent: oldHead.parentRoot,
        previousSlot: oldHead.slot,
        newHead: newHead.blockRoot,
        newHeadParent: newHead.parentRoot,
        newSlot: newHead.slot,
      });

      pendingEvents.push(ChainEvent.forkChoiceReorg, newHead, oldHead, distance);

      this.metrics?.forkChoice.reorg.inc();
      this.metrics?.forkChoice.reorgDistance.observe(distance);
    }

    // Lightclient server support (only after altair)
    // - Persist state witness
    // - Use block's syncAggregate
    if (blockEpoch >= this.config.ALTAIR_FORK_EPOCH) {
      try {
        this.lightClientServer.onImportBlockHead(
          block.message as altair.BeaconBlock,
          postState as CachedBeaconStateAltair,
          parentBlockSlot
        );
      } catch (e) {
        this.logger.error("Error lightClientServer.onImportBlock", {slot: block.message.slot}, e as Error);
      }
    }

    // Set head state as strong reference
    const headState =
      newHead.stateRoot === toHexString(postState.hashTreeRoot()) ? postState : this.stateCache.get(newHead.stateRoot);
    if (headState) {
      this.stateCache.setHeadState(headState);
    } else {
      // Trigger regen on head change if necessary
      this.logger.warn("Head state not available, triggering regen", {stateRoot: newHead.stateRoot});
      // head has changed, so the existing cached head state is no longer useful. Set strong reference to null to free
      // up memory for regen step below. During regen, node won't be functional but eventually head will be available
      this.stateCache.setHeadState(null);
      this.regen.getState(newHead.stateRoot, RegenCaller.processBlock).then(
        (headStateRegen) => this.stateCache.setHeadState(headStateRegen),
        (e) => this.logger.error("Error on head state regen", {}, e)
      );
    }
  }

  // NOTE: forkChoice.fsStore.finalizedCheckpoint MUST only change in response to an onBlock event
  // Notifying EL of head and finalized updates as below is usually done within the 1st 4s of the slot.
  // If there is an advanced payload generation in the next slot, we'll notify EL again 4s before next
  // slot via PrepareNextSlotScheduler. There is no harm updating the ELs with same data, it will just ignore it.
  if (
    !this.opts.disableImportExecutionFcU &&
    (newHead.blockRoot !== oldHead.blockRoot || currFinalizedEpoch !== prevFinalizedEpoch)
  ) {
    /**
     * On post BELLATRIX_EPOCH but pre TTD, blocks include empty execution payload with a zero block hash.
     * The consensus clients must not send notifyForkchoiceUpdate before TTD since the execution client will error.
     * So we must check that:
     * - `headBlockHash !== null` -> Pre BELLATRIX_EPOCH
     * - `headBlockHash !== ZERO_HASH` -> Pre TTD
     */
    const headBlockHash = this.forkChoice.getHead().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    /**
     * After BELLATRIX_EPOCH and TTD it's okay to send a zero hash block hash for the finalized block. This will happen if
     * the current finalized block does not contain any execution payload at all (pre MERGE_EPOCH) or if it contains a
     * zero block hash (pre TTD)
     */
    const safeBlockHash = this.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    if (headBlockHash !== ZERO_HASH_HEX) {
      this.executionEngine.notifyForkchoiceUpdate(headBlockHash, safeBlockHash, finalizedBlockHash).catch((e) => {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
      });
    }
  }

  // Emit ChainEvent.block event
  //
  // TODO: Move internal emitter onBlock() code here
  // MUST happen before any other block is processed
  // This adds the state necessary to process the next block
  this.stateCache.add(postState);
  await this.db.block.add(block);

  // - head_tracker.register_block(block_root, parent_root, slot)

  // - Send event after everything is done

  // Emit all events at once after fully completing importBlock()
  this.emitter.emit(ChainEvent.block, block, postState);
  pendingEvents.emit();

  // Register stat metrics about the block after importing it
  this.metrics?.parentBlockDistance.observe(block.message.slot - parentBlockSlot);
  this.metrics?.proposerBalanceDeltaAny.observe(fullyVerifiedBlock.proposerBalanceDelta);
  this.metrics?.registerImportedBlock(block.message, fullyVerifiedBlock);

  const advancedSlot = this.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  this.reprocessController.onBlockImported({slot: block.message.slot, root: blockRoot}, advancedSlot);

  this.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: blockRoot,
    delaySec: this.clock.secFromSlot(block.message.slot),
  });
}
