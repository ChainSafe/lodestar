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
  RootHex,
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
import {LogLevel, Logger, fromHex, toHex, toRootHex} from "@lodestar/utils";
import {
  GossipValidationResult,
  GossipValidationStatus,
  runGossipValidation,
} from "../../chain/beaconEngine/gossipValidationResult.js";
import {
  BlockInput,
  BlockInputColumns,
  BlockInputSource,
  IBlockInput,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {PayloadError, PayloadErrorCode} from "../../chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../../chain/blocks/payloadEnvelopeInput/index.js";
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
  DataColumnSidecarErrorCode,
  DataColumnSidecarGossipError,
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
  GossipActionError,
  PayloadAttestationError,
  PayloadAttestationErrorCode,
  SyncCommitteeError,
} from "../../chain/errors/index.js";
import {IBeaconChain} from "../../chain/interface.js";
import {GossipAttestation, toElectraSingleAttestation} from "../../chain/validation/index.js";
import {OpSource} from "../../chain/validatorMonitor.js";
import {Metrics} from "../../metrics/index.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {getBlobKzgCommitments, getDataColumnSidecarSlot} from "../../util/dataColumns.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
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
// TODO - beacon engine: engine validation methods still combine validation and pool insertion; preserve upstream deferred mutation timing in the base-branch follow-up.
export function getGossipHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts = {}): GossipHandlers {
  return {...getSequentialHandlers(modules, options), ...getBatchHandlers(modules, options)};
}

/**
 * Default handlers validate gossip messages one by one.
 * We only have a choice to do batch validation for beacon_attestation topic.
 */
