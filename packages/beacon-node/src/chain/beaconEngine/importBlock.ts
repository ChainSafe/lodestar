// TODO - beacon engine: transport engine-emitted events through the worker boundary.
import {BitArray} from "@chainsafe/ssz";
import {
  AncestorStatus,
  BlockExecutionStatus,
  ExecutionStatus,
  ForkChoiceError,
  ForkChoiceErrorCode,
  NotReorgedReason,
  getFinalizedExecutionBlockHash,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {
  ForkPostAltair,
  ForkPostElectra,
  ForkPostGloas,
  ForkSeq,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  MAX_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  IBeaconStateView,
  RootCache,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getBeaconCommittees,
  isStatePostAltair,
  isStatePostBellatrix,
} from "@lodestar/state-transition";
import {
  Attestation,
  BeaconBlock,
  Epoch,
  IndexedAttestation,
  SignedBeaconBlock,
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
import {computeSignedBlockRoot, toSignedBlockRootHex} from "../blocks/signedBlockRoot.js";
import {AttestationImportOpt, ImportBlockOpts} from "../blocks/types.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {toCheckpointHex} from "../stateCache/persistentCheckpointsCache.js";
import {BeaconEngineCore} from "./beaconEngineCore.js";
import {BeaconEngineEvent, ChainReorg} from "./events.js";
import {ImportBlockResult} from "./interface.js";

export type VerifiedBlockBundle = {
  executionStatus: BlockExecutionStatus;
  postState: IBeaconStateView;
  block: SignedBeaconBlock;
  blockBytes: Uint8Array;
  indexedAttestations: IndexedAttestation[];
  proposerBalanceDelta: number;
  parentBlockSlot: number;
  seenTimestampSec: number;
};

/**
 * Runs inside BeaconEngineCore. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/blocks/importBlock.ts#importBlock.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function importBlock(
  this: BeaconEngineCore,
  // [beacon-engine] deviation: consume the engine-owned verification bundle and facade DA status.
  v: VerifiedBlockBundle,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportBlockOpts
): Promise<ImportBlockResult> {
  const fullyVerifiedBlock = {...v, dataAvailabilityStatus};
  const {block, postState, parentBlockSlot, indexedAttestations} = fullyVerifiedBlock;

  let {executionStatus} = fullyVerifiedBlock;

  const {slot: blockSlot} = block.message;

  const blockRoot = this.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);

  const blockRootHex = toRootHex(blockRoot);

  // Regen must be able to read the block from DB as soon as fork choice exposes it.
  this.metrics?.importBlock.persistBlockWithSerializedDataCount.inc();
  await this.db.block.putBinary(blockRoot, v.blockBytes);
  // Release only the persisted signed candidate; another signature has its own cache lifecycle.
  this.blockSerializedCache.delete(
    toSignedBlockRootHex(computeSignedBlockRoot(this.config.getForkName(blockSlot), block)),
    undefined,
    "persisted"
  );

  const currentSlot = this.forkChoice.getTime();

  const currentEpoch = computeEpochAtSlot(currentSlot);

  const blockEpoch = computeEpochAtSlot(blockSlot);

  const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  const receiveDelaySec =
    fullyVerifiedBlock.seenTimestampSec - computeTimeAtSlot(this.config, blockSlot, postState.genesisTime);

  const fork = this.config.getForkSeq(blockSlot);

  // 2. Import block to fork choice

  // Should compute checkpoint balances before forkchoice.onBlock
  this.checkpointBalancesCache.processState(blockRootHex, postState);

  if (isGloasBeaconBlock(block.message)) {
    // A gloas block has no payload of its own, it inherits the status of the payload it builds on,
    // i.e. the parent variant matching the bid's parent block hash. The parent's default (PENDING)
    // variant does not reflect a SYNCING parent payload, and onBlock would then mark that payload VALID.
    const parentRootHex = toRootHex(block.message.parentRoot);
    const parentBlockHashHex = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash);
    const parentBlock = this.forkChoice.getBlockHexAndBlockHash(parentRootHex, parentBlockHashHex);
    if (parentBlock === null) {
      throw Error(
        `Parent block not found in forkChoice, parentRoot=${parentRootHex} parentBlockHash=${parentBlockHashHex}`
      );
    }
    if (parentBlock.executionStatus === ExecutionStatus.Invalid) {
      throw Error(`Parent block has invalid execution status, parentRoot=${parentRootHex}`);
    }
    executionStatus = parentBlock.executionStatus;
  }

  const importDelaySec = this.clock.secFromSlot(blockSlot);

  const blockSummary = this.forkChoice.onBlock(
    block.message,
    postState,
    receiveDelaySec,
    importDelaySec,
    currentSlot,
    executionStatus,
    dataAvailabilityStatus
  );

  if (isGloasBeaconBlock(block.message)) {
    this.seenPayloadEnvelopeInputCache.add({
      blockRootHex,
      block: block as SignedBeaconBlock<ForkPostGloas>,
      forkName: this.config.getForkName(blockSlot),
    });
  }

  // This adds the state necessary to process the next block
  // Some block event handlers require state being in state cache so need to do this before emitting EventType.block
  this.regen.processState(blockRootHex, postState);

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
  if (importsBlockAttestations(opts, blockEpoch, currentEpoch)) {
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
          postState,
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

  // 4.5. Import payload attestations to fork choice (Gloas)
  //
  if (isGloasBeaconBlock(block.message)) {
    for (const payloadAttestation of block.message.body.payloadAttestations) {
      try {
        // Extract PTC indices from aggregation bits
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

  // 5. Compute head. If new head, immediately stateCache.setHeadState()

  const oldHead = this.forkChoice.getHead();

  const newHead = this.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

  if (fork >= ForkSeq.gloas) {
    const parent = this.forkChoice.getBlockHexDefaultStatus(newHead.parentRoot);
    if (parent) this.seenPayloadEnvelopeInputCache.pruneBelowParent(parent);
  }

  const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    // Set head state as strong reference
    this.regen.updateHeadState(newHead, postState);

    const delaySec = this.clock.secFromSlot(newHead.slot);
    this.logger.verbose("New chain head", {
      slot: newHead.slot,
      root: newHead.blockRoot,
      delaySec,
    });

    // Only track "recent" blocks. Otherwise sync can distort this metrics heavily.
    // We want to track recent blocks coming from gossip, unknown block sync, and API.
    if (
      this.metrics &&
      delaySec < (SLOTS_PER_EPOCH * this.config.getSlotDurationMs(this.config.getForkName(newHead.slot))) / 1000
    ) {
      this.metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
      const cutOffSec = this.config.getAttestationDueMs(this.config.getForkName(blockSlot)) / 1000;
      if (delaySec > cutOffSec) {
        this.metrics.importBlock.setHeadAfterCutoff.inc();
      }
    }

    this.syncContributionAndProofPool.prune(newHead.slot);
    this.seenContributionAndProof.prune(newHead.slot);

    this.metrics?.forkChoice.changedHead.inc();

    const ancestorResult = this.forkChoice.getCommonAncestorDepth(oldHead, newHead);
    if (ancestorResult.code === AncestorStatus.CommonAncestor) {
      // CommonAncestor = chain reorg, old head and new head not direct descendants

      const forkChoiceReorgEventData: ChainReorg = {
        depth: ancestorResult.depth,
        epoch: computeEpochAtSlot(newHead.slot),
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: oldHead.blockRoot,
        newHeadState: newHead.stateRoot,
        oldHeadState: oldHead.stateRoot,
        executionOptimistic: isOptimisticBlock(newHead),
      };

      this.emitter.emit(BeaconEngineEvent.chainReorg, forkChoiceReorgEventData);
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

  // 6. Queue notifyForkchoiceUpdate to engine api
  //
  // NOTE: forkChoice.fsStore.finalizedCheckpoint MUST only change in response to an onBlock event
  // Notifying EL of head and finalized updates as below is usually done within the 1st 4s of the slot.
  // If there is an advanced payload generation in the next slot, we'll notify EL again 4s before next
  // slot via PrepareNextSlotScheduler. There is no harm updating the ELs with same data, it will just ignore it.

  // Suppress fcu call if shouldOverrideFcu is true. This only happens if we have proposer boost reorg enabled
  // and the block is weak and can potentially be reorged out.
  let shouldOverrideFcu = false;

  if (blockSlot >= currentSlot && isStatePostBellatrix(postState) && postState.isExecutionStateType) {
    let notOverrideFcuReason = NotReorgedReason.Unknown;
    const proposalSlot = blockSlot + 1;
    try {
      const proposerIndex = postState.getBeaconProposer(proposalSlot);
      if (this.beaconProposerCache.has(proposerIndex)) {
        // We would set this to true if
        //  1) This is a gossip block
        //  2) We are proposer of next slot
        //  3) Proposer boost reorg related flag is turned on (this is checked inside the function)
        //  4) Block meets the criteria of being re-orged out (this is also checked inside the function)
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
    } catch (e) {
      this.logger.warn("Unable to get beacon proposer. Do not override fcu.", {proposalSlot}, e as Error);
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
    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice, this.logger);
    const finalizedBlockHash = getFinalizedExecutionBlockHash(this.forkChoice);
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

  if (!postState.isStateValidatorsNodesPopulated()) {
    this.logger.verbose("After importBlock caching postState without SSZ cache", {slot: postState.slot});
  }

  // Cache shufflings when crossing an epoch boundary
  const parentEpoch = computeEpochAtSlot(parentBlockSlot);

  if (parentEpoch < blockEpoch) {
    const previousEpoch = blockEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : blockEpoch - 1;
    if (
      !this.shufflingCache.has(previousEpoch, postState.previousDecisionRoot) ||
      !this.shufflingCache.has(blockEpoch, postState.currentDecisionRoot) ||
      !this.shufflingCache.has(blockEpoch + 1, postState.nextDecisionRoot)
    ) {
      this.shufflingCache.processState(postState);
      this.logger.verbose("Processed shuffling for next epoch", {parentEpoch, blockEpoch, slot: blockSlot});
    }
  }

  if (blockSlot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    this.regen.addCheckpointState(cp, checkpointState);
    // consumers should not mutate state ever
    this.emitter.emit(BeaconEngineEvent.checkpoint, cp);

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
    }
  }

  // Register stat metrics about the block after importing it
  this.metrics?.parentBlockDistance.observe(blockSlot - parentBlockSlot);

  this.metrics?.proposerBalanceDeltaAny.observe(fullyVerifiedBlock.proposerBalanceDelta);

  this.validatorMonitor?.registerImportedBlock(block.message, fullyVerifiedBlock);

  if (isStatePostAltair(fullyVerifiedBlock.postState)) {
    this.validatorMonitor?.registerSyncAggregateInBlock(
      blockEpoch,
      (block as altair.SignedBeaconBlock).message.body.syncAggregate,
      fullyVerifiedBlock.postState.currentSyncCommitteeValidatorIndices
    );
  }

  // [beacon-engine] deviation: return plain metadata; events and state remain engine-local.
  return {
    headChanged: newHead.blockRoot !== oldHead.blockRoot,
    head: null,
    blockSummary,
    proposerIndexNextSlot: null,
    isExecutionState: isStatePostBellatrix(postState) && postState.isExecutionStateType,
    prevFinalizedEpoch,
    currFinalizedEpoch,
    oldHeadBlockRoot: oldHead.blockRoot,
    newHeadBlockRoot: newHead.blockRoot,
    newHead,
    blockMeta: {
      slot: blockSlot,
      blockRootHex,
      proposerBalanceDelta: v.proposerBalanceDelta,
      parentBlockSlot,
      seenTimestampSec: v.seenTimestampSec,
    },
  };
}

/**
 * Runs inside BeaconEngineCore. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/blocks/importBlock.ts#addAttestationPreElectra.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function addAttestationPreElectra(
  this: BeaconEngineCore,
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
 * Runs inside BeaconEngineCore. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/blocks/importBlock.ts#addAttestationPostElectra.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function addAttestationPostElectra(
  this: BeaconEngineCore,
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
    const shuffling =
      this.shufflingCache.getSync(attEpoch, state.getShufflingDecisionRoot(attEpoch)) ??
      state.getShufflingAtEpoch(attEpoch);
    const committees = getBeaconCommittees(shuffling, attSlot, committeeIndices);
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

const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;
export function importsBlockAttestations(opts: ImportBlockOpts, blockEpoch: Epoch, currentEpoch: Epoch): boolean {
  return (
    opts.importAttestations === AttestationImportOpt.Force ||
    (opts.importAttestations !== AttestationImportOpt.Skip && blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
  );
}
