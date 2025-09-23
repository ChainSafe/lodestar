import {routes} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostElectra,
  ForkPreElectra,
  ForkSeq,
  NUMBER_OF_COLUMNS,
  isForkPostElectra,
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
import {
  BlockInput,
  BlockInputColumns,
  BlockInputSource,
  IBlockInput,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {BlobSidecarValidation} from "../../chain/blocks/types.js";
import {ChainEvent} from "../../chain/emitter.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlobSidecarErrorCode,
  BlobSidecarGossipError,
  BlockError,
  BlockErrorCode,
  BlockGossipError,
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
import {OpSource} from "../../chain/validatorMonitor.js";
import {Metrics} from "../../metrics/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {INetworkCore} from "../core/index.js";
import {NetworkEventBus} from "../events.js";
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
  const {chain, config, metrics, logger, core} = modules;

  async function validateBeaconBlock(
    signedBlock: SignedBeaconBlock,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<IBlockInput> {
    const slot = signedBlock.message.slot;
    const forkTypes = config.getForkTypes(slot);
    const blockRootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    const blockShortHex = prettyBytes(blockRootHex);
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    // always set block to seen cache for all forks so that we don't need to download it
    // TODO: validate block before adding to cache
    // tracked in https://github.com/ChainSafe/lodestar/issues/7957

    const logCtx = {
      currentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      recvToValLatency,
    };

    logger.debug("Received gossip block", {...logCtx});

    let blockInput: IBlockInput | undefined;
    try {
      await validateGossipBlock(config, chain, signedBlock, fork);
      blockInput = chain.seenBlockInputCache.getByBlock({
        block: signedBlock,
        blockRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec,
        peerIdStr,
      });
      const blockInputMeta = blockInput.getLogMeta();

      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlock.gossipValidation.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlock.gossipValidation.validationTime.observe(validationTime);

      logger.debug("Validated gossip block", {...blockInputMeta, ...logCtx, recvToValidation, validationTime});

      chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockRootHex});

      return blockInput;
    } catch (e) {
      if (e instanceof BlockGossipError) {
        if (e.type.code === BlockErrorCode.PARENT_UNKNOWN && blockInput) {
          logger.debug("Gossip block has error", {slot, root: blockShortHex, code: e.type.code});
          chain.emitter.emit(ChainEvent.unknownParent, {
            blockInput,
            peer: peerIdStr,
            source: BlockInputSource.gossip,
          });
          // throw error (don't prune the blockInput)
          throw e;
        }

        if (e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
        }
      }

      chain.seenBlockInputCache.prune(blockRootHex);
      throw e;
    }
  }

  async function validateBeaconBlob(
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput> {
    const blobBlockHeader = blobSidecar.signedBlockHeader.message;
    const slot = blobBlockHeader.slot;
    const fork = config.getForkName(slot);
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobBlockHeader));
    const blockShortHex = prettyBytes(blockRootHex);

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      await validateGossipBlobSidecar(fork, chain, blobSidecar, subnet);
      const blockInput = chain.seenBlockInputCache.getByBlob({
        blockRootHex,
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec,
        peerIdStr,
      });
      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      if (chain.emitter.listenerCount(routes.events.EventType.blobSidecar)) {
        let versionedHash: Uint8Array;
        if (blockInput.hasBlock()) {
          // if block hasn't arrived yet then this will throw and need to calculate the versionedHash as a 1-off
          versionedHash = blockInput.getVersionedHashes()[blobSidecar.index];
        } else {
          versionedHash = kzgCommitmentToVersionedHash(blobSidecar.kzgCommitment);
        }
        chain.emitter.emit(routes.events.EventType.blobSidecar, {
          blockRoot: blockRootHex,
          slot,
          index: blobSidecar.index,
          kzgCommitment: toHex(blobSidecar.kzgCommitment),
          versionedHash: toHex(versionedHash),
        });
      }

      logger.debug("Received gossip blob", {
        ...blockInput.getLogMeta(),
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        delaySec,
        subnet,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return blockInput;
    } catch (e) {
      if (e instanceof BlobSidecarGossipError) {
        // Don't trigger this yet if full block and blobs haven't arrived yet
        if (e.type.code === BlobSidecarErrorCode.PARENT_UNKNOWN) {
          logger.debug("Gossip blob has error", {slot, root: blockShortHex, code: e.type.code});
          // no need to trigger `unknownBlockParent` event here, as we already did it in `validateBeaconBlock()`
          //
          // TODO(fulu): is this note above correct? Could have random blob that we see that could trigger
          //        unknownBlockSync.  And duplicate addition of a block will be deduplicated by the
          //        BlockInputSync event handler. Check this!!
          // events.emit(NetworkEvent.unknownBlockParent, {blockInput, peer: peerIdStr});
        }

        if (e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(
            ssz.deneb.BlobSidecar,
            blobSidecar,
            `gossip_reject_slot_${slot}_index_${blobSidecar.index}`
          );
        }
      }

      throw e;
    }
  }

  async function validateBeaconDataColumn(
    dataColumnSidecar: fulu.DataColumnSidecar,
    _dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInputColumns> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const dataColumnBlockHeader = dataColumnSidecar.signedBlockHeader.message;
    const slot = dataColumnBlockHeader.slot;
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnBlockHeader));

    // first check if we should even process this column (we may have already processed it via getBlobsV2)
    {
      const blockInput = chain.seenBlockInputCache.get(blockRootHex);
      if (blockInput && isBlockInputColumns(blockInput) && blockInput.hasColumn(dataColumnSidecar.index)) {
        metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
        logger.debug("Already have column sidecar, skipping processing", {
          ...blockInput.getLogMeta(),
          index: dataColumnSidecar.index,
        });
        return blockInput;
      }
    }

    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      await validateGossipDataColumnSidecar(chain, dataColumnSidecar, gossipSubnet, metrics);
      const blockInput = chain.seenBlockInputCache.getByColumn({
        blockRootHex,
        columnSidecar: dataColumnSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec,
        peerIdStr,
      });

      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.peerDas.dataColumnSidecarProcessingSuccesses.inc();
      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      if (chain.emitter.listenerCount(routes.events.EventType.dataColumnSidecar)) {
        chain.emitter.emit(routes.events.EventType.dataColumnSidecar, {
          blockRoot: blockRootHex,
          slot,
          index: dataColumnSidecar.index,
          kzgCommitments: dataColumnSidecar.kzgCommitments.map(toHex),
        });
      }

      logger.debug("Received gossip dataColumn", {
        ...blockInput.getLogMeta(),
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        delaySec,
        gossipSubnet,
        columnIndex: dataColumnSidecar.index,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return blockInput;
    } catch (e) {
      if (e instanceof DataColumnSidecarGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(
          ssz.fulu.DataColumnSidecar,
          dataColumnSidecar,
          `gossip_reject_slot_${slot}_index_${dataColumnSidecar.index}`
        );
        // no need to trigger `unknownBlockParent` event here, as we already did it in `validateBeaconBlock()`
        //
        // TODO(fulu): is this note above correct? Could have random column that we see that could trigger
        //        unknownBlockSync.  And duplicate addition of a block will be deduplicated by the
        //        BlockInputSync event handler. Check this!!
        // events.emit(NetworkEvent.unknownBlockParent, {blockInput, peer: peerIdStr});
      }

      throw e;
    } finally {
      verificationTimer?.();
    }
  }

  function handleValidBeaconBlock(blockInput: IBlockInput, peerIdStr: string, seenTimestampSec: number): void {
    const signedBlock = blockInput.getBlock();
    const slot = signedBlock.message.slot;

    // Handler - MUST NOT `await`, to allow validation result to be propagated

    const delaySec = seenTimestampSec - (chain.genesisTime + slot * config.SECONDS_PER_SLOT);
    metrics?.gossipBlock.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);
    chain.validatorMonitor?.registerBeaconBlock(OpSource.gossip, delaySec, signedBlock.message);
    if (!blockInput.hasBlockAndAllData()) {
      chain.logger.debug("Received gossip block, attempting fetch of unavailable data", blockInput.getLogMeta());
      // The data is not yet fully available, immediately trigger an aggressive pull via unknown block sync
      chain.emitter.emit(ChainEvent.incompleteBlockInput, {
        blockInput,
        peer: peerIdStr,
        source: BlockInputSource.gossip,
      });
      // immediately attempt fetch of data columns from execution engine
      chain.getBlobsTracker.triggerGetBlobs(blockInput);
    } else {
      metrics?.blockInputFetchStats.totalDataAvailableBlockInputs.inc();
      metrics?.blockInputFetchStats.totalDataAvailableBlockInputBlobs.inc(
        (signedBlock.message as deneb.BeaconBlock).body.blobKzgCommitments.length
      );
    }

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
        const delaySec = chain.clock.secFromSlot(slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
        chain.seenBlockInputCache.prune(blockInput.blockRootHex);
      })
      .catch((e) => {
        // Adjust verbosity based on error type
        let logLevel: LogLevel;

        if (e instanceof BlockError) {
          switch (e.type.code) {
            case BlockErrorCode.DATA_UNAVAILABLE: {
              // Error is quite frequent and not critical
              logLevel = LogLevel.debug;
              break;
            }
            // ALREADY_KNOWN should not happen with ignoreIfKnown=true above
            // PARENT_UNKNOWN should not happen, we handled this in validateBeaconBlock() function above
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              // Errors might indicate an issue with our node or the connected EL client
              logLevel = LogLevel.error;
              break;
            default:
              // TODO: Should it use PeerId or string?
              core.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadGossipBlock");
              // Misbehaving peer, but could highlight an issue in another client
              logLevel = LogLevel.warn;
          }
        } else {
          // Any unexpected error
          logLevel = LogLevel.error;
        }
        metrics?.gossipBlock.processBlockErrors.inc({error: e instanceof BlockError ? e.type.code : "NOT_BLOCK_ERROR"});
        logger[logLevel](
          "Error processing block",
          {slot, peer: peerIdStr, blockRoot: prettyBytes(blockInput.blockRootHex)},
          e as Error
        );
        // TODO(fulu): Revisit when we prune block inputs
        chain.seenBlockInputCache.prune(blockInput.blockRootHex);
      });
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
      const blockInput = await validateBeaconBlock(signedBlock, topic.boundary.fork, peerIdStr, seenTimestampSec);
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
      const blobSlot = blobSidecar.signedBlockHeader.message.slot;
      const index = blobSidecar.index;

      if (config.getForkSeq(blobSlot) < ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "PRE_DENEB_BLOCK"});
      }
      const blockInput = await validateBeaconBlob(blobSidecar, topic.subnet, peerIdStr, seenTimestampSec);
      if (!blockInput.hasBlockAndAllData()) {
        const cutoffTimeMs = getCutoffTimeMs(chain, blobSlot, BLOCK_AVAILABILITY_CUTOFF_MS);
        chain.logger.debug("Received gossip blob, waiting for full data availability", {
          msToWait: cutoffTimeMs,
          blobIndex: index,
          ...blockInput.getLogMeta(),
        });
        blockInput.waitForAllData(cutoffTimeMs).catch((_e) => {
          chain.logger.debug(
            "Waited for data after receiving gossip blob. Cut-off reached so attempting to fetch remainder of BlockInput",
            {
              blobIndex: index,
              ...blockInput.getLogMeta(),
            }
          );
          chain.emitter.emit(ChainEvent.incompleteBlockInput, {
            blockInput,
            peer: peerIdStr,
            source: BlockInputSource.gossip,
          });
        });
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
      const dataColumnSlot = dataColumnSidecar.signedBlockHeader.message.slot;
      const index = dataColumnSidecar.index;

      if (config.getForkSeq(dataColumnSlot) < ForkSeq.fulu) {
        throw new GossipActionError(GossipAction.REJECT, {code: "PRE_FULU_BLOCK"});
      }
      const delaySec = chain.clock.secFromSlot(dataColumnSlot, seenTimestampSec);
      const blockInput = await validateBeaconDataColumn(
        dataColumnSidecar,
        serializedData,
        topic.subnet,
        peerIdStr,
        seenTimestampSec
      );
      const blockInputMeta = blockInput.getLogMeta();
      const {receivedColumns} = blockInputMeta;
      // it's not helpful to track every single column received
      // instead of that, track 1st, 8th, 16th 32th, 64th, and 128th column
      switch (receivedColumns) {
        case 1:
        case config.SAMPLES_PER_SLOT:
        case 2 * config.SAMPLES_PER_SLOT:
        case NUMBER_OF_COLUMNS / 4:
        case NUMBER_OF_COLUMNS / 2:
        case NUMBER_OF_COLUMNS:
          metrics?.dataColumns.elapsedTimeTillReceived.observe({receivedOrder: receivedColumns}, delaySec);
          break;
      }
      if (!blockInput.hasBlockAndAllData()) {
        const cutoffTimeMs = getCutoffTimeMs(chain, dataColumnSlot, BLOCK_AVAILABILITY_CUTOFF_MS);
        chain.logger.debug("Received gossip data column, waiting for full data availability", {
          msToWait: cutoffTimeMs,
          dataColumnIndex: index,
          ...blockInputMeta,
        });
        // do not await here to not delay gossip validation
        blockInput.waitForBlockAndAllData(cutoffTimeMs).catch((_e) => {
          chain.logger.debug(
            "Waited for data after receiving gossip column. Cut-off reached so attempting to fetch remainder of BlockInput",
            {
              dataColumnIndex: index,
              ...blockInputMeta,
            }
          );
          chain.emitter.emit(ChainEvent.incompleteBlockInput, {
            blockInput,
            peer: peerIdStr,
            source: BlockInputSource.gossip,
          });
        });
        // immediately attempt fetch of data columns from execution engine
        chain.getBlobsTracker.triggerGetBlobs(blockInput);
        // if we've received at least half of the columns, trigger reconstruction of the rest
        if (blockInput.columnCount >= NUMBER_OF_COLUMNS / 2) {
          chain.columnReconstructionTracker.triggerColumnReconstruction(blockInput);
        }
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
      const {fork} = topic.boundary;

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
      const {indexedAttestation, committeeValidatorIndices, attDataRootHex} = validationResult;
      chain.validatorMonitor?.registerGossipAggregatedAttestation(
        seenTimestampSec,
        signedAggregateAndProof,
        indexedAttestation
      );
      const aggregatedAttestation = signedAggregateAndProof.message.aggregate;

      const insertOutcome = chain.aggregatedAttestationPool.add(
        aggregatedAttestation,
        attDataRootHex,
        indexedAttestation.attestingIndices.length,
        committeeValidatorIndices
      );
      metrics?.opPool.aggregatedAttestationPool.gossipInsertOutcome.inc({insertOutcome});

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
      const {fork} = topic.boundary;
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
      chain.validatorMonitor?.registerGossipSyncContributionAndProof(
        contributionAndProof.message,
        syncCommitteeParticipantIndices
      );
      try {
        const insertOutcome = chain.syncContributionAndProofPool.add(
          contributionAndProof.message,
          syncCommitteeParticipantIndices.length
        );
        metrics?.opPool.syncContributionAndProofPool.gossipInsertOutcome.inc({insertOutcome});
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
      const {fork} = gossipHandlerParams[0].topic.boundary;
      const validationParams = gossipHandlerParams.map((param) => ({
        attestation: null,
        serializedData: param.gossipData.serializedData,
        attSlot: param.gossipData.msgSlot,
        attDataBase64: param.gossipData.indexed,
        subnet: param.topic.subnet,
      })) as GossipAttestation[];
      const {results: validationResults, batchableBls} = await validateGossipAttestationsSameAttData(
        fork,
        chain,
        validationParams
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
          validatorCommitteeIndex,
          committeeSize,
        } = validationResult.result;
        chain.validatorMonitor?.registerGossipUnaggregatedAttestation(
          gossipHandlerParams[i].seenTimestampSec,
          indexedAttestation
        );

        const {subnet} = validationResult.result;
        try {
          // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
          // but don't add to attestation pool, to save CPU and RAM
          if (aggregatorTracker.shouldAggregate(subnet, indexedAttestation.data.slot)) {
            const insertOutcome = chain.attestationPool.add(
              committeeIndex,
              attestation,
              attDataRootHex,
              validatorCommitteeIndex,
              committeeSize
            );
            metrics?.opPool.attestationPool.gossipInsertOutcome.inc({insertOutcome});
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
  blockRoot: Root
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
          network.searchUnknownSlotRoot({slot, root: rootHex}, BlockInputSource.gossip);
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

function getCutoffTimeMs(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger},
  blockSlot: Slot,
  cutoffMsFromSlotStart: number
): number {
  return Math.max(
    computeTimeAtSlot(chain.config, blockSlot, chain.genesisTime) * 1000 + cutoffMsFromSlotStart - Date.now(),
    0
  );
}
