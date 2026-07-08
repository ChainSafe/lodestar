import {routes} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkPostDeneb,
  ForkPostElectra,
  ForkPostGloas,
  ForkPreElectra,
  ForkSeq,
  NUMBER_OF_COLUMNS,
  isForkPostElectra,
  isForkPostGloas,
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
  gloas,
  isGloasDataColumnSidecar,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {LogLevel, Logger, prettyBytes, toHex, toRootHex} from "@lodestar/utils";
import {
  GossipValidationResult,
  GossipValidationStatus,
  GossipValidationVerdict,
  accept,
  ignore,
  reject,
  runGossipValidation,
} from "../../chain/beaconEngine/gossipValidationResult.js";
import {
  BlockInput,
  BlockInputColumns,
  BlockInputSource,
  IBlockInput,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../../chain/blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../../chain/blocks/payloadError.js";
import {BlobSidecarValidation} from "../../chain/blocks/types.js";
import {ChainEvent} from "../../chain/emitter.js";
import {
  AttestationErrorCode,
  BlobSidecarErrorCode,
  BlockError,
  BlockErrorCode,
  DataColumnSidecarErrorCode,
  ExecutionPayloadEnvelopeErrorCode,
  PayloadAttestationErrorCode,
} from "../../chain/errors/index.js";
import {IBeaconChain} from "../../chain/interface.js";
import {GossipAttestation, toElectraSingleAttestation} from "../../chain/validation/index.js";
import {validateLightClientFinalityUpdate} from "../../chain/validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../chain/validation/lightClientOptimisticUpdate.js";
import {OpSource} from "../../chain/validatorMonitor.js";
import {Metrics} from "../../metrics/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {getBlobKzgCommitments, getDataColumnSidecarSlot} from "../../util/dataColumns.js";
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
export function getGossipHandlers(modules: ValidatorFnsModules): GossipHandlers {
  return {...getSequentialHandlers(modules), ...getBatchHandlers(modules)};
}

/**
 * Default handlers validate gossip messages one by one.
 * We only have a choice to do batch validation for beacon_attestation topic.
 */
function getSequentialHandlers(modules: ValidatorFnsModules): SequentialGossipHandlers {
  const {chain, config, metrics, logger, core} = modules;

  async function validateBeaconBlock(
    signedBlock: SignedBeaconBlock,
    blockBytes: Uint8Array,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<IBlockInput>> {
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

    // optimistically add gossip block to the seen cache
    // if validation fails, we will NOT forward this gossip block to peers
    //   - if PARENT_UNKNOWN error, blockInput will then be queued inside BlockInputSync. If the gossip block is really invalid, it will be pruned there
    //   - if other validator errors, blockInput will stay in the seen cache and will be pruned on finalization
    const blockInput = chain.seenBlockInputCache.getByBlock({
      block: signedBlock,
      blockRootHex,
      source: BlockInputSource.gossip,
      seenTimestampSec,
      peerIdStr,
    });
    const res = await chain.beaconEngine.validateGossipBlock(blockBytes, signedBlock, fork);
    if (res.status !== GossipValidationStatus.Accept) {
      logger.debug("Gossip block has error", {slot, root: blockShortHex, code: res.code});
      if (
        (res.code === BlockErrorCode.PARENT_UNKNOWN || res.code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN) &&
        blockInput
      ) {
        chain.emitter.emit(ChainEvent.blockUnknownParent, {
          blockInput,
          peer: peerIdStr,
          source: BlockInputSource.gossip,
        });
        // don't prune the blockInput
        return res;
      }

      if (res.status === GossipValidationStatus.Reject) {
        chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
      }

      chain.seenBlockInputCache.prune(blockRootHex);
      return res;
    }

    const {skippedSlots} = res.value;

    if (isForkPostGloas(fork)) {
      chain.seenPayloadEnvelopeInputCache.add({
        blockRootHex,
        block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
        forkName: fork,
        sampledColumns: chain.custodyConfig.sampledColumns,
        custodyColumns: chain.custodyConfig.custodyColumns,
        timeCreatedSec: seenTimestampSec,
      });
    }

    const blockInputMeta = blockInput.getLogMeta();

    const recvToValidation = Date.now() / 1000 - seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    metrics?.gossipBlock.gossipValidation.recvToValidation.observe(recvToValidation);
    metrics?.gossipBlock.gossipValidation.validationTime.observe(validationTime);
    metrics?.gossipBlock.skippedSlots.observe(skippedSlots);

    logger.debug("Validated gossip block", {
      ...blockInputMeta,
      ...logCtx,
      recvToValidation,
      validationTime,
      skippedSlots,
    });

    chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockRootHex});

    return accept(blockInput);
  }

  async function validateBeaconBlob(
    blobSidecar: deneb.BlobSidecar,
    blobBytes: Uint8Array,
    subnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<BlockInput>> {
    const blobBlockHeader = blobSidecar.signedBlockHeader.message;
    const slot = blobBlockHeader.slot;
    const fork = config.getForkName(slot);
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobBlockHeader));
    const blockShortHex = prettyBytes(blockRootHex);

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    const res = await chain.beaconEngine.validateGossipBlobSidecar(blobBytes, fork, blobSidecar, subnet);
    if (res.status !== GossipValidationStatus.Accept) {
      // Don't trigger this yet if full block and blobs haven't arrived yet
      if (res.code === BlobSidecarErrorCode.PARENT_UNKNOWN) {
        logger.debug("Gossip blob has error", {slot, root: blockShortHex, code: res.code});
        // no need to trigger `unknownBlockParent` event here, as we already did it in `validateBeaconBlock()`
      }
      if (res.status === GossipValidationStatus.Reject) {
        chain.persistInvalidSszValue(
          ssz.deneb.BlobSidecar,
          blobSidecar,
          `gossip_reject_slot_${slot}_index_${blobSidecar.index}`
        );
      }
      return res;
    }

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

    return accept(blockInput);
  }

  async function validateBeaconDataColumn(
    dataColumnSidecar: fulu.DataColumnSidecar,
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<BlockInputColumns>> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const dataColumnBlockHeader = dataColumnSidecar.signedBlockHeader.message;
    const slot = dataColumnBlockHeader.slot;
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnBlockHeader));

    // check to see if block has already been processed and BlockInput has been deleted (column received via reqresp or other means)
    if (chain.forkChoice.hasBlockHex(blockRootHex)) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already processed block for column sidecar, skipping processing", {
        slot,
        blockRoot: blockRootHex,
        index: dataColumnSidecar.index,
      });
      return ignore(DataColumnSidecarErrorCode.ALREADY_KNOWN, {columnIndex: dataColumnSidecar.index, slot});
    }

    // first check if we should even process this column (we may have already processed it via getBlobsV2)
    {
      const blockInput = chain.seenBlockInputCache.get(blockRootHex);
      if (blockInput && isBlockInputColumns(blockInput) && blockInput.hasColumn(dataColumnSidecar.index)) {
        metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
        logger.debug("Already have column sidecar in BlockInput, skipping processing", {
          ...blockInput.getLogMeta(),
          index: dataColumnSidecar.index,
        });
        return ignore(DataColumnSidecarErrorCode.ALREADY_KNOWN, {columnIndex: dataColumnSidecar.index, slot});
      }
    }

    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const secFromSlot = chain.clock.secFromSlot(slot);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      const res = await chain.beaconEngine.validateGossipFuluDataColumnSidecar(
        dataColumnBytes,
        dataColumnSidecar,
        gossipSubnet
      );
      if (res.status !== GossipValidationStatus.Accept) {
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(
            ssz.fulu.DataColumnSidecar,
            dataColumnSidecar,
            `gossip_reject_slot_${slot}_index_${dataColumnSidecar.index}`
          );
          // no need to trigger `unknownBlockParent` event here, as we already did it in `validateBeaconBlock()`
        }
        return res;
      }

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
        secFromSlot,
        gossipSubnet,
        columnIndex: dataColumnSidecar.index,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return accept(blockInput);
    } finally {
      verificationTimer?.();
    }
  }

  async function validatePayloadDataColumn(
    dataColumnSidecar: gloas.DataColumnSidecar,
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<PayloadEnvelopeInput>> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const slot = dataColumnSidecar.slot;
    const blockRootHex = toRootHex(dataColumnSidecar.beaconBlockRoot);

    // check to see if payload has already been processed and PayloadEnvelopeInput has been deleted (column received via reqresp or other means)
    if (chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL) !== null) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already processed payload for column sidecar, skipping processing", {
        slot,
        blockRoot: blockRootHex,
        index: dataColumnSidecar.index,
      });
      return ignore(DataColumnSidecarErrorCode.ALREADY_KNOWN, {columnIndex: dataColumnSidecar.index, slot});
    }

    const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);

    if (!payloadInput) {
      // This should not happen for gossip because the network processor queues `data_column_sidecar`
      // until block import creates the corresponding PayloadEnvelopeInput.
      return ignore(DataColumnSidecarErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING, {slot, blockRoot: blockRootHex});
    }

    // [IGNORE] The sidecar is the first sidecar for the tuple
    // (sidecar.beacon_block_root, sidecar.index) with valid kzg proof.
    if (payloadInput.hasColumn(dataColumnSidecar.index)) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already have column sidecar in PayloadEnvelopeInput, skipping processing", {
        ...payloadInput.getLogMeta(),
        index: dataColumnSidecar.index,
      });
      return ignore(DataColumnSidecarErrorCode.ALREADY_KNOWN, {columnIndex: dataColumnSidecar.index, slot});
    }

    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const secFromSlot = chain.clock.secFromSlot(slot);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      const res = await chain.beaconEngine.validateGossipGloasDataColumnSidecar(
        dataColumnBytes,
        payloadInput,
        dataColumnSidecar,
        gossipSubnet
      );
      if (res.status !== GossipValidationStatus.Accept) {
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(
            sszTypesFor(payloadInput.forkName as ForkPostGloas).DataColumnSidecar,
            dataColumnSidecar,
            `gossip_reject_slot_${slot}_index_${dataColumnSidecar.index}`
          );
        }
        return res;
      }

      const addedColumn = payloadInput.addColumn({
        columnSidecar: dataColumnSidecar,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec,
        peerIdStr,
      });

      if (!addedColumn) {
        metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
        logger.debug("Already have column sidecar in PayloadEnvelopeInput, skipping processing", {
          ...payloadInput.getLogMeta(),
          index: dataColumnSidecar.index,
        });
        return ignore(DataColumnSidecarErrorCode.ALREADY_KNOWN, {columnIndex: dataColumnSidecar.index, slot});
      }

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
        });
      }

      logger.debug("Received gossip dataColumn", {
        ...payloadInput.getLogMeta(),
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        delaySec,
        secFromSlot,
        gossipSubnet,
        columnIndex: dataColumnSidecar.index,
        recvToValLatency,
        recvToValidation,
        validationTime,
      });

      return accept(payloadInput);
    } finally {
      verificationTimer?.();
    }
  }

  function handleValidBeaconBlock(blockInput: IBlockInput, peerIdStr: string, seenTimestampSec: number): void {
    const signedBlock = blockInput.getBlock();
    const slot = signedBlock.message.slot;

    // Handler - MUST NOT `await`, to allow validation result to be propagated

    const delaySec = seenTimestampSec - computeTimeAtSlot(config, slot, chain.genesisTime);
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
      const blobCount = getBlobKzgCommitments(
        blockInput.forkName,
        signedBlock as SignedBeaconBlock<ForkPostDeneb>
      ).length;
      metrics?.blockInputFetchStats.totalDataAvailableBlockInputBlobs.inc(blobCount);
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
      })
      .then(() => {
        // Returns the delay between the start of `block.slot` and `current time`
        const delaySec = chain.clock.secFromSlot(slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);

        if (isForkPostGloas(blockInput.forkName)) {
          const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockInput.blockRootHex);
          // This payloadInput should have been created just after gossip validation
          if (!payloadInput) {
            throw Error(
              `PayloadEnvelopeInput not seeded for block ${blockInput.blockRootHex} during gossip processing`
            );
          }

          // Immediately attempt fetch of data columns from execution engine as the bid contains kzg commitments
          // which is all the information we need so there is no reason to delay until execution payload arrives
          // TODO GLOAS: If we want EL retries after this initial attempt, add an explicit retry policy here
          // (for example later in the slot). Do not couple retries to incoming gossip columns.
          // Columns fetched here feed payloadInput.addColumn, which resolves waitForAllData for any
          // in-flight importExecutionPayload. No processExecutionPayload trigger needed from this path.
          chain.getBlobsTracker.triggerGetBlobs(payloadInput);
        }
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
      const res = await validateBeaconBlock(
        signedBlock,
        serializedData,
        topic.boundary.fork,
        peerIdStr,
        seenTimestampSec
      );
      if (res.status !== GossipValidationStatus.Accept) return res;
      chain.serializedCache.set(signedBlock, serializedData);
      handleValidBeaconBlock(res.value, peerIdStr, seenTimestampSec);
      return accept(undefined);
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
        return reject("PRE_DENEB_BLOCK");
      }
      const res = await validateBeaconBlob(blobSidecar, serializedData, topic.subnet, peerIdStr, seenTimestampSec);
      if (res.status !== GossipValidationStatus.Accept) return res;
      const blockInput = res.value;
      chain.serializedCache.set(blobSidecar, serializedData);
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
      return accept(undefined);
    },

    [GossipType.data_column_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.data_column_sidecar>) => {
      const {fork} = topic.boundary;
      const {serializedData} = gossipData;
      const dataColumnSidecar = sszDeserialize(topic, serializedData);
      const dataColumnSlot = getDataColumnSidecarSlot(dataColumnSidecar);
      const index = dataColumnSidecar.index;
      const delaySec = chain.clock.secFromSlot(dataColumnSlot, seenTimestampSec);

      if (isForkPostGloas(fork)) {
        if (!isGloasDataColumnSidecar(dataColumnSidecar)) {
          return reject(DataColumnSidecarErrorCode.INCORRECT_TYPE, {slot: dataColumnSlot, columnIndex: index, fork});
        }

        // After gloas, data columns are tracked in PayloadEnvelopeInput
        const res = await validatePayloadDataColumn(
          dataColumnSidecar,
          serializedData,
          topic.subnet,
          peerIdStr,
          seenTimestampSec
        );
        if (res.status !== GossipValidationStatus.Accept) return res;
        const payloadInput = res.value;
        chain.serializedCache.set(dataColumnSidecar, serializedData);

        const payloadInputMeta = payloadInput.getLogMeta();
        const {receivedColumns} = payloadInputMeta;
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

        if (!payloadInput.hasComputedAllData()) {
          // if we've received at least half of the columns, trigger reconstruction of the rest
          if (receivedColumns >= NUMBER_OF_COLUMNS / 2) {
            chain.columnReconstructionTracker.triggerColumnReconstruction(payloadInput);
          }

          chain.logger.debug("Received gossip data column, payload envelope input not yet complete", {
            dataColumnIndex: index,
            ...payloadInputMeta,
          });
        }

        // NOTE: we do NOT call chain.processExecutionPayload here. That is triggered only by
        // envelope arrival (gossip or API). An in-flight importExecutionPayload is awaiting
        // payloadInput.waitForAllData(); addColumn above will resolve it once hasAllData flips.

        if (!payloadInput.isComplete()) {
          const cutoffTimeMs = getCutoffTimeMs(chain, dataColumnSlot, BLOCK_AVAILABILITY_CUTOFF_MS);
          // do not await here to not delay gossip validation
          payloadInput.waitForEnvelopeAndAllData(cutoffTimeMs).catch((_e) => {
            chain.logger.debug(
              "Waited for envelope and data after receiving gossip column. Cut-off reached so emitting incompletePayloadEnvelope",
              {
                dataColumnIndex: index,
                ...payloadInputMeta,
              }
            );
            // TODO GLOAS: UnknownBlockSync to handle this event
            chain.emitter.emit(ChainEvent.incompletePayloadEnvelope, {
              payloadInput,
              peer: peerIdStr,
              source: BlockInputSource.gossip,
            });
          });
        }
        return accept(undefined);
      }
      if (config.getForkSeq(dataColumnSlot) < ForkSeq.fulu) {
        return reject("PRE_FULU_BLOCK");
      }

      if (isGloasDataColumnSidecar(dataColumnSidecar)) {
        return reject(DataColumnSidecarErrorCode.INCORRECT_TYPE, {slot: dataColumnSlot, columnIndex: index, fork});
      }

      // Before gloas, data columns are tracked in BlockInput
      const res = await validateBeaconDataColumn(
        dataColumnSidecar,
        serializedData,
        topic.subnet,
        peerIdStr,
        seenTimestampSec
      );
      if (res.status !== GossipValidationStatus.Accept) return res;
      const blockInput = res.value;
      chain.serializedCache.set(dataColumnSidecar, serializedData);
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

      if (!blockInput.hasComputedAllData()) {
        // immediately attempt fetch of data columns from execution engine
        chain.getBlobsTracker.triggerGetBlobs(blockInput);
        // if we've received at least half of the columns, trigger reconstruction of the rest
        if (blockInput.columnCount >= NUMBER_OF_COLUMNS / 2) {
          chain.columnReconstructionTracker.triggerColumnReconstruction(blockInput);
        }
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
      }
      return accept(undefined);
    },

    [GossipType.beacon_aggregate_and_proof]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.beacon_aggregate_and_proof>) => {
      const {serializedData} = gossipData;
      const signedAggregateAndProof = sszDeserialize(topic, serializedData);
      const {fork} = topic.boundary;

      const res = await chain.beaconEngine.validateGossipAggregateAndProof(
        serializedData,
        fork,
        signedAggregateAndProof
      );
      if (res.status !== GossipValidationStatus.Accept) {
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(
            sszTypesFor(fork).SignedAggregateAndProof,
            signedAggregateAndProof,
            "gossip_reject"
          );
        }
        return res;
      }

      // Handler
      // TODO beacon-engine: make the result type thinner
      const {indexedAttestation} = res.value;
      chain.validatorMonitor?.registerGossipAggregatedAttestation(
        seenTimestampSec,
        signedAggregateAndProof,
        indexedAttestation
      );

      chain.emitter.emit(routes.events.EventType.attestation, signedAggregateAndProof.message.aggregate);
      return accept(undefined);
    },

    [GossipType.attester_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.attester_slashing>) => {
      const {serializedData} = gossipData;
      const {fork} = topic.boundary;
      const attesterSlashing = sszDeserialize(topic, serializedData);
      // Engine validates + inserts into its (internal) opPool + updates fork choice; facade only emits.
      const res = await chain.beaconEngine.validateGossipAttesterSlashing(attesterSlashing, fork);
      if (res.status !== GossipValidationStatus.Accept) return res;

      chain.emitter.emit(routes.events.EventType.attesterSlashing, attesterSlashing);
      return accept(undefined);
    },

    [GossipType.proposer_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.proposer_slashing>) => {
      const {serializedData} = gossipData;
      const proposerSlashing = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipProposerSlashing(proposerSlashing);
      if (res.status !== GossipValidationStatus.Accept) return res;

      chain.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
      return accept(undefined);
    },

    [GossipType.voluntary_exit]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
      const {serializedData} = gossipData;
      const voluntaryExit = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipVoluntaryExit(voluntaryExit);
      if (res.status !== GossipValidationStatus.Accept) return res;

      chain.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
      return accept(undefined);
    },

    [GossipType.sync_committee_contribution_and_proof]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.sync_committee_contribution_and_proof>) => {
      const {serializedData} = gossipData;
      const contributionAndProof = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateSyncCommitteeGossipContributionAndProof(
        serializedData,
        contributionAndProof
      );
      if (res.status !== GossipValidationStatus.Accept) {
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "gossip_reject");
        }
        return res;
      }
      const {syncCommitteeParticipantIndices} = res.value;

      // Handler
      chain.validatorMonitor?.registerGossipSyncContributionAndProof(
        contributionAndProof.message,
        syncCommitteeParticipantIndices
      );

      chain.emitter.emit(routes.events.EventType.contributionAndProof, contributionAndProof);
      return accept(undefined);
    },

    [GossipType.sync_committee]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.sync_committee>) => {
      const {serializedData} = gossipData;
      const syncCommittee = sszDeserialize(topic, serializedData);
      const {subnet} = topic;
      const res = await chain.beaconEngine.validateGossipSyncCommittee(serializedData, syncCommittee, subnet);
      if (res.status !== GossipValidationStatus.Accept) {
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, syncCommittee, "gossip_reject");
        }
        return res;
      }
      // Engine validated + inserted the message into its (internal) pool for every subcommittee position.
      return accept(undefined);
    },

    [GossipType.light_client_finality_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_finality_update>) => {
      const {serializedData} = gossipData;
      const lightClientFinalityUpdate = sszDeserialize(topic, serializedData);
      return runGossipValidation(async () =>
        validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate)
      );
    },

    [GossipType.light_client_optimistic_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_optimistic_update>) => {
      const {serializedData} = gossipData;
      const lightClientOptimisticUpdate = sszDeserialize(topic, serializedData);
      return runGossipValidation(async () =>
        validateLightClientOptimisticUpdate(config, chain, lightClientOptimisticUpdate)
      );
    },

    // blsToExecutionChange is to be generated and validated against GENESIS_FORK_VERSION
    [GossipType.bls_to_execution_change]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.bls_to_execution_change>) => {
      const {serializedData} = gossipData;
      const blsToExecutionChange = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipBlsToExecutionChange(blsToExecutionChange);
      if (res.status !== GossipValidationStatus.Accept) return res;

      chain.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
      return accept(undefined);
    },
    [GossipType.execution_payload]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.execution_payload>) => {
      const {serializedData} = gossipData;
      const signedEnvelope = sszDeserialize(topic, serializedData);
      const envelope = signedEnvelope.message;

      // unlike BlockInput, we send the envelope into UnknownBlockInput sync
      // inside the sync it'll reconcile into PayloadEnvelopeInput and share the same cache with gossip
      const blockRootHex = toRootHex(envelope.beaconBlockRoot);
      // The facade owns the DA cache; look up the bid scalars here and pass them to the engine. If the
      // input is missing we can't validate the envelope (no bid), so return early without the engine.
      const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (!payloadInput) {
        // This shouldn't happen because beacon block should have been imported and thus payload input should have been created.
        return ignore(ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING, {blockRoot: blockRootHex});
      }
      const res = await chain.beaconEngine.validateGossipExecutionPayloadEnvelope(
        serializedData,
        signedEnvelope,
        payloadInput.proposerIndex,
        payloadInput.getBuilderIndex(),
        payloadInput.getBlockHashHex(),
        payloadInput.getBid().executionRequestsRoot
      );
      if (res.status !== GossipValidationStatus.Accept) {
        const {beaconBlockRoot} = signedEnvelope.message;
        const envelopeSlot = signedEnvelope.message.payload.slotNumber;
        logger.debug("Gossip envelope has error", {
          slot: envelopeSlot,
          root: toRootHex(beaconBlockRoot),
          code: res.code,
        });
        if (res.status === GossipValidationStatus.Reject) {
          chain.persistInvalidSszValue(
            ssz.gloas.SignedExecutionPayloadEnvelope,
            signedEnvelope,
            `gossip_reject_slot_${envelopeSlot}`
          );
        }
        return res;
      }

      const slot = envelope.payload.slotNumber;
      const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);

      logger.debug("Received gossip payload envelope", {
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        slot,
        blockRoot: toRootHex(envelope.beaconBlockRoot),
        delaySec,
      });

      metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);
      chain.validatorMonitor?.registerExecutionPayloadEnvelope(OpSource.gossip, delaySec, signedEnvelope);

      chain.serializedCache.set(signedEnvelope, serializedData);

      payloadInput.addPayloadEnvelope({
        envelope: signedEnvelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec,
        peerIdStr,
      });

      chain.emitter.emit(routes.events.EventType.executionPayloadGossip, {
        slot,
        builderIndex: envelope.builderIndex,
        blockHash: toRootHex(envelope.payload.blockHash),
        blockRoot: blockRootHex,
      });

      chain.processExecutionPayload(payloadInput, {validSignature: true}).catch((e) => {
        // Adjust verbosity based on error type
        let logLevel: LogLevel;

        if (e instanceof PayloadError) {
          switch (e.type.code) {
            // BLOCK_NOT_IN_FORK_CHOICE should not happen, validateGossipExecutionPayloadEnvelope above
            // already verified the block is in fork choice
            case PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE:
            case PayloadErrorCode.MISS_BLOCK_STATE:
            case PayloadErrorCode.EXECUTION_ENGINE_ERROR:
              // Errors might indicate an issue with our node or the connected EL client
              logLevel = LogLevel.error;
              break;
            // INVALID_SIGNATURE should not happen, signature is verified during gossip validation
            case PayloadErrorCode.INVALID_SIGNATURE:
            case PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR:
            case PayloadErrorCode.EXECUTION_ENGINE_INVALID:
              core.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadGossipPayload");
              // Misbehaving peer, but could highlight an issue in another client
              logLevel = LogLevel.warn;
              break;
          }
        } else {
          // Any unexpected error
          logLevel = LogLevel.error;
        }
        metrics?.gossipExecutionPayloadEnvelope.processPayloadErrors.inc({
          error: e instanceof PayloadError ? e.type.code : "NOT_PAYLOAD_ERROR",
        });
        chain.logger[logLevel](
          "Error processing execution payload from gossip",
          {slot, peer: peerIdStr, root: blockRootHex},
          e as Error
        );
      });
      return accept(undefined);
    },
    [GossipType.payload_attestation_message]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.payload_attestation_message>) => {
      const {serializedData} = gossipData;
      const payloadAttestationMessage = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipPayloadAttestationMessage(
        serializedData,
        payloadAttestationMessage
      );
      if (res.status !== GossipValidationStatus.Accept) return res;
      return accept(undefined);
    },
    [GossipType.execution_payload_bid]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.execution_payload_bid>) => {
      const {serializedData} = gossipData;
      const executionPayloadBid = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipExecutionPayloadBid(serializedData, executionPayloadBid);
      if (res.status !== GossipValidationStatus.Accept) return res;
      const {proposerIndex} = res.value;

      chain.validatorMonitor?.registerExecutionPayloadBid(OpSource.gossip, proposerIndex, executionPayloadBid.message);

      chain.emitter.emit(routes.events.EventType.executionPayloadBid, {
        version: config.getForkName(executionPayloadBid.message.slot),
        data: executionPayloadBid,
      });
      return accept(undefined);
    },
    [GossipType.proposer_preferences]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.proposer_preferences>) => {
      const {serializedData} = gossipData;
      const signedProposerPreferences = sszDeserialize(topic, serializedData);
      const res = await chain.beaconEngine.validateGossipProposerPreferences(serializedData, signedProposerPreferences);
      if (res.status !== GossipValidationStatus.Accept) return res;

      // Engine inserts into its (internal) proposerPreferencesPool on Accept; facade only emits.
      chain.emitter.emit(routes.events.EventType.proposerPreferences, {
        version: ForkName.gloas,
        data: signedProposerPreferences,
      });
      return accept(undefined);
    },
  };
}