function getSequentialHandlers(
  modules: ValidatorFnsModules,
  _options: GossipHandlerOpts = {}
): SequentialGossipHandlers {
  const {chain, config, metrics, logger, core} = modules;

  /**
   * Add a gossip block to the seen caches. The proposer signature of the block MUST be verified.
   */
  function cacheSignatureVerifiedBlock(
    signedBlock: SignedBeaconBlock,
    serializedData: Uint8Array,
    blockRootHex: RootHex,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): BlockInput {
    signedBlock = chain.blockSerializedCache.set(blockRootHex, signedBlock, serializedData).block;
    const blockInput = chain.seenBlockInputCache.getByBlock({
      block: signedBlock,
      blockRootHex,
      source: BlockInputSource.gossip,
      seenTimestampSec,
      peerIdStr,
    });

    // Also seed the payload-envelope cache, so we have PayloadEnvelopeInput even through "PARENT_BLOCK_UNKNOWN" error
    // see https://github.com/ChainSafe/lodestar/issues/9475
    if (isForkPostGloas(fork)) {
      chain.seenPayloadEnvelopeInputCache.add({
        blockRootHex,
        block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
        forkName: fork,
        sampledColumns: chain.custodyConfig.sampledColumns,
        custodyColumns: chain.custodyConfig.custodyColumns,
        seenTimestampSec,
        source: PayloadEnvelopeInputSource.gossip,
      });
    }

    return blockInput;
  }

  async function validateBeaconBlock(
    signedBlock: SignedBeaconBlock,
    serializedData: Uint8Array,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<IBlockInput> {
    const slot = signedBlock.message.slot;
    const forkTypes = config.getForkTypes(slot);
    const blockRootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    // [beacon-engine] Keep the ChainView duplicate gate before engine validation and cache seeding.
    if (chain.hasBlockHex(blockRootHex)) {
      throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRootHex});
    }
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    const logCtx = {
      slot,
      root: blockRootHex,
      currentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      recvToValLatency,
    };

    logger.debug("Received gossip block", {...logCtx});

    chain.seenBlockInputCache.markValidatingBlock(blockRootHex);

    try {
      const result = await chain.beaconEngine.validateGossipBlock(
        fromHex(blockRootHex),
        serializedData,
        fork,
        seenTimestampSec
      );
      if (result.err?.status === GossipValidationStatus.Reject) {
        chain.persistInvalidSszValue(
          forkTypes.SignedBeaconBlock,
          signedBlock,
          `gossip_reject_slot_${slot}`,
          blockRootHex
        );
      }
      const {skippedSlots} = unwrapGossipResult(result);
      const blockInput = cacheSignatureVerifiedBlock(
        signedBlock,
        serializedData,
        blockRootHex,
        fork,
        peerIdStr,
        seenTimestampSec
      );

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

      return blockInput;
    } catch (e) {
      if (e instanceof BlockGossipError) {
        logger.debug("Gossip block has error", {slot, root: blockRootHex, code: e.type.code});
        if (
          e.type.code === BlockErrorCode.PARENT_BLOCK_UNKNOWN ||
          e.type.code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
        ) {
          // [beacon-engine] The engine authenticated and recorded this unknown-parent block before returning.
          const blockInput = cacheSignatureVerifiedBlock(
            signedBlock,
            serializedData,
            blockRootHex,
            fork,
            peerIdStr,
            seenTimestampSec
          );
          chain.emitter.emit(ChainEvent.blockUnknownParent, {
            blockInput,
            peer: peerIdStr,
            source: BlockInputSource.gossip,
          });
          throw e;
        }
      }
      throw e;
    } finally {
      chain.seenBlockInputCache.unmarkValidatingBlock(blockRootHex);
      // The block received from the network may have established an equivocation, either by conflicting
      // with a previously observed block root (REPEAT_PROPOSAL) or with a root observed during validation
      const proposerIndex = signedBlock.message.proposerIndex;
      if (chain.beaconEngine.isBlockProposerEquivocating(slot, proposerIndex)) {
        chain.beaconEngine.processProposerEquivocation(slot, proposerIndex);
      }
    }
  }

  async function validateBeaconBlob(
    blobSidecar: deneb.BlobSidecar,
    serializedData: Uint8Array,
    subnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput> {
    const blobBlockHeader = blobSidecar.signedBlockHeader.message;
    const slot = blobBlockHeader.slot;
    const fork = config.getForkName(slot);
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobBlockHeader));

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      unwrapGossipResult(await chain.beaconEngine.validateGossipBlobSidecar(serializedData, fork, subnet));
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
          logger.debug("Gossip blob has error", {slot, root: blockRootHex, code: e.type.code});
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
    serializedData: Uint8Array,
    _dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInputColumns> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const dataColumnBlockHeader = dataColumnSidecar.signedBlockHeader.message;
    const slot = dataColumnBlockHeader.slot;
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnBlockHeader));

    // check to see if block has already been processed and BlockInput has been deleted (column received via reqresp or other means)
    if (chain.hasBlockHex(blockRootHex)) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already processed block for column sidecar, skipping processing", {
        slot,
        blockRoot: blockRootHex,
        index: dataColumnSidecar.index,
      });
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
        columnIndex: dataColumnSidecar.index,
        slot,
      });
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
        throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
          code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
          columnIndex: dataColumnSidecar.index,
          slot,
        });
      }
    }

    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const secFromSlot = chain.clock.secFromSlot(slot);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      unwrapGossipResult(await chain.beaconEngine.validateGossipFuluDataColumnSidecar(serializedData, gossipSubnet));
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

  async function validatePayloadDataColumn(
    dataColumnSidecar: gloas.DataColumnSidecar,
    serializedData: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<PayloadEnvelopeInput> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const slot = dataColumnSidecar.slot;
    const blockRootHex = toRootHex(dataColumnSidecar.beaconBlockRoot);

    // check to see if payload has already been processed and PayloadEnvelopeInput has been deleted (column received via reqresp or other means)
    if (chain.getBlockHex(blockRootHex, PayloadStatus.FULL) !== null) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already processed payload for column sidecar, skipping processing", {
        slot,
        blockRoot: blockRootHex,
        index: dataColumnSidecar.index,
      });
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
        columnIndex: dataColumnSidecar.index,
        slot,
      });
    }

    const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);

    if (!payloadInput) {
      // This should not happen for gossip because the network processor queues `data_column_sidecar`
      // until block import creates the corresponding PayloadEnvelopeInput.
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING,
        slot,
        blockRoot: blockRootHex,
      });
    }

    // [IGNORE] The sidecar is the first sidecar for the tuple
    // (sidecar.beacon_block_root, sidecar.index) with valid kzg proof.
    if (payloadInput.hasColumn(dataColumnSidecar.index)) {
      metrics?.peerDas.dataColumnSidecarProcessingSkip.inc();
      logger.debug("Already have column sidecar in PayloadEnvelopeInput, skipping processing", {
        ...payloadInput.getLogMeta(),
        index: dataColumnSidecar.index,
      });
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
        columnIndex: dataColumnSidecar.index,
        slot,
      });
    }

    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const secFromSlot = chain.clock.secFromSlot(slot);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      unwrapGossipResult(await chain.beaconEngine.validateGossipGloasDataColumnSidecar(serializedData, gossipSubnet));

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
        throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
          code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
          columnIndex: dataColumnSidecar.index,
          slot,
        });
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

      return payloadInput;
    } catch (e) {
      if (e instanceof DataColumnSidecarGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(
          sszTypesFor(payloadInput.forkName as ForkPostGloas).DataColumnSidecar,
          dataColumnSidecar,
          `gossip_reject_slot_${slot}_index_${dataColumnSidecar.index}`
        );
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

    const delaySec = seenTimestampSec - computeTimeAtSlot(config, slot, chain.genesisTime);
    metrics?.gossipBlock.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);
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
          // we should have the payloadInput in the seen cache so no need getOrReload() here
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
            // PARENT_BLOCK_UNKNOWN should not happen, we handled this in validateBeaconBlock() function above
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_BLOCK_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              // Errors might indicate an issue with our node or the connected EL client.
              logLevel = LogLevel.error;
              break;
            case BlockErrorCode.EXECUTION_ENGINE_INVALID:
              // the peer served a bad block
              core.reportPeer(peerIdStr, PeerAction.LowToleranceError, "ExecutionEngineInvalid");
              logLevel = LogLevel.warn;
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
        logger[logLevel]("Error processing block", {slot, root: blockInput.blockRootHex, peer: peerIdStr}, e as Error);
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
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;

        const signedBlock = sszDeserialize(topic, serializedData, {reuseBytes: true});
        try {
          const blockInput = await validateBeaconBlock(
            signedBlock,
            serializedData,
            topic.boundary.fork,
            peerIdStr,
            seenTimestampSec
          );
          // Handler - deferred to next event loop so the validation result propagates first
          callInNextEventLoop(() => {
            try {
              handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
            } catch (e) {
              logger.debug(
                "Error handling gossip block",
                {slot: signedBlock.message.slot, root: blockInput.blockRootHex},
                e as Error
              );
            }
          });
        } catch (e) {
          // Spec: IGNORE the block, ie not to re-publish to peers
          // but we should still import an equivocating (REPEAT_PROPOSAL) block into fork choice because we don't
          // know if this block (or the 1st known block with same slot) will become canonical yet
          if (
            e instanceof BlockGossipError &&
            e.type.code === BlockErrorCode.REPEAT_PROPOSAL &&
            // Only a signature-verified sibling recorded in the seen cache is imported. The cache holds at most two
            // roots per proposer and slot, which bounds full imports over gossip to one alternate
            chain.beaconEngine.hasObservedBlockRoot(signedBlock.message.slot, e.type.proposerIndex, e.type.root) &&
            chain.getBlockHexDefaultStatus(toRootHex(signedBlock.message.parentRoot)) !== null
          ) {
            // Source: unstable@2593063a82 gossipHandlers.ts#GossipType.beacon_block.
            const blockInput = cacheSignatureVerifiedBlock(
              signedBlock,
              serializedData,
              e.type.root,
              topic.boundary.fork,
              peerIdStr,
              seenTimestampSec
            );
            if (blockInput) {
              // We're returning IGNORE (thrown below), so this block is not forwarded to peers. Unlike the
              // happy path there is no rush to forward, so we don't need to wrap in callInNextEventLoop.
              // this is technically not a valid gossip block but gossip validation is a cheap subset of checks
              // this runs the full state transition, so importing an equivocating-but-valid block here is safe.
              handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
            }
          }
          // rethrow so gossipValidatorFn maps IGNORE -> TopicValidatorResult.Ignore (message not forwarded)
          throw e;
        }
      });
    },

    [GossipType.blob_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.blob_sidecar>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const blobSidecar = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(blobSidecar, serializedData);
        const blobSlot = blobSidecar.signedBlockHeader.message.slot;
        const index = blobSidecar.index;

        if (config.getForkSeq(blobSlot) < ForkSeq.deneb) {
          throw new GossipActionError(GossipAction.REJECT, {code: "PRE_DENEB_BLOCK"});
        }
        const blockInput = await validateBeaconBlob(
          blobSidecar,
          serializedData,
          topic.subnet,
          peerIdStr,
          seenTimestampSec
        );
        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
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
          } catch (e) {
            logger.debug(
              "Error handling gossip blob",
              {slot: blobSlot, root: blockInput.blockRootHex, index},
              e as Error
            );
          }
        });
      });
    },

    [GossipType.data_column_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.data_column_sidecar>) => {
      return runGossipValidation(async () => {
        const {fork} = topic.boundary;
        const {serializedData} = gossipData;
        const dataColumnSidecar = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(dataColumnSidecar, serializedData);
        const dataColumnSlot = getDataColumnSidecarSlot(dataColumnSidecar);
        const index = dataColumnSidecar.index;
        const delaySec = chain.clock.secFromSlot(dataColumnSlot, seenTimestampSec);

        if (isForkPostGloas(fork)) {
          if (!isGloasDataColumnSidecar(dataColumnSidecar)) {
            throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
              code: DataColumnSidecarErrorCode.INCORRECT_TYPE,
              slot: dataColumnSlot,
              columnIndex: index,
              fork,
            });
          }

          // After gloas, data columns are tracked in PayloadEnvelopeInput
          const payloadInput = await validatePayloadDataColumn(
            dataColumnSidecar,
            serializedData,
            topic.subnet,
            peerIdStr,
            seenTimestampSec
          );
          // Handler - deferred to next event loop so the validation result propagates first
          callInNextEventLoop(() => {
            try {
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
            } catch (e) {
              logger.debug(
                "Error handling gossip data column",
                {slot: dataColumnSlot, root: payloadInput.blockRootHex, index},
                e as Error
              );
            }
          });
        } else {
          if (config.getForkSeq(dataColumnSlot) < ForkSeq.fulu) {
            throw new GossipActionError(GossipAction.REJECT, {code: "PRE_FULU_BLOCK"});
          }

          if (isGloasDataColumnSidecar(dataColumnSidecar)) {
            throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
              code: DataColumnSidecarErrorCode.INCORRECT_TYPE,
              slot: dataColumnSlot,
              columnIndex: index,
              fork,
            });
          }

          // Before gloas, data columns are tracked in BlockInput
          const blockInput = await validateBeaconDataColumn(
            dataColumnSidecar,
            serializedData,
            serializedData,
            topic.subnet,
            peerIdStr,
            seenTimestampSec
          );
          // Handler - deferred to next event loop so the validation result propagates first
          callInNextEventLoop(() => {
            try {
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
            } catch (e) {
              logger.debug(
                "Error handling gossip data column",
                {slot: dataColumnSlot, root: blockInput.blockRootHex, index},
                e as Error
              );
            }
          });
        }
      });
    },

    [GossipType.beacon_aggregate_and_proof]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.beacon_aggregate_and_proof>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        // SSZ byte reuse can clear bitlist padding in the original gossip bytes.
        const signedAggregateAndProof = sszDeserialize(topic, serializedData, {reuseBytes: false});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(signedAggregateAndProof, serializedData);
        const {fork} = topic.boundary;

        try {
          unwrapGossipResult(
            await chain.beaconEngine.validateGossipAggregateAndProof(serializedData, fork, seenTimestampSec)
          );
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

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.attestation, signedAggregateAndProof.message.aggregate);
          } catch (e) {
            logger.debug(
              "Error handling gossip aggregate and proof",
              {
                slot: signedAggregateAndProof.message.aggregate.data.slot,
                root: toRootHex(signedAggregateAndProof.message.aggregate.data.beaconBlockRoot),
              },
              e as Error
            );
          }
        });
      });
    },

    [GossipType.attester_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.attester_slashing>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const {fork} = topic.boundary;
        const attesterSlashing = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(attesterSlashing, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipAttesterSlashing(serializedData, fork));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.attesterSlashing, attesterSlashing);
          } catch (e) {
            logger.debug(
              "Error handling gossip attester slashing",
              {slot: attesterSlashing.attestation1.data.slot},
              e as Error
            );
          }
        });
      });
    },

    [GossipType.proposer_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.proposer_slashing>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const proposerSlashing = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(proposerSlashing, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipProposerSlashing(serializedData));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
          } catch (e) {
            logger.debug(
              "Error handling gossip proposer slashing",
              {
                slot: proposerSlashing.signedHeader1.message.slot,
                proposerIndex: proposerSlashing.signedHeader1.message.proposerIndex,
              },
              e as Error
            );
          }
        });
      });
    },

    [GossipType.voluntary_exit]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const voluntaryExit = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(voluntaryExit, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipVoluntaryExit(serializedData));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
          } catch (e) {
            logger.debug(
              "Error handling gossip voluntary exit",
              {epoch: voluntaryExit.message.epoch, validatorIndex: voluntaryExit.message.validatorIndex},
              e as Error
            );
          }
        });
      });
    },

    [GossipType.sync_committee_contribution_and_proof]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.sync_committee_contribution_and_proof>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const contributionAndProof = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(contributionAndProof, serializedData);
        await chain.beaconEngine
          .validateSyncCommitteeGossipContributionAndProof(serializedData)
          .then(unwrapGossipResult)
          .catch((e) => {
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(
                ssz.altair.SignedContributionAndProof,
                contributionAndProof,
                "gossip_reject"
              );
            }
            throw e;
          });

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.contributionAndProof, contributionAndProof);
          } catch (e) {
            logger.debug(
              "Error handling gossip contribution and proof",
              {
                slot: contributionAndProof.message.contribution.slot,
                subcommitteeIndex: contributionAndProof.message.contribution.subcommitteeIndex,
              },
              e as Error
            );
          }
        });
      });
    },

    [GossipType.sync_committee]: async ({gossipData, topic}: GossipHandlerParamGeneric<GossipType.sync_committee>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const syncCommittee = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(syncCommittee, serializedData);
        const {subnet} = topic;
        try {
          unwrapGossipResult(await chain.beaconEngine.validateGossipSyncCommittee(serializedData, subnet));
        } catch (e) {
          if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
            chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, syncCommittee, "gossip_reject");
          }
          throw e;
        }

        // TODO - beacon engine: defer engine-owned pool insertion as upstream does.
      });
    },

    [GossipType.light_client_finality_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_finality_update>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        unwrapGossipResult(
          await chain.beaconEngine.validateGossipLightClientFinalityUpdate(serializedData, topic.boundary.fork)
        );
      });
    },

    [GossipType.light_client_optimistic_update]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.light_client_optimistic_update>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        unwrapGossipResult(
          await chain.beaconEngine.validateGossipLightClientOptimisticUpdate(serializedData, topic.boundary.fork)
        );
      });
    },

    // blsToExecutionChange is to be generated and validated against GENESIS_FORK_VERSION
    [GossipType.bls_to_execution_change]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.bls_to_execution_change>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const blsToExecutionChange = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(blsToExecutionChange, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipBlsToExecutionChange(serializedData));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
          } catch (e) {
            logger.debug(
              "Error handling gossip bls to execution change",
              {validatorIndex: blsToExecutionChange.message.validatorIndex},
              e as Error
            );
          }
        });
      });
    },
    [GossipType.execution_payload]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.execution_payload>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const signedEnvelope = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(signedEnvelope, serializedData);
        const envelope = signedEnvelope.message;

        // unlike BlockInput, we send the envelope into UnknownBlockInput sync
        // inside the sync it'll reconcile into PayloadEnvelopeInput and share the same cache with gossip
        try {
          unwrapGossipResult(
            await chain.beaconEngine.validateGossipExecutionPayloadEnvelope(serializedData, {
              source: PayloadEnvelopeInputSource.gossip,
              seenTimestampSec,
              peerIdStr,
            })
          );
        } catch (e) {
          if (e instanceof ExecutionPayloadEnvelopeError) {
            const {beaconBlockRoot} = signedEnvelope.message;
            const slot = signedEnvelope.message.payload.slotNumber;
            logger.debug("Gossip envelope has error", {slot, root: toRootHex(beaconBlockRoot), code: e.type.code});

            if (e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(
                ssz.gloas.SignedExecutionPayloadEnvelope,
                signedEnvelope,
                `gossip_reject_slot_${slot}`
              );
            }
          }

          throw e;
        }

        const slot = envelope.payload.slotNumber;
        const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);

        logger.debug("Received gossip payload envelope", {
          slot,
          currentSlot: chain.clock.currentSlot,
          peerId: peerIdStr,
          blockRoot: toRootHex(envelope.beaconBlockRoot),
          delaySec,
        });

        metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);

        const blockRootHex = toRootHex(envelope.beaconBlockRoot);
        // a gossip payload cannot be `MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE` slots after the block
        // otherwise it'll get to UnknownBlockInput flow
        const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);

        if (!payloadInput) {
          // This shouldn't happen because beacon block should have been imported and thus payload input should have been created.
          throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
            code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING,
            blockRoot: blockRootHex,
          });
        }

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
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
                    chain.seenPayloadEnvelopeInputCache.removeInvalid(payloadInput);
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
                {slot, root: blockRootHex, peer: peerIdStr},
                e as Error
              );
            });
          } catch (e) {
            logger.debug("Error handling gossip execution payload", {slot, root: blockRootHex}, e as Error);
          }
        });
      });
    },
    [GossipType.payload_attestation_message]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.payload_attestation_message>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const payloadAttestationMessage = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(payloadAttestationMessage, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipPayloadAttestationMessage(serializedData));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            const delaySec = chain.clock.secFromSlot(payloadAttestationMessage.data.slot, seenTimestampSec);
            metrics?.gossipPayloadAttestationMessage.elapsedTimeTillReceived.observe(
              {source: OpSource.gossip},
              delaySec
            );
            chain.emitter.emit(routes.events.EventType.payloadAttestationMessage, {
              version: config.getForkName(payloadAttestationMessage.data.slot),
              data: payloadAttestationMessage,
            });
          } catch (e) {
            logger.debug(
              "Error handling gossip payload attestation message",
              {
                slot: payloadAttestationMessage.data.slot,
                root: toRootHex(payloadAttestationMessage.data.beaconBlockRoot),
              },
              e as Error
            );
          }
        });
      });
    },
    [GossipType.execution_payload_bid]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.execution_payload_bid>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const executionPayloadBid = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(executionPayloadBid, serializedData);
        const {proposerIndex} = unwrapGossipResult(
          await chain.beaconEngine.validateGossipExecutionPayloadBid(
            serializedData,
            topic.boundary.fork,
            seenTimestampSec
          )
        );

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            // this could be negative, because it's most likely the bid of next slot comes at this clock slot
            const elapsedSec = chain.clock.secFromSlot(executionPayloadBid.message.slot, seenTimestampSec);
            metrics?.gossipExecutionPayloadBid.elapsedTimeTillReceived.observe({source: OpSource.gossip}, elapsedSec);

            // Handle valid payload bid by storing in a bid pool
            // Pool insertion is engine-owned.
            chain.emitter.emit(routes.events.EventType.executionPayloadBid, {
              version: config.getForkName(executionPayloadBid.message.slot),
              data: executionPayloadBid,
            });
          } catch (e) {
            logger.debug(
              "Error handling gossip execution payload bid",
              {
                slot: executionPayloadBid.message.slot,
                root: toRootHex(executionPayloadBid.message.parentBlockRoot),
                proposerIndex,
              },
              e as Error
            );
          }
        });
      });
    },
    [GossipType.proposer_preferences]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.proposer_preferences>) => {
      return runGossipValidation(async () => {
        const {serializedData} = gossipData;
        const signedProposerPreferences = sszDeserialize(topic, serializedData, {reuseBytes: true});
        if (!chain.opts.beaconEngineWorker) chain.serializedCache.set(signedProposerPreferences, serializedData);
        unwrapGossipResult(await chain.beaconEngine.validateGossipProposerPreferences(serializedData));

        // Handler - deferred to next event loop so the validation result propagates first
        callInNextEventLoop(() => {
          try {
            chain.emitter.emit(routes.events.EventType.proposerPreferences, {
              version: config.getForkName(signedProposerPreferences.message.proposalSlot),
              data: signedProposerPreferences,
            });
          } catch (e) {
            logger.debug(
              "Error handling gossip proposer preferences",
              {proposalSlot: signedProposerPreferences.message.proposalSlot},
              e as Error
            );
          }
        });
      });
    },
  };
}

