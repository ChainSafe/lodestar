import {capella, allForks, altair} from "@lodestar/types";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isStateValidatorsNodesPopulated,
} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {EpochDifference, AncestorStatus} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {toCheckpointHex} from "../stateCache/index.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {ChainEvent, ReorgEventData} from "../emitter.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import {RegenCaller} from "../regen/interface.js";
import type {BeaconChain} from "../chain.js";
import {BlockInputType, FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
import {getCheckpointFromState} from "./utils/checkpoint.js";

/**
 * Imports a fully verified block into the chain state. Produces multiple permanent side-effects.
 *
 * ImportBlock order of operations must guarantee that BeaconNode does not end in an unknown state:
 *
 * 1. Persist block to hot DB (pre-emptively)
 *    - Done before importing block to fork-choice to guarantee that blocks in the fork-choice *always* are persisted
 *      in the DB. Otherwise the beacon node may end up in an unrecoverable state. If a block is persisted in the hot
 *      db but is unknown by the fork-choice, then it will just use some extra disk space. On restart is will be
 *      pruned regardless.
 *    - Note that doing a disk write first introduces a small delay before setting the head. An improvement where disk
 *      write happens latter requires the ability to roll back a fork-choice head change if disk write fails
 *
 * 2. Import block to fork-choice
 * 3. Import attestations to fork-choice
 * 4. Import attester slashings to fork-choice
 * 5. Compute head. If new head, immediately stateCache.setHeadState()
 * 6. Queue notifyForkchoiceUpdate to engine api
 * 7. Add post state to stateCache
 */
export async function importBlock(
  this: BeaconChain,
  fullyVerifiedBlock: FullyVerifiedBlock,
  opts: ImportBlockOpts
): Promise<void> {
  const {blockInput, postState, parentBlockSlot, executionStatus} = fullyVerifiedBlock;
  const {block} = blockInput;
  const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toHexString(blockRoot);
  const blockEpoch = computeEpochAtSlot(block.message.slot);
  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec = (fullyVerifiedBlock.seenTimestampSec - postState.genesisTime) % this.config.SECONDS_PER_SLOT;

  // 1. Persist block to hot DB (pre-emptively)

  await this.db.block.add(block);
  this.logger.debug("Persisted block to hot DB", {
    slot: block.message.slot,
    root: blockRootHex,
  });

  if (blockInput.type === BlockInputType.postDeneb) {
    const {blobs} = blockInput;
    // NOTE: Old blobs are pruned on archive
    await this.db.blobsSidecar.add(blobs);
    this.logger.debug("Persisted blobsSidecar to hot DB", {
      blobsLen: blobs.blobs.length,
      slot: blobs.beaconBlockSlot,
      root: toHexString(blobs.beaconBlockRoot),
    });
  }

  // 2. Import block to fork choice

  // Should compute checkpoint balances before forkchoice.onBlock
  this.checkpointBalancesCache.processState(blockRootHex, postState);
  const blockSummary = this.forkChoice.onBlock(
    block.message,
    postState,
    blockDelaySec,
    this.clock.currentSlot,
    executionStatus
  );

  // This adds the state necessary to process the next block
  // Some block event handlers require state being in state cache so need to do this before emitting EventType.block
  this.stateCache.add(postState);

  this.logger.verbose("Added block to forkchoice and state cache", {slot: block.message.slot, root: blockRootHex});
  this.emitter.emit(routes.events.EventType.block, {
    block: toHexString(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
    slot: block.message.slot,
    executionOptimistic: blockSummary != null && isOptimisticBlock(blockSummary),
  });

  // Attestations and AttesterSlashings are imported in verifyBlock()

  // 3. Compute head. If new head, immediately stateCache.setHeadState()

  const oldHead = this.forkChoice.getHead();
  // skip computeDeltas() if possible as we called prepareUpdateHead() in verifyBlock()
  const newHead = this.recomputeForkChoiceHead(true);
  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
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

    this.emitter.emit(routes.events.EventType.head, {
      block: newHead.blockRoot,
      epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(newHead.slot)) === newHead.slot,
      slot: newHead.slot,
      state: newHead.stateRoot,
      previousDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.previous),
      currentDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.current),
      executionOptimistic: isOptimisticBlock(newHead),
    });

    const delaySec = this.clock.secFromSlot(newHead.slot);
    this.logger.verbose("New chain head", {
      slot: newHead.slot,
      root: newHead.blockRoot,
      delaySec,
    });

    if (this.metrics) {
      this.metrics.headSlot.set(newHead.slot);
      // Only track "recent" blocks. Otherwise sync can distort this metrics heavily.
      // We want to track recent blocks coming from gossip, unknown block sync, and API.
      if (delaySec < 64 * this.config.SECONDS_PER_SLOT) {
        this.metrics.elapsedTimeTillBecomeHead.observe(delaySec);
      }
    }

    this.onNewHead(newHead);

    this.metrics?.forkChoice.changedHead.inc();

    const ancestorResult = this.forkChoice.getCommonAncestorDepth(oldHead, newHead);
    if (ancestorResult.code === AncestorStatus.CommonAncestor) {
      // CommonAncestor = chain reorg, old head and new head not direct descendants

      const forkChoiceReorgEventData: ReorgEventData = {
        depth: ancestorResult.depth,
        epoch: computeEpochAtSlot(newHead.slot),
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: oldHead.blockRoot,
        newHeadState: newHead.stateRoot,
        oldHeadState: oldHead.stateRoot,
        executionOptimistic: isOptimisticBlock(newHead),
      };

      this.emitter.emit(routes.events.EventType.chainReorg, forkChoiceReorgEventData);
      this.logger.verbose("Chain reorg", forkChoiceReorgEventData);

      this.metrics?.forkChoice.reorg.inc();
      this.metrics?.forkChoice.reorgDistance.observe(ancestorResult.depth);
    }

    // Lightclient server support (only after altair)
    // - Persist state witness
    // - Use block's syncAggregate
    if (blockEpoch >= this.config.ALTAIR_FORK_EPOCH) {
      try {
        this.lightClientServer.onImportBlockHead(
          block.message as allForks.AllForksLightClient["BeaconBlock"],
          postState as CachedBeaconStateAltair,
          parentBlockSlot
        );
      } catch (e) {
        this.logger.error("Error lightClientServer.onImportBlock", {slot: block.message.slot}, e as Error);
      }
    }
  }

  // 4. Queue notifyForkchoiceUpdate to engine api
  //
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
      this.executionEngine
        .notifyForkchoiceUpdate(
          this.config.getForkName(this.forkChoice.getHead().slot),
          headBlockHash,
          safeBlockHash,
          finalizedBlockHash
        )
        .catch((e) => {
          this.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
        });
    }
  }

  if (!isStateValidatorsNodesPopulated(postState)) {
    this.logger.verbose("After importBlock caching postState without SSZ cache", {slot: postState.slot});
  }

  if (block.message.slot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.checkpointStateCache.add(cp, checkpointState);
    this.emitter.emit(ChainEvent.checkpoint, cp, checkpointState);

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
        this.logger.verbose("Checkpoint justified", toCheckpointHex(justifiedCheckpoint));
        this.metrics?.previousJustifiedEpoch.set(checkpointState.previousJustifiedCheckpoint.epoch);
        this.metrics?.currentJustifiedEpoch.set(justifiedCheckpoint.epoch);
      }
      const finalizedCheckpoint = checkpointState.finalizedCheckpoint;
      const finalizedEpoch = finalizedCheckpoint.epoch;
      const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
      if (finalizedEpoch > preFinalizedEpoch) {
        this.emitter.emit(routes.events.EventType.finalizedCheckpoint, {
          block: toHexString(finalizedCheckpoint.root),
          epoch: finalizedCheckpoint.epoch,
          state: toHexString(checkpointState.hashTreeRoot()),
          executionOptimistic: false,
        });
        this.logger.verbose("Checkpoint finalized", toCheckpointHex(finalizedCheckpoint));
        this.metrics?.finalizedEpoch.set(finalizedCheckpoint.epoch);
      }
    }
  }

  // Send block events

  for (const voluntaryExit of block.message.body.voluntaryExits) {
    this.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
  }

  for (const blsToExecutionChange of (block.message.body as capella.BeaconBlockBody).blsToExecutionChanges ?? []) {
    this.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
  }

  // Register stat metrics about the block after importing it
  this.metrics?.parentBlockDistance.observe(block.message.slot - parentBlockSlot);
  this.metrics?.proposerBalanceDeltaAny.observe(fullyVerifiedBlock.proposerBalanceDelta);
  this.metrics?.registerImportedBlock(block.message, fullyVerifiedBlock);
  if (this.config.getForkSeq(block.message.slot) >= ForkSeq.altair) {
    this.metrics?.registerSyncAggregateInBlock(
      blockEpoch,
      (block as altair.SignedBeaconBlock).message.body.syncAggregate,
      fullyVerifiedBlock.postState.epochCtx.currentSyncCommitteeIndexed.validatorIndices
    );
  }

  const advancedSlot = this.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  // Gossip blocks need to be imported as soon as possible, waiting attestations could be processed
  // in the next event loop. See https://github.com/ChainSafe/lodestar/issues/4789
  setTimeout(() => {
    this.reprocessController.onBlockImported({slot: block.message.slot, root: blockRootHex}, advancedSlot);
  }, 0);

  if (opts.seenTimestampSec !== undefined) {
    const recvToImportedBlock = Date.now() / 1000 - opts.seenTimestampSec;
    this.metrics?.gossipBlock.receivedToBlockImport.observe(recvToImportedBlock);
    this.logger.verbose("Imported block", {slot: block.message.slot, recvToImportedBlock});
  }

  this.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: blockRootHex,
    delaySec: this.clock.secFromSlot(block.message.slot),
  });
}
