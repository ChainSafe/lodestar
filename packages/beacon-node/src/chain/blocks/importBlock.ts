import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {
  AncestorStatus,
  EpochDifference,
  ForkChoiceError,
  ForkChoiceErrorCode,
  NotReorgedReason,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {ForkPostAltair, ForkPostElectra, ForkSeq, MAX_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAltair,
  EpochCache,
  RootCache,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  isExecutionStateType,
  isStartSlotOfEpoch,
  isStateValidatorsNodesPopulated,
} from "@lodestar/state-transition";
import {Attestation, BeaconBlock, altair, capella, electra, phase0, ssz} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {ChainEvent, ReorgEventData} from "../emitter.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import {toCheckpointHex} from "../stateCache/index.js";
import {isBlockInputBlobs, isBlockInputColumns} from "./blockInput/blockInput.js";
import {AttestationImportOpt, FullyVerifiedBlock, ImportBlockOpts} from "./types.js";
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
  const {blockInput, postState, parentBlockSlot, executionStatus, dataAvailabilityStatus, indexedAttestations} =
    fullyVerifiedBlock;
  const block = blockInput.getBlock();
  const source = blockInput.getBlockSource();
  const {slot: blockSlot} = block.message;
  const blockRoot = this.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const currentSlot = this.forkChoice.getTime();
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const blockEpoch = computeEpochAtSlot(blockSlot);
  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec =
    fullyVerifiedBlock.seenTimestampSec - computeTimeAtSlot(this.config, blockSlot, postState.genesisTime);
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);
  const fork = this.config.getForkSeq(blockSlot);

  // this is just a type assertion since blockinput with dataPromise type will not end up here
  if (!blockInput.hasAllData) {
    throw Error("Unavailable block can not be imported in forkchoice");
  }

  // 1. Persist block to hot DB (pre-emptively)
  // If eagerPersistBlock = true we do that in verifyBlocksInEpoch to batch all I/O operations to save block time to head
  if (!opts.eagerPersistBlock) {
    await writeBlockInputToDb.call(this, [blockInput]);
  }

  // Without forcefully clearing this cache, we would rely on WeakMap to evict memory which is not reliable
  this.serializedCache.clear();

  // 2. Import block to fork choice

  // Should compute checkpoint balances before forkchoice.onBlock
  this.checkpointBalancesCache.processState(blockRootHex, postState);
  const blockSummary = this.forkChoice.onBlock(
    block.message,
    postState,
    blockDelaySec,
    currentSlot,
    executionStatus,
    dataAvailabilityStatus
  );

  // This adds the state necessary to process the next block
  // Some block event handlers require state being in state cache so need to do this before emitting EventType.block
  this.regen.processState(blockRootHex, postState);

  this.metrics?.importBlock.bySource.inc({source: source.source});
  this.logger.verbose("Added block to forkchoice and state cache", {slot: blockSlot, root: blockRootHex});

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

    const addAttestation = fork >= ForkSeq.electra ? addAttestationPostElectra : addAttestationPreElectra;

    for (let i = 0; i < attestations.length; i++) {
      const attestation = attestations[i];
      try {
        const indexedAttestation = indexedAttestations[i];
        const {target, beaconBlockRoot} = attestation.data;

        const attDataRoot = toRootHex(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));
        addAttestation.call(
          this,
          postState.epochCtx,
          target,
          attDataRoot,
          attestation as Attestation<ForkPostElectra>,
          indexedAttestation
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
        this.validatorMonitor?.registerAttestationInBlock(
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
  const newHead = this.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    // Set head state as strong reference
    this.regen.updateHeadState(newHead, postState);

    try {
      this.emitter.emit(routes.events.EventType.head, {
        block: newHead.blockRoot,
        epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(newHead.slot)) === newHead.slot,
        slot: newHead.slot,
        state: newHead.stateRoot,
        previousDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.previous),
        currentDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.current),
        executionOptimistic: isOptimisticBlock(newHead),
      });
    } catch (e) {
      // getDependentRoot() may fail with error: "No block for root" as we can see in holesky non-finality issue
      this.logger.debug("Error emitting head event", {slot: newHead.slot, root: newHead.blockRoot}, e as Error);
    }

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
      if (delaySec < (SLOTS_PER_EPOCH * this.config.SLOT_DURATION_MS) / 1000) {
        this.metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
        const cutOffSec = this.config.getAttestationDueMs(this.config.getForkName(blockSlot)) / 1000;
        if (delaySec > cutOffSec) {
          this.metrics.importBlock.setHeadAfterCutoff.inc();
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
      callInNextEventLoop(() => {
        try {
          this.lightClientServer?.onImportBlockHead(
            block.message as BeaconBlock<ForkPostAltair>,
            postState as CachedBeaconStateAltair,
            parentBlockSlot
          );
        } catch (e) {
          this.logger.verbose("Error lightClientServer.onImportBlock", {slot: blockSlot}, e as Error);
        }
      });
    }
  }

  // 6. Queue notifyForkchoiceUpdate to engine api
  //
  // NOTE: forkChoice.fsStore.finalizedCheckpoint MUST only change in response to an onBlock event
  // Notifying EL of head and finalized updates as below is usually done within the 1st 4s of the slot.
  // If there is an advanced payload generation in the next slot, we'll notify EL again 4s before next
  // slot via PrepareNextSlotScheduler. There is no harm updating the ELs with same data, it will just ignore it.

  // Suppress fcu call if shouldOverrideFcu is true. This only happens if we have proposer boost reorg enabled
  // and the block is weak and can potentially be reorged out.
  let shouldOverrideFcu = false;

  if (blockSlot >= currentSlot && isExecutionStateType(postState)) {
    let notOverrideFcuReason = NotReorgedReason.Unknown;
    const proposalSlot = blockSlot + 1;
    try {
      const proposerIndex = postState.epochCtx.getBeaconProposer(proposalSlot);
      const feeRecipient = this.beaconProposerCache.get(proposerIndex);

      if (feeRecipient) {
        // We would set this to true if
        //  1) This is a gossip block
        //  2) We are proposer of next slot
        //  3) Proposer boost reorg related flag is turned on (this is checked inside the function)
        //  4) Block meets the criteria of being re-orged out (this is also checked inside the function)
        const result = this.forkChoice.shouldOverrideForkChoiceUpdate(
          blockSummary.blockRoot,
          this.clock.secFromSlot(currentSlot),
          currentSlot
        );
        shouldOverrideFcu = result.shouldOverrideFcu;
        if (!result.shouldOverrideFcu) {
          notOverrideFcuReason = result.reason;
        }
      } else {
        notOverrideFcuReason = NotReorgedReason.NotProposerOfNextSlot;
      }
    } catch (e) {
      if (isStartSlotOfEpoch(proposalSlot)) {
        notOverrideFcuReason = NotReorgedReason.NotShufflingStable;
      } else {
        this.logger.warn("Unable to get beacon proposer. Do not override fcu.", {proposalSlot}, e as Error);
      }
    }

    if (shouldOverrideFcu) {
      this.logger.verbose("Weak block detected. Skip fcu call in importBlock", {
        blockRoot: blockRootHex,
        slot: blockSlot,
      });
    } else {
      this.metrics?.importBlock.notOverrideFcuReason.inc({reason: notOverrideFcuReason});
      this.logger.verbose("Strong block detected. Not override fcu call", {
        blockRoot: blockRootHex,
        slot: blockSlot,
        reason: notOverrideFcuReason,
      });
    }
  }

  if (
    !this.opts.disableImportExecutionFcU &&
    (newHead.blockRoot !== oldHead.blockRoot || currFinalizedEpoch !== prevFinalizedEpoch) &&
    !shouldOverrideFcu
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
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice);
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

  // Cache shufflings when crossing an epoch boundary
  const parentEpoch = computeEpochAtSlot(parentBlockSlot);
  if (parentEpoch < blockEpoch) {
    this.shufflingCache.processState(postState);
    this.logger.verbose("Processed shuffling for next epoch", {parentEpoch, blockEpoch, slot: blockSlot});
  }

  if (blockSlot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.regen.addCheckpointState(cp, checkpointState);
    // consumers should not mutate state ever
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
          block: toRootHex(finalizedCheckpoint.root),
          epoch: finalizedCheckpoint.epoch,
          state: toRootHex(checkpointState.hashTreeRoot()),
          executionOptimistic: false,
        });
        this.logger.verbose("Checkpoint finalized", toCheckpointHex(finalizedCheckpoint));
        this.metrics?.finalizedEpoch.set(finalizedCheckpoint.epoch);
      }
    }
  }

  // Send block events, only for recent enough blocks

  if (currentSlot - blockSlot < EVENTSTREAM_EMIT_RECENT_BLOCK_SLOTS) {
    // We want to import block asap so call all event handler in the next event loop
    callInNextEventLoop(() => {
      // NOTE: Skip emitting if there are no listeners from the API
      if (this.emitter.listenerCount(routes.events.EventType.block)) {
        this.emitter.emit(routes.events.EventType.block, {
          block: blockRootHex,
          slot: blockSlot,
          executionOptimistic: blockSummary != null && isOptimisticBlock(blockSummary),
        });
      }
      if (this.emitter.listenerCount(routes.events.EventType.voluntaryExit)) {
        for (const voluntaryExit of block.message.body.voluntaryExits) {
          this.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.blsToExecutionChange)) {
        for (const blsToExecutionChange of (block.message as capella.BeaconBlock).body.blsToExecutionChanges ?? []) {
          this.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.attestation)) {
        for (const attestation of block.message.body.attestations) {
          this.emitter.emit(routes.events.EventType.attestation, attestation);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.attesterSlashing)) {
        for (const attesterSlashing of block.message.body.attesterSlashings) {
          this.emitter.emit(routes.events.EventType.attesterSlashing, attesterSlashing);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.proposerSlashing)) {
        for (const proposerSlashing of block.message.body.proposerSlashings) {
          this.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
        }
      }
    });
  }

  // Register stat metrics about the block after importing it
  this.metrics?.parentBlockDistance.observe(blockSlot - parentBlockSlot);
  this.metrics?.proposerBalanceDeltaAny.observe(fullyVerifiedBlock.proposerBalanceDelta);
  this.validatorMonitor?.registerImportedBlock(block.message, fullyVerifiedBlock);
  if (this.config.getForkSeq(blockSlot) >= ForkSeq.altair) {
    this.validatorMonitor?.registerSyncAggregateInBlock(
      blockEpoch,
      (block as altair.SignedBeaconBlock).message.body.syncAggregate,
      fullyVerifiedBlock.postState.epochCtx.currentSyncCommitteeIndexed.validatorIndices
    );
  }

  if (isBlockInputColumns(blockInput)) {
    for (const {source} of blockInput.getSampledColumnsWithSource()) {
      this.metrics?.importBlock.columnsBySource.inc({source});
    }
  } else if (isBlockInputBlobs(blockInput)) {
    for (const {source} of blockInput.getAllBlobsWithSource()) {
      this.metrics?.importBlock.blobsBySource.inc({blobsSource: source});
    }
  }

  const advancedSlot = this.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  // Gossip blocks need to be imported as soon as possible, waiting attestations could be processed
  // in the next event loop. See https://github.com/ChainSafe/lodestar/issues/4789
  callInNextEventLoop(() => {
    this.reprocessController.onBlockImported({slot: blockSlot, root: blockRootHex}, advancedSlot);
  });

  if (opts.seenTimestampSec !== undefined) {
    const recvToValidation = Date.now() / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    this.metrics?.gossipBlock.blockImport.recvToValidation.observe(recvToValidation);
    this.metrics?.gossipBlock.blockImport.validationTime.observe(validationTime);

    this.logger.debug("Imported block", {slot: blockSlot, recvToValLatency, recvToValidation, validationTime});
  }

  this.logger.verbose("Block processed", {
    slot: blockSlot,
    root: blockRootHex,
    delaySec: this.clock.secFromSlot(blockSlot),
  });
}