/**
 * For now, only beacon_attestation topic is batched.
 */
function getBatchHandlers(modules: ValidatorFnsModules, _options: GossipHandlerOpts = {}): BatchGossipHandlers {
  const {chain, metrics, logger} = modules;
  return {
    [GossipType.beacon_attestation]: async (
      gossipHandlerParams: GossipHandlerParamGeneric<GossipType.beacon_attestation>[]
    ): Promise<GossipValidationResult<unknown>[]> => {
      const attestationCount = gossipHandlerParams.length;
      if (attestationCount === 0) {
        return [];
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
      const {results: validationResults, batchableBls} = await chain.beaconEngine.validateGossipAttestationsSameAttData(
        fork,
        validationParams,
        gossipHandlerParams.map(({seenTimestampSec}) => seenTimestampSec)
      );
      if (batchableBls) {
        metrics?.gossipAttestation.attestationBatchHistogram.observe(attestationCount);
      } else {
        metrics?.gossipAttestation.attestationNonBatchCount.inc(attestationCount);
      }

      // Handler - deferred to next event loop so the validation result propagates first.
      callInNextEventLoop(() => {
        for (const validationResult of validationResults) {
          if (validationResult.err !== null) continue;
          const {indexedAttestation, attestation, subnet} = validationResult.result;
          try {
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
          } catch (e) {
            logger.debug("Error handling gossip attestation", {slot: indexedAttestation.data.slot, subnet}, e as Error);
          }
        }
      });

      return validationResults;
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
      const isUnknownAttestationRoot =
        e instanceof AttestationError && e.type.code === AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT;
      const isUnknownPayloadAttestationRoot =
        e instanceof PayloadAttestationError && e.type.code === PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT;

      if (isUnknownAttestationRoot || isUnknownPayloadAttestationRoot) {
        if (unknownBlockRootRetries === 0) {
          // Trigger unknown block root search here
          const rootHex = toRootHex(blockRoot);
          network.searchUnknownBlock({slot, root: rootHex}, BlockInputSource.gossip);
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

/** TODO - beacon engine: replace transitional JS error reconstruction with code-based handling for the worker. */
function unwrapGossipResult<T>(result: GossipValidationResult<T>): T {
  if (result.err === null) return result.result;
  throw (
    result.err.error ??
    new GossipActionError(
      result.err.status === GossipValidationStatus.Reject ? GossipAction.REJECT : GossipAction.IGNORE,
      {
        code: result.err.code,
      }
    )
  );
}