/**
 * For now, only beacon_attestation topic is batched.
 */
function getBatchHandlers(modules: ValidatorFnsModules): BatchGossipHandlers {
  const {chain, metrics, aggregatorTracker} = modules;
  return {
    [GossipType.beacon_attestation]: async (
      gossipHandlerParams: GossipHandlerParamGeneric<GossipType.beacon_attestation>[]
    ): Promise<GossipValidationVerdict[]> => {
      const results: GossipValidationVerdict[] = [];
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
      // Node may be subscribed to extra subnets (long-lived random subnets). For those, validate the
      // messages but don't add to the attestation pool, to save CPU and RAM. This aggregatorTracker
      // decision is facade/network state — computed here and passed to the engine (which inserts on Accept).
      const shouldAddToPool = validationParams.map((p) => aggregatorTracker.shouldAggregate(p.subnet, p.attSlot));
      const {results: validationResults, batchableBls} = await chain.beaconEngine.validateGossipAttestationsSameAttData(
        fork,
        validationParams,
        shouldAddToPool
      );
      for (const [i, validationResult] of validationResults.entries()) {
        if (validationResult.status !== GossipValidationStatus.Accept) {
          results.push(validationResult);
          continue;
        }

        // Handler
        const {indexedAttestation, attestation} = validationResult.value;
        chain.validatorMonitor?.registerGossipUnaggregatedAttestation(
          gossipHandlerParams[i].seenTimestampSec,
          indexedAttestation
        );

        results.push(accept(undefined));

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
  fn: () => Promise<GossipValidationResult<T>>,
  network: INetwork,
  chain: IBeaconChain,
  slot: Slot,
  blockRoot: Root
): Promise<GossipValidationResult<T>> {
  let unknownBlockRootRetries = 0;
  while (true) {
    const res = await fn();
    if (res.status === GossipValidationStatus.Accept) {
      return res;
    }

    const isUnknownRoot =
      res.code === AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT ||
      res.code === PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT;

    if (isUnknownRoot) {
      if (unknownBlockRootRetries === 0) {
        // Trigger unknown block root search here
        const rootHex = toRootHex(blockRoot);
        network.searchUnknownBlock({slot, root: rootHex}, BlockInputSource.gossip);
      }

      if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
        const foundBlock = await chain.waitForBlock(slot, toRootHex(blockRoot));
        // Returns true if the block was found on time. In that case, try to get it from the fork-choice again.
        if (foundBlock) {
          continue;
        }
      }
    }

    return res;
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