export function addAttestationPreElectra(
  this: BeaconChain,
  // added to have the same signature as addAttestationPostElectra
  _: EpochCache,
  target: phase0.Checkpoint,
  attDataRoot: string,
  attestation: Attestation,
  indexedAttestation: phase0.IndexedAttestation
): void {
  this.seenAggregatedAttestations.add(
    target.epoch,
    attestation.data.index,
    attDataRoot,
    {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
    true
  );
}

export function addAttestationPostElectra(
  this: BeaconChain,
  epochCtx: EpochCache,
  target: phase0.Checkpoint,
  attDataRoot: string,
  attestation: Attestation<ForkPostElectra>,
  indexedAttestation: electra.IndexedAttestation
): void {
  const committeeIndices = attestation.committeeBits.getTrueBitIndexes();
  if (committeeIndices.length === 1) {
    this.seenAggregatedAttestations.add(
      target.epoch,
      committeeIndices[0],
      attDataRoot,
      {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
      true
    );
  } else {
    const attSlot = attestation.data.slot;
    const attEpoch = computeEpochAtSlot(attSlot);
    const decisionRoot = epochCtx.getShufflingDecisionRoot(attEpoch);
    const committees = this.shufflingCache.getBeaconCommittees(attEpoch, decisionRoot, attSlot, committeeIndices);
    const aggregationBools = attestation.aggregationBits.toBoolArray();
    let offset = 0;
    for (let i = 0; i < committees.length; i++) {
      const committee = committees[i];
      const aggregationBits = BitArray.fromBoolArray(aggregationBools.slice(offset, offset + committee.length));
      const trueBitCount = aggregationBits.getTrueBitIndexes().length;
      offset += committee.length;
      this.seenAggregatedAttestations.add(
        target.epoch,
        committeeIndices[i],
        attDataRoot,
        {aggregationBits, trueBitCount},
        true
      );
    }
  }
}
