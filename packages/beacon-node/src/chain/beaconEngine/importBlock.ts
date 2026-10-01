import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {
  AncestorStatus,
  BlockExecutionStatus,
  EpochDifference,
  ExecutionStatus,
  ForkChoiceError,
  ForkChoiceErrorCode,
  NotReorgedReason,
  PayloadExecutionStatus,
  ProtoBlock,
  UpdateHeadOpt,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {
  ForkPostAltair,
  ForkPostElectra,
  ForkSeq,
  GENESIS_SLOT,
  MAX_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  IBeaconStateView,
  RootCache,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  isStartSlotOfEpoch,
  isStatePostAltair,
  isStatePostBellatrix,
} from "@lodestar/state-transition";
import {
  Attestation,
  BeaconBlock,
  IndexedAttestation,
  altair,
  electra,
  isGloasBeaconBlock,
  phase0,
  ssz,
} from "@lodestar/types";
import {isErrorAborted, toRootHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {isBlockInputBlobs, isBlockInputColumns} from "../blocks/blockInput/blockInput.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {AttestationImportOpt, ImportBlockOpts} from "../blocks/types.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {ChainEvent, ReorgEventData} from "../emitter.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {toCheckpointHex} from "../stateCache/persistentCheckpointsCache.js";
import {BeaconEngine} from "./beaconEngine.js";
import {ImportBlockResult} from "./interface.js";

export type VerifiedBlockBundle = {
  postState: IBeaconStateView;
  blockInput: IBlockInput;
  indexedAttestations: IndexedAttestation[];
  proposerBalanceDelta: number;
  parentBlockSlot: number;
  seenTimestampSec: number;
};

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/importBlock.ts#importBlock.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function importBlock(
  this: BeaconEngine,
  // [beacon-engine] deviation: consume the engine-owned verification bundle and facade DA/EL statuses.
  v: VerifiedBlockBundle,
  executionStatus: BlockExecutionStatus | PayloadExecutionStatus,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportBlockOpts
): Promise<ImportBlockResult> {
  const {blockInput, postState, parentBlockSlot, indexedAttestations, proposerBalanceDelta, seenTimestampSec} = v;
  let execStatus = executionStatus;
  const block = blockInput.getBlock();
  const source = blockInput.getBlockSource();
  const {slot: blockSlot} = block.message;
  // [beacon-engine] deviation: reuse the input root instead of rehashing the block.
  const blockRootHex = blockInput.blockRootHex;
  const currentSlot = this.forkChoice.getTime();
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const blockEpoch = computeEpochAtSlot(blockSlot);
  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec = seenTimestampSec - computeTimeAtSlot(this.config, blockSlot, postState.genesisTime);
  const fork = this.config.getForkSeq(blockSlot);
  const isExecutionState = isStatePostBellatrix(postState) && postState.isExecutionStateType;

  // 2. Import block to fork choice
  this.checkpointBalancesCache.processState(blockRootHex, postState);
  if (fork >= ForkSeq.gloas) {
    const parentRootHex = toRootHex(block.message.parentRoot);
    const parentBlock = this.forkChoice.getBlockHexDefaultStatus(parentRootHex);
    if (parentBlock === null) {
      throw Error(`Parent block not found in forkChoice, parentRoot=${parentRootHex}`);
    }
    if (parentBlock.executionStatus === ExecutionStatus.Invalid) {
      throw Error(`Parent block has invalid execution status, parentRoot=${parentRootHex}`);
    }
    execStatus = parentBlock.executionStatus;
  }

  // getBeaconProposerOrNull returns null if the head state is more than one epoch away from the
  // block slot; we skip the proposer-boost canonical check as we cannot determine the proposer.
  const expectedProposerIndex: number | null = this.getHeadState().getBeaconProposerOrNull(blockSlot);

  const blockSummary = this.forkChoice.onBlock(
    block.message,
    postState,
    blockDelaySec,
    currentSlot,
    execStatus,
    dataAvailabilityStatus,
    expectedProposerIndex
  );

  // [beacon-engine] deviation: regen owns post-state insertion; facade owns block persistence.
  this.regen.processState(blockRootHex, postState);
  this.metrics?.importBlock.bySource.inc({source: source.source});
  this.logger.verbose("Added block to forkchoice and state cache", {slot: blockSlot, root: blockRootHex});

  // 3. Import attestations to fork choice
  // [beacon-engine] deviation: keep the branch-local attestation epoch limit rather than the upstream file constant.
  const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;

  if (
    opts.importAttestations === AttestationImportOpt.Force ||
    (opts.importAttestations !== AttestationImportOpt.Skip && blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
  ) {
    const attestations = block.message.body.attestations;
    const rootCache = new RootCache(postState);
    const invalidAttestationErrorsByCode = new Map<string, {error: Error; count: number}>();

    // [beacon-engine] deviation: bind the free attestation helpers to this engine.
    const addAttestation =
      fork >= ForkSeq.electra ? addAttestationPostElectra.bind(this) : addAttestationPreElectra.bind(this);

    for (let i = 0; i < attestations.length; i++) {
      const attestation = attestations[i];
      try {
        const indexedAttestation = indexedAttestations[i];
        const {target, beaconBlockRoot} = attestation.data;
        const attDataRoot = toRootHex(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));

        addAttestation(postState, target, attDataRoot, attestation as Attestation<ForkPostElectra>, indexedAttestation);

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

        // [beacon-engine] deviation: copy attesting indices before inserting them into the liveness cache.
        // Register attesters seen in this block for the liveness cache (engine-owned).
        this.seenBlockAttesters.addIndices(blockEpoch, Array.from(indexedAttestation.attestingIndices));

        const correctHead = ssz.Root.equals(rootCache.getBlockRootAtSlot(attestation.data.slot), beaconBlockRoot);
        const missedSlotVote =
          attestation.data.slot > GENESIS_SLOT &&
          ssz.Root.equals(
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
        if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
          let errWithCount = invalidAttestationErrorsByCode.get(e.type.err.code);
          if (errWithCount === undefined) {
            errWithCount = {error: e as Error, count: 1};
            invalidAttestationErrorsByCode.set(e.type.err.code, errWithCount);
          } else {
            errWithCount.count++;
          }
        } else {
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

  // 4. Import attester slashings
  if (
    opts.importAttestations === AttestationImportOpt.Force ||
    (opts.importAttestations !== AttestationImportOpt.Skip &&
      blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT - 1 - MAX_SEED_LOOKAHEAD)
  ) {
    for (const slashing of block.message.body.attesterSlashings) {
      try {
        this.forkChoice.onAttesterSlashing(slashing);
      } catch (e) {
        this.logger.warn("Error processing AttesterSlashing from block", {slot: blockSlot}, e as Error);
      }
    }
  }

  // 4.5. Import payload attestations (Gloas)
  if (isGloasBeaconBlock(block.message)) {
    for (const payloadAttestation of block.message.body.payloadAttestations) {
      try {
        const ptcIndices: number[] = [];
        for (let i = 0; i < payloadAttestation.aggregationBits.bitLen; i++) {
          if (payloadAttestation.aggregationBits.get(i)) {
            ptcIndices.push(i);
          }
        }
        if (ptcIndices.length > 0) {
          this.forkChoice.notifyPtcMessages(
            toRootHex(payloadAttestation.data.beaconBlockRoot),
            payloadAttestation.data.slot,
            ptcIndices,
            payloadAttestation.data.payloadPresent,
            payloadAttestation.data.blobDataAvailable
          );
        }
      } catch (e) {
        this.logger.warn("Error processing PayloadAttestation from block", {slot: blockSlot}, e as Error);
      }
    }
  }

  // 5. Compute head
  const oldHead = this.forkChoice.getHead();
  const oldHeadBlockRoot = oldHead.blockRoot;

  this.metrics?.forkChoice.requests.inc();
  const newHeadTimer = this.metrics?.forkChoice.findHead.startTimer({caller: ForkchoiceCaller.importBlock});
  let newHead: ProtoBlock;
  try {
    newHead = this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetCanonicalHead}).head;
  } catch (e) {
    this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetCanonicalHead});
    throw e;
  } finally {
    newHeadTimer?.();
  }

  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  // [beacon-engine] deviation: return head/reorg data for facade emission and head-cache refresh.
  let headChanged = false;
  let headResult: ImportBlockResult["head"] = null;
  let reorg: ReorgEventData | null = null;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    headChanged = true;

    this.regen.updateHeadState(newHead, postState);

    try {
      headResult = {
        block: newHead.blockRoot,
        epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(newHead.slot)) === newHead.slot,
        slot: newHead.slot,
        state: newHead.stateRoot,
        previousDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.previous),
        currentDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.current),
        executionOptimistic: isOptimisticBlock(newHead),
      };
    } catch (e) {
      this.logger.debug("Error building head event data", {slot: newHead.slot, root: newHead.blockRoot}, e as Error);
    }

    const delaySec = this.clock.secFromSlot(newHead.slot);
    this.logger.verbose("New chain head", {slot: newHead.slot, root: newHead.blockRoot, delaySec});

    if (this.metrics) {
      this.metrics.headSlot.set(newHead.slot);
      if (delaySec < (SLOTS_PER_EPOCH * this.config.SLOT_DURATION_MS) / 1000) {
        this.metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
        const cutOffSec = this.config.getAttestationDueMs(this.config.getForkName(blockSlot)) / 1000;
        if (delaySec > cutOffSec) {
          this.metrics.importBlock.setHeadAfterCutoff.inc();
        }
      }
    }

    // [beacon-engine] deviation: prune consensus pools here; facade emits checkpoint/head events.
    this.syncContributionAndProofPool.prune(newHead.slot);
    this.seenContributionAndProof.prune(newHead.slot);

    this.metrics?.forkChoice.changedHead.inc();

    const ancestorResult = this.forkChoice.getCommonAncestorDepth(oldHead, newHead);
    if (ancestorResult.code === AncestorStatus.CommonAncestor) {
      reorg = {
        depth: ancestorResult.depth,
        epoch: computeEpochAtSlot(newHead.slot),
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: oldHead.blockRoot,
        newHeadState: newHead.stateRoot,
        oldHeadState: oldHead.stateRoot,
        executionOptimistic: isOptimisticBlock(newHead),
      };
      this.metrics?.forkChoice.reorg.inc();
      this.metrics?.forkChoice.reorgDistance.observe(ancestorResult.depth);
    }

    if (blockEpoch >= this.config.ALTAIR_FORK_EPOCH) {
      callInNextEventLoop(() => {
        try {
          if (isStatePostAltair(postState)) {
            this.lightClientServer?.onImportBlockHead(
              block.message as BeaconBlock<ForkPostAltair>,
              postState,
              parentBlockSlot
            );
          }
        } catch (e) {
          this.logger.verbose("Error lightClientServer.onImportBlock", {slot: blockSlot}, e as Error);
        }
      });
    }
  }

  // [beacon-engine] deviation: retain branch ordering of shuffling/checkpoint processing before FCU.
  const parentEpoch = computeEpochAtSlot(parentBlockSlot);
  if (parentEpoch < blockEpoch) {
    this.shufflingCache.processState(postState);
    this.logger.verbose("Processed shuffling for next epoch", {parentEpoch, blockEpoch, slot: blockSlot});
  }

  if (blockSlot % SLOTS_PER_EPOCH === 0) {
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.regen.addCheckpointState(cp, checkpointState);
    this.emitter.emit(ChainEvent.checkpoint, cp);
    this.logger.verbose("Checkpoint processed", toCheckpointHex(cp));

    const activeValidatorsCount = checkpointState.activeValidatorCount;
    this.metrics?.currentActiveValidators.set(activeValidatorsCount);
    this.metrics?.currentValidators.set({status: "active"}, activeValidatorsCount);

    const parentBlockSummary = isGloasBeaconBlock(block.message)
      ? this.forkChoice.getBlockHexAndBlockHash(
          toRootHex(checkpointState.latestBlockHeader.parentRoot),
          toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
        )
      : this.forkChoice.getBlockDefaultStatus(checkpointState.latestBlockHeader.parentRoot);

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

  // [beacon-engine] deviation: retain the nullable proposer handoff and epoch-boundary fallback.
  let proposerIndexNextSlot: number | null = null;
  if (blockSlot >= currentSlot && isExecutionState) {
    try {
      proposerIndexNextSlot = postState.getBeaconProposer(blockSlot + 1);
    } catch {
      // epoch boundary, proposer shuffle not yet stable
    }
  }

  if (!postState.isStateValidatorsNodesPopulated()) {
    this.logger.verbose("After importBlock caching postState without SSZ cache", {slot: postState.slot});
  }

  this.metrics?.parentBlockDistance.observe(blockSlot - parentBlockSlot);
  this.metrics?.proposerBalanceDeltaAny.observe(proposerBalanceDelta);
  this.validatorMonitor?.registerImportedBlock(block.message, {proposerBalanceDelta});
  if (isStatePostAltair(postState)) {
    this.validatorMonitor?.registerSyncAggregateInBlock(
      blockEpoch,
      (block as altair.SignedBeaconBlock).message.body.syncAggregate,
      postState.currentSyncCommitteeIndexed.validatorIndices
    );
  }

  if (isBlockInputColumns(blockInput)) {
    for (const {source} of blockInput.getSampledColumnsWithSource()) {
      this.metrics?.dataColumns.bySource.inc({source});
    }
  } else if (isBlockInputBlobs(blockInput)) {
    for (const {source} of blockInput.getAllBlobsWithSource()) {
      this.metrics?.importBlock.blobsBySource.inc({blobsSource: source});
    }
  }

  // 6. Queue notifyForkchoiceUpdate to engine api.
  let shouldOverrideFcu = false;

  // [beacon-engine] deviation: use the precomputed execution-state flag and nullable proposer.
  if (isExecutionState && blockSlot >= currentSlot) {
    let notOverrideFcuReason = NotReorgedReason.Unknown;
    const proposalSlot = blockSlot + 1;
    try {
      if (proposerIndexNextSlot !== null) {
        // [beacon-engine] deviation: proposer fee-recipient lookup uses the engine accessor.
        const feeRecipient = this.getProposerFeeRecipient(proposerIndexNextSlot);
        if (feeRecipient && blockSummary !== null) {
          const result = this.forkChoice.shouldOverrideForkChoiceUpdate(
            blockSummary,
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
      } else {
        if (isStartSlotOfEpoch(proposalSlot)) {
          notOverrideFcuReason = NotReorgedReason.NotShufflingStable;
        }
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

  // [beacon-engine] deviation: facade consumes import metadata instead of consensus state references.
  return {
    headChanged,
    head: headResult,
    reorg,
    blockSummary,
    proposerIndexNextSlot,
    isExecutionState,
    prevFinalizedEpoch,
    currFinalizedEpoch,
    oldHeadBlockRoot,
    newHeadBlockRoot: newHead.blockRoot,
    newHead,
    blockMeta: {
      slot: blockSlot,
      blockRootHex,
      proposerBalanceDelta,
      parentBlockSlot,
      seenTimestampSec,
    },
  };
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/importBlock.ts#addAttestationPreElectra.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function addAttestationPreElectra(
  this: BeaconEngine,
  // added to have the same signature as addAttestationPostElectra
  _: IBeaconStateView,
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

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/importBlock.ts#addAttestationPostElectra.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function addAttestationPostElectra(
  this: BeaconEngine,
  state: IBeaconStateView,
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
    const decisionRoot = state.getShufflingDecisionRoot(attEpoch);
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
