import {toHexString} from "@chainsafe/ssz";
import {capella, ssz, allForks, altair} from "@lodestar/types";
import {ForkSeq, INTERVALS_PER_SLOT, MAX_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isStateValidatorsNodesPopulated,
  RootCache,
} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {ForkChoiceError, ForkChoiceErrorCode, EpochDifference, AncestorStatus} from "@lodestar/fork-choice";
import {isErrorAborted} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {toCheckpointHex} from "../stateCache/index.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {ChainEvent, ReorgEventData} from "../emitter.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import type {BeaconChain} from "../chain.js";
import {FullyVerifiedBlock, ImportBlockOpts, AttestationImportOpt, BlockInputType} from "./types.js";
import {getCheckpointFromState} from "./utils/checkpoint.js";
import {writeBlockInputToDb} from "./writeBlockInputToDb.js";

/**
 * Fork-choice allows to import attestations from current (0) or past (1) epoch.
 */
const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;
/**
 * Emit eventstream events for block contents events only for blocks that are recent enough to clock
 */
const EVENTSTREAM_EMIT_RECENT_BLOCK_SLOTS = 64;

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
  const {block, source} = blockInput;
  const {slot: blockSlot} = block.message;
  const blockRoot = this.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toHexString(blockRoot);
  const currentEpoch = computeEpochAtSlot(this.forkChoice.getTime());
  const blockEpoch = computeEpochAtSlot(blockSlot);
  const parentEpoch = computeEpochAtSlot(parentBlockSlot);
  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec = (fullyVerifiedBlock.seenTimestampSec - postState.genesisTime) % this.config.SECONDS_PER_SLOT;

  // 1. Persist block to hot DB (pre-emptively)
  // If eagerPersistBlock = true we do that in verifyBlocksInEpoch to batch all I/O operations to save block time to head
  if (!opts.eagerPersistBlock) {
    await writeBlockInputToDb.call(this, [blockInput]);
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
  this.regen.addPostState(postState);

  this.metrics?.importBlock.bySource.inc({source});
  this.logger.verbose("Added block to forkchoice and state cache", {slot: blockSlot, root: blockRootHex});

  // We want to import block asap so call all event handler in the next event loop
  setTimeout(() => {
    this.emitter.emit(routes.events.EventType.block, {
      block: blockRootHex,
      slot: blockSlot,
      executionOptimistic: blockSummary != null && isOptimisticBlock(blockSummary),
    });

    if (blockInput.type === BlockInputType.postDeneb) {
      for (const blobSidecar of blockInput.blobs) {
        const {index, kzgCommitment} = blobSidecar;
        this.emitter.emit(routes.events.EventType.blobSidecar, {
          blockRoot: blockRootHex,
          slot: blockSlot,
          index,
          kzgCommitment: toHexString(kzgCommitment),
          versionedHash: toHexString(kzgCommitmentToVersionedHash(kzgCommitment)),
        });
      }
    }
  }, 0);

  const secFromSlot = this.clock.secFromSlot(blockSlot);
  // 2/3 of slot is the most free time of every slot, take that chance to persist checkpoint states
  // normally it should only persist checkpoint states at 2/3 of slot 0 of epoch
  const secToTwoThirdsSlot = (2 * this.config.SECONDS_PER_SLOT) / INTERVALS_PER_SLOT - secFromSlot;
  setTimeout(
    async () => {
      const persistCount = await this.regen.onProcessState(blockRootHex, postState);
      if (persistCount > 0) {
        this.logger.verbose("Persisted checkpoint states", {slot: blockSlot, root: blockRootHex, persistCount});
      }
    },
    Math.max(0, secToTwoThirdsSlot * 1000)
  );

  // 3. Import attestations to fork choice
  //
  // - For each attestation
  //   - Get indexed attestation
  //   - Register attestation with fork-choice
  //   - Register attestation with validator monitor (only after sync)
  // Only process attestations of blocks with relevant attestations for the fork-choice:
  // If current epoch is N, and block is epoch X, block may include attestations for epoch X or X - 1.
  // The latest block that is useful is at epoch N - 1 which may include attestations for epoch N - 1 or N - 2.
  if (
    opts.importAttestations === AttestationImportOpt.Force ||
    (opts.importAttestations !== AttestationImportOpt.Skip && blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
  ) {
    const attestations = block.message.body.attestations;
    const rootCache = new RootCache(postState);
    const invalidAttestationErrorsByCode = new Map<string, {error: Error; count: number}>();

    for (const attestation of attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        const {target, beaconBlockRoot} = attestation.data;

        const attDataRoot = toHexString(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));
        this.seenAggregatedAttestations.add(
          target.epoch,
          attDataRoot,
          {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
          true
        );
        // Duplicated logic from fork-choice onAttestation validation logic.
        // Attestations outside of this range will be dropped as Errors, so no need to import
        if (
          opts.importAttestations === AttestationImportOpt.Force ||
          (target.epoch <= currentEpoch && target.epoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
        ) {
          this.forkChoice.onAttestation(
            indexedAttestation,
            attDataRoot,
            opts.importAttestations === AttestationImportOpt.Force
          );
        }

        // Note: To avoid slowing down sync, only register attestations within FORK_CHOICE_ATT_EPOCH_LIMIT
        this.seenBlockAttesters.addIndices(blockEpoch, indexedAttestation.attestingIndices);

        const correctHead = ssz.Root.equals(rootCache.getBlockRootAtSlot(attestation.data.slot), beaconBlockRoot);
        const missedSlotVote = ssz.Root.equals(
          rootCache.getBlockRootAtSlot(attestation.data.slot - 1),
          rootCache.getBlockRootAtSlot(attestation.data.slot)
        );
        this.metrics?.registerAttestationInBlock(
          indexedAttestation,
          parentBlockSlot,
          correctHead,
          missedSlotVote,
          blockRootHex,
          blockSlot
        );
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
          this.logger.warn("Error processing attestation from block", {slot: blockSlot}, e as Error);
        }
      }
    }

    for (const {error, count} of invalidAttestationErrorsByCode.values()) {
      this.logger.warn(
        "Error processing attestations from block",
        {slot: blockSlot, erroredAttestations: count},
        error
      );
    }
  }

  // 4. Import attester slashings to fork choice
  //
  // FORK_CHOICE_ATT_EPOCH_LIMIT is for attestation to become valid
  // but AttesterSlashing could be found before that time and still able to submit valid attestations
  // until slashed validator become inactive, see computeActivationExitEpoch() function
  if (
    opts.importAttestations === AttestationImportOpt.Force ||
    (opts.importAttestations !== AttestationImportOpt.Skip &&
      blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT - 1 - MAX_SEED_LOOKAHEAD)
  ) {
    for (const slashing of block.message.body.attesterSlashings) {
      try {
        // all AttesterSlashings are valid before reaching this
        this.forkChoice.onAttesterSlashing(slashing);
      } catch (e) {
        this.logger.warn("Error processing AttesterSlashing from block", {slot: blockSlot}, e as Error);
      }
    }
  }

  // 5. Compute head. If new head, immediately stateCache.setHeadState()

  const oldHead = this.forkChoice.getHead();
  const newHead = this.recomputeForkChoiceHead();
  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    // Set head state as strong reference
    this.regen.updateHeadState(newHead.stateRoot, postState);

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
      if (delaySec < SLOTS_PER_EPOCH * this.config.SECONDS_PER_SLOT) {
        this.metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
        if (delaySec > this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT) {
          this.metrics.importBlock.setHeadAfterFirstInterval.inc();
        }
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
      // we want to import block asap so do this in the next event loop
      setTimeout(() => {
        try {
          this.lightClientServer.onImportBlockHead(
            block.message as allForks.AllForksLightClient["BeaconBlock"],
            postState as CachedBeaconStateAltair,
            parentBlockSlot
          );
        } catch (e) {
          this.logger.verbose("Error lightClientServer.onImportBlock", {slot: blockSlot}, e as Error);
        }
      }, 0);
    }
  }

  // 6. Queue notifyForkchoiceUpdate to engine api
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
          if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
            this.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
          }
        });
    }
  }

  if (!isStateValidatorsNodesPopulated(postState)) {
    this.logger.verbose("After importBlock caching postState without SSZ cache", {slot: postState.slot});
  }

  if (parentEpoch < blockEpoch) {
    // current epoch and previous epoch are likely cached in previous states
    this.shufflingCache.processState(postState, postState.epochCtx.nextShuffling.epoch);
    this.logger.verbose("Processed shuffling for next epoch", {parentEpoch, blockEpoch, slot: blockSlot});
  }

  if (blockSlot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.regen.addCheckpointState(cp, checkpointState);
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

  // Send block events, only for recent enough blocks

  if (this.clock.currentSlot - blockSlot < EVENTSTREAM_EMIT_RECENT_BLOCK_SLOTS) {
    // NOTE: Skip looping if there are no listeners from the API
    if (this.emitter.listenerCount(routes.events.EventType.voluntaryExit)) {
      for (const voluntaryExit of block.message.body.voluntaryExits) {
        this.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
      }
    }
    if (this.emitter.listenerCount(routes.events.EventType.blsToExecutionChange)) {
      for (const blsToExecutionChange of (block.message.body as capella.BeaconBlockBody).blsToExecutionChanges ?? []) {
        this.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
      }
    }
    if (this.emitter.listenerCount(routes.events.EventType.attestation)) {
      for (const attestation of block.message.body.attestations) {
        this.emitter.emit(routes.events.EventType.attestation, attestation);
      }
    }
  }

  // Register stat metrics about the block after importing it
  this.metrics?.parentBlockDistance.observe(blockSlot - parentBlockSlot);
  this.metrics?.proposerBalanceDeltaAny.observe(fullyVerifiedBlock.proposerBalanceDelta);
  this.metrics?.registerImportedBlock(block.message, fullyVerifiedBlock);
  if (this.config.getForkSeq(blockSlot) >= ForkSeq.altair) {
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
    this.reprocessController.onBlockImported({slot: blockSlot, root: blockRootHex}, advancedSlot);
  }, 0);

  if (opts.seenTimestampSec !== undefined) {
    const recvToImportedBlock = Date.now() / 1000 - opts.seenTimestampSec;
    this.metrics?.gossipBlock.receivedToBlockImport.observe(recvToImportedBlock);
    this.logger.verbose("Imported block", {slot: blockSlot, recvToImportedBlock});
  }

  this.logger.verbose("Block processed", {
    slot: blockSlot,
    root: blockRootHex,
    delaySec: this.clock.secFromSlot(blockSlot),
  });
}
