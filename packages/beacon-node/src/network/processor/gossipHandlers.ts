import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostElectra,
  ForkPreElectra,
  ForkSeq,
  isForkBlobs,
  isForkPostElectra,
  isForkPostFulu,
} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {
  Root,
  SignedBeaconBlock,
  SingleAttestation,
  Slot,
  SubnetID,
  UintNum64,
  deneb,
  fulu,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {LogLevel, Logger, prettyBytes, toHex, toRootHex} from "@lodestar/utils";
import {BlobSidecarValidation} from "../../chain/blocks/types.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlobSidecarErrorCode,
  BlobSidecarGossipError,
  BlockError,
  BlockErrorCode,
  BlockGossipError,
  DataColumnSidecarErrorCode,
  DataColumnSidecarGossipError,
  GossipAction,
  GossipActionError,
  SyncCommitteeError,
} from "../../chain/errors/index.js";
import {IBeaconChain} from "../../chain/interface.js";
import {validateGossipBlobSidecar} from "../../chain/validation/blobSidecar.js";
import {validateGossipDataColumnSidecar} from "../../chain/validation/dataColumnSidecar.js";
import {
  AggregateAndProofValidationResult,
  AttestationOrBytes,
  AttestationValidationResult,
  GossipAttestation,
  toElectraSingleAttestation,
  validateGossipAggregateAndProof,
  validateGossipAttestationsSameAttData,
  validateGossipAttesterSlashing,
  validateGossipBlock,
  validateGossipBlsToExecutionChange,
  validateGossipProposerSlashing,
  validateGossipSyncCommittee,
  validateGossipVoluntaryExit,
  validateSyncCommitteeGossipContributionAndProof,
} from "../../chain/validation/index.js";
import {validateLightClientFinalityUpdate} from "../../chain/validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../chain/validation/lightClientOptimisticUpdate.js";
import {Metrics} from "../../metrics/index.js";
import {OpSource} from "../../metrics/validatorMonitor.js";
import {INetworkCore} from "../core/index.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {
  BatchGossipHandlers,
  GossipHandlerParamGeneric,
  GossipHandlers,
  GossipType,
  SequentialGossipHandlers,
} from "../gossip/interface.js";
import {sszDeserialize} from "../gossip/topic.js";
import {INetwork} from "../interface.js";
import {PeerAction} from "../peers/index.js";
import {AggregatorTracker} from "./aggregatorTracker.js";
import {
  BlockInputBlobs,
  BlockInputColumns,
  BlockInput,
  BlockInputSourceType,
} from "../../chain/blocks/utils/blockInput.js";

/**
 * Gossip handler options as part of network options
 */
export type GossipHandlerOpts = {
  /** By default pass gossip attestations to forkchoice */
  dontSendGossipAttestationsToForkchoice?: boolean;
};

export type ValidatorFnsModules = {
  chain: IBeaconChain;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  events: NetworkEventBus;
  aggregatorTracker: AggregatorTracker;
  core: INetworkCore;
};

const MAX_UNKNOWN_BLOCK_ROOT_RETRIES = 1;
const BLOCK_AVAILABILITY_CUTOFF_MS = 3_000;

/**
 * Gossip handlers perform validation + handling in a single function.
 * - This gossip handlers MUST only be registered as validator functions. No handler is registered for any topic.
 * - All `chain/validation/*` functions MUST throw typed GossipActionError instances so they gossip action is captured
 *   by `getGossipValidatorFn()` try catch block.
 * - This gossip handlers should not let any handling errors propagate to the caller. Only validation errors must be thrown.
 *
 * Note: `libp2p/js-libp2p-interfaces` would normally indicate to register separate validator functions and handler functions.
 * This approach is not suitable for us because:
 * - We do expensive processing on the object in the validator function that we need to re-use in the handler function.
 * - The validator function produces extra data that is needed for the handler function. Making this data available in
 *   the handler function scope is hard to achieve without very hacky strategies
 * - Ethereum Consensus gossipsub protocol strictly defined a single topic for message
 */
export function getGossipHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): GossipHandlers {
  return {...getSequentialHandlers(modules, options), ...getBatchHandlers(modules, options)};
}

/**
 * Default handlers validate gossip messages one by one.
 * We only have a choice to do batch validation for beacon_attestation topic.
 */
function getSequentialHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): SequentialGossipHandlers {
  const {chain, config, metrics, events, logger, core} = modules;

  function slotOffsetTimeToUnixTime(slot: Slot, timeIntoSlotInMs: number): number {
    return Math.max(computeTimeAtSlot(config, slot, chain.genesisTime) * 1000 + timeIntoSlotInMs - Date.now(), 0);
  }

  async function validateBeaconBlock(
    signedBlock: SignedBeaconBlock,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput> {
    const blockInput = chain.blockInputCache.getBlockInputByBlock({
      block: signedBlock,
      source: BlockInputSourceType.gossip,
      peerIdStr,
      seenTimestampSec: Date.now(),
    });
    const slot = blockInput.getSlot();
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    const logCtx = {
      currentSlot: chain.clock.currentSlot,
      delaySec,
      recvToValLatency,
      ...blockInput.getLogMeta(),
      peerId: peerIdStr,
    };

    logger.debug("Received gossip block", logCtx);

    try {
      await validateGossipBlock(config, chain, blockInput, signedBlock);

      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      metrics?.gossipBlock.gossipValidation.recvToValidation.observe(recvToValidation);

      const validationTime = recvToValidation - recvToValLatency;
      metrics?.gossipBlock.gossipValidation.validationTime.observe(validationTime);

      chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockInput.rootHex});
      logger.debug("Validated gossip block", {...logCtx, recvToValidation, validationTime});

      return blockInput;
    } catch (e) {
      let removeCachedBlock = true;
      if (e instanceof BlockGossipError) {
        // Don't trigger this yet if full block and blobs haven't arrived yet
        if (e.type.code === BlockErrorCode.PARENT_UNKNOWN && blockInput !== null) {
          removeCachedBlock = false;
          logger.debug("Gossip block has error", {slot, root: blockInput.prettyRootHex, code: e.type.code});
          events.emit(NetworkEvent.unknownParent, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
        }

        if (e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(
            config.getForkTypes(slot).SignedBeaconBlock,
            signedBlock,
            `gossip_reject_slot_${slot}`
          );
        }
      }

      if (removeCachedBlock) {
        chain.blockInputCache.removeBlockFromBlockInput(blockInput.rootHex);
      }

      throw e;
    }
  }

  function handleValidBeaconBlock(blockInput: BlockInput, peerIdStr: string, seenTimestampSec: number): void {
    //
    // Handler - MUST NOT `await`, to allow validation result to be propagated
    //
    const {block} = blockInput.getBlock();
    metrics?.registerBeaconBlock(OpSource.gossip, seenTimestampSec, block.message);

    if (blockInput.needData()) {
      // Wait for data to arrive over gossip before attempting to ReqResp the rest of the BlockInput.  This will also get
      // triggered by all other gossip objects and deduplication of the request will get handled by BlockInputSync
      const waitTime = slotOffsetTimeToUnixTime(blockInput.getSlot(), BLOCK_AVAILABILITY_CUTOFF_MS);
      chain.logger.debug(
        `Sending gossip block for processing without full data. Waiting ${(waitTime / 1000).toFixed(2)} seconds before starting ReqResp`,
        blockInput.getLogMeta()
      );
      blockInput
        .waitForData(waitTime)
        .then(() => {})
        .catch(() => {
          events.emit(NetworkEvent.blockInput, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
        });
    }

    // Send block for processing. The blockInput.waitForBlockAndData() will get called in the verify process and will
    // wait for a period of time before rejecting block as DATA_UNAVAILABLE.  Can do a lot of the processing immediately
    // while waiting for the data to show up though.
    chain
      .processBlock(blockInput, {
        // block may be downloaded and processed by UnknownBlockSync
        ignoreIfKnown: true,
        // proposer signature already checked in validateBeaconBlock()
        validProposerSignature: true,
        // blobSidecars already checked in validateGossipBlobSidecars()
        validBlobSidecars: BlobSidecarValidation.Individual,
        // It's critical to keep a good number of mesh peers.
        // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
        // Gossip Job Wait Time depends on the BLS Job Wait Time
        // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
        // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
        // See https://github.com/ChainSafe/lodestar/issues/3792
        blsVerifyOnMainThread: true,
        // to track block process steps
        seenTimestampSec,
        // gossip block is validated, we want to process it asap
        eagerPersistBlock: true,
      })
      .then(() => {
        // Returns the delay between the start of `block.slot` and `current time`
        const delaySec = chain.clock.secFromSlot(block.message.slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
        chain.blockInputCache.prune(blockInput);
      })
      .catch((e) => {
        // Adjust verbosity based on error type
        let logLevel: LogLevel;
        let removeCachedBlock = true;

        if (e instanceof BlockError) {
          switch (e.type.code) {
            case BlockErrorCode.DATA_UNAVAILABLE: {
              // Error is quite frequent and not critical
              logLevel = LogLevel.debug;
              removeCachedBlock = false;
              events.emit(NetworkEvent.blockInput, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
              break;
            }
            // ALREADY_KNOWN should not happen with ignoreIfKnown=true above
            // PARENT_UNKNOWN should not happen, we handled this in validateBeaconBlock() function above
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              // TODO: (@matthwekeil) should the block be pruned here?
              // Errors might indicate an issue with our node or the connected EL client
              logLevel = LogLevel.error;
              break;
            default:
              core.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadGossipBlock");
              // Misbehaving peer, but could highlight an issue in another client
              logLevel = LogLevel.warn;
          }
        } else {
          // TODO: (@matthwekeil) should the block be pruned here?
          // Any unexpected error
          logLevel = LogLevel.error;
        }

        if (removeCachedBlock) {
          chain.blockInputCache.removeBlockFromBlockInput(blockInput.rootHex);
        }
        metrics?.gossipBlock.processBlockErrors.inc({error: e instanceof BlockError ? e.type.code : "NOT_BLOCK_ERROR"});
        logger[logLevel]("Error receiving block", {slot: block.message.slot, peer: peerIdStr}, e as Error);
      });
  }

  async function validateBeaconBlob(
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInputBlobs> {
    const slot = blobSidecar.signedBlockHeader.message.slot;
    const forkName = config.getForkName(slot);
    if (!isForkBlobs(forkName)) {
      throw new GossipActionError(GossipAction.REJECT, {code: "BLOB_RECEIVED_ON_NON_BLOB_FORK"});
    }

    let blockInput!: BlockInputBlobs;
    try {
      blockInput = chain.blockInputCache.getBlockInputByBlob({
        blobSidecar,
        source: BlockInputSourceType.gossip,
        peerIdStr,
        seenTimestampSec: Date.now(),
      });
      await validateGossipBlobSidecar(forkName, chain, blockInput, blobSidecar, subnet);

      const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
      const recvToValLatency = Date.now() / 1000 - seenTimestampSec;
      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      logger.debug("Received gossip blob", {
        slotReceived: chain.clock.currentSlot,
        blobIndex: subnet,
        ...blockInput.getLogMeta(),
        peerId: peerIdStr,
        delaySec,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return blockInput;
    } catch (e) {
      if (blockInput) {
        let removeCachedBlob = true;
        if (e instanceof BlobSidecarGossipError) {
          if (e.type.code === BlobSidecarErrorCode.PARENT_UNKNOWN) {
            removeCachedBlob = false;
            logger.debug("Gossip blob has error", {...blockInput.getLogMeta(), code: e.type.code});
            // Don't trigger this yet if full block and blobs haven't arrived yet
            if (!blockInput.hasBlock()) {
              events.emit(NetworkEvent.unknownParent, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
            }
          }

          if (e.action === GossipAction.REJECT) {
            chain.persistInvalidSszValue(
              ssz.deneb.BlobSidecar,
              blobSidecar,
              `gossip_reject_slot_${slot}_index_${blobSidecar.index}`
            );
          }
        }

        if (removeCachedBlob) {
          chain.blockInputCache.removeBlobsFromBlockInput(blockInput.rootHex, [blobSidecar.index]);
        }
      }

      throw e;
    }
  }

  async function validateBeaconDataColumn(
    columnSidecar: fulu.DataColumnSidecar,
    columnIndex: number,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput> {
    const slot = columnSidecar.signedBlockHeader.message.slot;
    const forkName = config.getForkName(slot);
    if (!isForkPostFulu(forkName)) {
      throw new GossipActionError(GossipAction.REJECT, {code: "COLUMN_RECEIVED_ON_NO_COLUMN_FORK"});
    }

    let blockInput: undefined | BlockInputColumns;
    try {
      blockInput = chain.blockInputCache.getBlockInputByColumn({
        columnSidecar,
        source: BlockInputSourceType.gossip,
        peerIdStr,
        seenTimestampSec: Date.now(),
      });
      await validateGossipDataColumnSidecar(chain, blockInput, columnSidecar, columnIndex);

      const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
      const recvToValLatency = Date.now() / 1000 - seenTimestampSec;
      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      logger.debug("Received gossip dataColumn", {
        slotReceived: chain.clock.currentSlot,
        columnIndex: columnSidecar.index,
        ...blockInput.getLogMeta(),
        peerId: peerIdStr,
        delaySec,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return blockInput;
    } catch (e) {
      if (blockInput) {
        let removeCachedColumn = true;
        if (e instanceof DataColumnSidecarGossipError) {
          if (e.type.code === DataColumnSidecarErrorCode.PARENT_UNKNOWN) {
            removeCachedColumn = false;
            logger.debug("Gossip dataColumn has error", {...blockInput.getLogMeta(), code: e.type.code});
            // Don't trigger this yet if full block and blobs haven't arrived yet
            if (!blockInput.hasBlock()) {
              events.emit(NetworkEvent.unknownParent, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
            }
          }

          if (e.action === GossipAction.REJECT) {
            chain.persistInvalidSszValue(
              ssz.fulu.DataColumnSidecar,
              columnSidecar,
              `gossip_reject_slot_${slot}_index_${columnSidecar.index}`
            );
          }
        }

        if (removeCachedColumn) {
          chain.blockInputCache.removeColumnsFromBlockInput(blockInput.rootHex, [columnSidecar.index]);
        }
      }

      throw e;
    }
  }

  return {
    [GossipType.beacon_block]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.beacon_block>) => {
      const {serializedData} = gossipData;
      const signedBlock = sszDeserialize(topic, serializedData);
      const blockInput = await validateBeaconBlock(signedBlock, peerIdStr, seenTimestampSec);
      chain.serializedCache.set(signedBlock, serializedData);
      handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
    },

    [GossipType.blob_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.blob_sidecar>) => {
      const {serializedData} = gossipData;
      const blobSidecar = sszDeserialize(topic, serializedData);
      const blockInput = await validateBeaconBlob(blobSidecar, topic.subnet, peerIdStr, seenTimestampSec);

      if (blockInput.isComplete()) {
        return;
      }

      const waitTime = slotOffsetTimeToUnixTime(blockInput.getSlot(), BLOCK_AVAILABILITY_CUTOFF_MS);
      chain.logger.debug(
        `Gossip blob received but BlockInput still incomplete. Waiting ${(waitTime / 1000).toFixed(2)} seconds before starting ReqResp`,
        blockInput.getLogMeta()
      );
      await blockInput.waitForBlockAndData(waitTime);

      if (!blockInput.isComplete()) {
        chain.logger.debug("BlockInput not complete by BLOCK_AVAILABILITY_CUTOFF_MS", blockInput.getLogMeta());
        events.emit(NetworkEvent.blockInput, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
      }
    },

    [GossipType.data_column_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.data_column_sidecar>) => {
      const {serializedData} = gossipData;
      const dataColumnSidecar = sszDeserialize(topic, serializedData);
      const blockInput = await validateBeaconDataColumn(dataColumnSidecar, topic.index, peerIdStr, seenTimestampSec);

      if (blockInput.isComplete()) {
        return;
      }

      const waitTime = slotOffsetTimeToUnixTime(blockInput.getSlot(), BLOCK_AVAILABILITY_CUTOFF_MS);
      chain.logger.debug(
        `Gossip column received but BlockInput still incomplete. Waiting ${(waitTime / 1000).toFixed(2)} seconds before starting ReqResp`,
        blockInput.getLogMeta()
      );

      if (!blockInput.isComplete()) {
        chain.logger.debug("BlockInput not complete by BLOCK_AVAILABILITY_CUTOFF_MS", blockInput.getLogMeta());
        events.emit(NetworkEvent.blockInput, {blockInput, source: BlockInputSourceType.gossip, peerIdStr});
      }
    },

    [GossipType.beacon_aggregate_and_proof]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.beacon_aggregate_and_proof>) => {
      const {serializedData} = gossipData;
      let validationResult: AggregateAndProofValidationResult;
      const signedAggregateAndProof = sszDeserialize(topic, serializedData);
      const {fork} = topic;

      try {
        validationResult = await validateGossipAggregateAndProof(fork, chain, signedAggregateAndProof, serializedData);
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(
            sszTypesFor(fork).SignedAggregateAndProof,
            signedAggregateAndProof,
            "gossip_reject"
          );
        }
        throw e;
      }

      // Handler
      const {indexedAttestation, committeeIndices, attDataRootHex} = validationResult;
      metrics?.registerGossipAggregatedAttestation(seenTimestampSec, signedAggregateAndProof, indexedAttestation);
      const aggregatedAttestation = signedAggregateAndProof.message.aggregate;

      chain.aggregatedAttestationPool.add(
        aggregatedAttestation,
        attDataRootHex,
        indexedAttestation.attestingIndices.length,
        committeeIndices
      );

      if (!options.dontSendGossipAttestationsToForkchoice) {
        try {
          chain.forkChoice.onAttestation(indexedAttestation, attDataRootHex);
        } catch (e) {
          logger.debug(
            "Error adding gossip aggregated attestation to forkchoice",
            {slot: aggregatedAttestation.data.slot},
            e as Error
          );
        }
      }

      chain.emitter.emit(routes.events.EventType.attestation, signedAggregateAndProof.message.aggregate);
    },

    [GossipType.attester_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.attester_slashing>) => {
      const {serializedData} = gossipData;
      const {fork} = topic;
      const attesterSlashing = sszDeserialize(topic, serializedData);
      await validateGossipAttesterSlashing(chain, attesterSlashing);

      // Handler

      try {
        chain.opPool.insertAttesterSlashing(fork, attesterSlashing);
        chain.forkChoice.onAttesterSlashing(attesterSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }

      chain.emitter.emit(routes.events.EventType.attesterSlashing, attesterSlashing);
    },

    [GossipType.proposer_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.proposer_slashing>) => {
      const {serializedData} = gossipData;
      const proposerSlashing = sszDeserialize(topic, serializedData);
      await validateGossipProposerSlashing(chain, proposerSlashing);

      // Handler

      try {
        chain.opPool.insertProposerSlashing(proposerSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }

      chain.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
    },

    [GossipType.voluntary_exit]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
      const {serializedData} = gossipData;
      const voluntaryExit = sszDeserialize(topic, serializedData);
      await validateGossipVoluntaryExit(chain, voluntaryExit);

      // Handler

      try {
        chain.opPool.insertVoluntaryExit(voluntaryExit);
      } catch (e) {
        logger.error("Error adding voluntaryExit to pool", {}, e as Error);
      }

      chain.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
    },

    [GossipType.sync_committee_contribution_and_proof]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.sync_committee_contribution_and_proof>) => {
      const {serializedData} = gossipData;
      const contributionAndProof = sszDeserialize(topic, serializedData);
      const {syncCommitteeParticipantIndices} = await validateSyncCommitteeGossipContributionAndProof(
        chain,
        contributionAndProof
      ).catch((e) => {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "gossip_reject");
        }
        throw e;
      });

      // Handler
      metrics?.registerGossipSyncContributionAndProof(contributionAndProof.message, syncCommitteeParticipantIndices);

      try {
        chain.syncContributionAndProofPool.add(contributionAndProof.message, syncCommitteeParticipantIndices.length);
      } catch (e) {
        logger.error("Error adding to contributionAndProof pool", {}, e as Error);
      }

      chain.emitter.emit(routes.events.EventType.contributionAndProof, contributionAndProof);
    },

    [GossipType.sync_committee]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.sync_committee>) => {
      const {serializedData} = gossipData;
      const syncCommittee = sszDeserialize(topic, serializedData);
      const {subnet} = topic;
      let indexInSubcommittee = 0;
      try {
        indexInSubcommittee = (await validateGossipSyncCommittee(chain, syncCommittee, subnet)).indexInSubcommittee;
      } catch (e) {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, syncCommittee, "gossip_reject");
        }
        throw e;
      }

      // Handler

      try {
        const insertOutcome = chain.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee);
        metrics?.opPool.syncCommitteeMessagePoolInsertOutcome.inc({insertOutcome});
      } catch (e) {
        logger.debug("Error adding to syncCommittee pool", {subnet}, e as Error);
      }
    },

    [GossipType.light_client_finality_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_finality_update>) => {
      const {serializedData} = gossipData;
      const lightClientFinalityUpdate = sszDeserialize(topic, serializedData);
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    },

    [GossipType.light_client_optimistic_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_optimistic_update>) => {
      const {serializedData} = gossipData;
      const lightClientOptimisticUpdate = sszDeserialize(topic, serializedData);
      validateLightClientOptimisticUpdate(config, chain, lightClientOptimisticUpdate);
    },

    // blsToExecutionChange is to be generated and validated against GENESIS_FORK_VERSION
    [GossipType.bls_to_execution_change]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.bls_to_execution_change>) => {
      const {serializedData} = gossipData;
      const blsToExecutionChange = sszDeserialize(topic, serializedData);
      await validateGossipBlsToExecutionChange(chain, blsToExecutionChange);

      // Handler
      try {
        chain.opPool.insertBlsToExecutionChange(blsToExecutionChange);
      } catch (e) {
        logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
      }

      chain.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
    },
  };
}

/**
 * For now, only beacon_attestation topic is batched.
 */
function getBatchHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): BatchGossipHandlers {
  const {chain, metrics, logger, aggregatorTracker} = modules;
  return {
    [GossipType.beacon_attestation]: async (
      gossipHandlerParams: GossipHandlerParamGeneric<GossipType.beacon_attestation>[]
    ): Promise<(null | AttestationError)[]> => {
      const results: (null | AttestationError)[] = [];
      const attestationCount = gossipHandlerParams.length;
      if (attestationCount === 0) {
        return results;
      }
      // all attestations should have same attestation data as filtered by network processor
      const {subnet, fork} = gossipHandlerParams[0].topic;
      const validationParams = gossipHandlerParams.map((param) => ({
        attestation: null,
        serializedData: param.gossipData.serializedData,
        attSlot: param.gossipData.msgSlot,
        attDataBase64: param.gossipData.indexed,
      })) as GossipAttestation[];
      const {results: validationResults, batchableBls} = await validateGossipAttestationsSameAttData(
        fork,
        chain,
        validationParams,
        subnet
      );
      for (const [i, validationResult] of validationResults.entries()) {
        if (validationResult.err) {
          results.push(validationResult.err as AttestationError);
          continue;
        }
        // null means no error
        results.push(null);

        // Handler
        const {
          indexedAttestation,
          attDataRootHex,
          attestation,
          committeeIndex,
          committeeValidatorIndex,
          committeeSize,
        } = validationResult.result;
        metrics?.registerGossipUnaggregatedAttestation(gossipHandlerParams[i].seenTimestampSec, indexedAttestation);

        try {
          // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
          // but don't add to attestation pool, to save CPU and RAM
          if (aggregatorTracker.shouldAggregate(subnet, indexedAttestation.data.slot)) {
            const insertOutcome = chain.attestationPool.add(
              committeeIndex,
              attestation,
              attDataRootHex,
              committeeValidatorIndex,
              committeeSize
            );
            metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
          }
        } catch (e) {
          logger.error("Error adding unaggregated attestation to pool", {subnet}, e as Error);
        }

        if (!options.dontSendGossipAttestationsToForkchoice) {
          try {
            chain.forkChoice.onAttestation(indexedAttestation, attDataRootHex);
          } catch (e) {
            logger.debug("Error adding gossip unaggregated attestation to forkchoice", {subnet}, e as Error);
          }
        }

        if (isForkPostElectra(fork)) {
          chain.emitter.emit(
            routes.events.EventType.singleAttestation,
            attestation as SingleAttestation<ForkPostElectra>
          );
        } else {
          chain.emitter.emit(routes.events.EventType.attestation, attestation as SingleAttestation<ForkPreElectra>);
          chain.emitter.emit(
            routes.events.EventType.singleAttestation,
            toElectraSingleAttestation(
              attestation as SingleAttestation<ForkPreElectra>,
              indexedAttestation.attestingIndices[0]
            )
          );
        }
      }

      if (batchableBls) {
        metrics?.gossipAttestation.attestationBatchHistogram.observe(attestationCount);
      } else {
        metrics?.gossipAttestation.attestationNonBatchCount.inc(attestationCount);
      }

      return results;
    },
  };
}

/**
 * Retry a function if it throws error code UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
 */
export async function validateGossipFnRetryUnknownRoot<T>(
  fn: () => Promise<T>,
  network: INetwork,
  chain: IBeaconChain,
  slot: Slot,
  blockRoot: Root,
  source: BlockInputSourceType
): Promise<T> {
  let unknownBlockRootRetries = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof AttestationError &&
        e.type.code === AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
      ) {
        if (unknownBlockRootRetries === 0) {
          // Trigger unknown block root search here
          const rootHex = toRootHex(blockRoot);
          network.searchUnknownSlotRoot(slot, rootHex, source);
        }

        if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
          const foundBlock = await chain.waitForBlock(slot, toRootHex(blockRoot));
          // Returns true if the block was found on time. In that case, try to get it from the fork-choice again.
          // Otherwise, throw the error below.
          if (foundBlock) {
            continue;
          }
        }
      }

      throw e;
    }
  }
}
