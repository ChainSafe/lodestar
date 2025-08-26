import {routes} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostElectra, ForkPreElectra, ForkSeq, isForkPostElectra} from "@lodestar/params";
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
  BlobSidecarValidation,
  BlockInput,
  BlockInputAvailableData,
  BlockInputType,
  DataColumnsSource,
  GossipedInputType,
  NullBlockInput,
} from "../../chain/blocks/types.js";
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

  async function validateBeaconBlock(
    signedBlock: SignedBeaconBlock,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput> {
    const slot = signedBlock.message.slot;
    const forkTypes = config.getForkTypes(slot);
    const blockRootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    const blockShortHex = prettyBytes(blockRootHex);
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    // always set block to seen cache for all forks so that we don't need to download it
    // TODO: validate block before adding to cache
    // tracked in https://github.com/ChainSafe/lodestar/issues/7957
    const blockInputRes = chain.seenGossipBlockInput.getGossipBlockInput(
      config,
      {
        type: GossipedInputType.block,
        signedBlock,
      },
      metrics
    );
    const blockInput = blockInputRes.blockInput;
    // blockInput can't be returned null, improve by enforcing via return types
    if (blockInput.block === null) {
      throw Error(
        `Invalid null blockInput returned by getGossipBlockInput for type=${GossipedInputType.block} blockHex=${blockShortHex} slot=${slot}`
      );
    }
    const blockInputMeta =
      config.getForkSeq(signedBlock.message.slot) >= ForkSeq.deneb ? blockInputRes.blockInputMeta : {};

    const logCtx = {
      slot: slot,
      root: blockShortHex,
      currentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      ...blockInputMeta,
      recvToValLatency,
    };

    logger.debug("Received gossip block", {...logCtx});

    try {
      await validateGossipBlock(config, chain, signedBlock, fork);

      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlock.gossipValidation.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlock.gossipValidation.validationTime.observe(validationTime);

      logger.debug("Validated gossip block", {...logCtx, recvToValidation, validationTime});

      if (chain.emitter.listenerCount(routes.events.EventType.blockGossip)) {
        chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockRootHex});
      }

      return blockInput;
    } catch (e) {
      if (e instanceof BlockGossipError) {
        // Don't trigger this yet if full block and blobs haven't arrived yet
        if (e.type.code === BlockErrorCode.PARENT_UNKNOWN && blockInput !== null) {
          logger.debug("Gossip block has error", {slot, root: blockShortHex, code: e.type.code});
          events.emit(NetworkEvent.unknownBlockParent, {blockInput, peer: peerIdStr});
        }

        if (e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
        }
      }

      throw e;
    }
  }

  async function validateBeaconBlob(
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput | NullBlockInput> {
    const blobBlockHeader = blobSidecar.signedBlockHeader.message;
    const slot = blobBlockHeader.slot;
    const fork = config.getForkName(slot);
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobBlockHeader));
    const blockShortHex = prettyBytes(blockRootHex);

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      await validateGossipBlobSidecar(fork, chain, blobSidecar, subnet);
      const {blockInput, blockInputMeta} = chain.seenGossipBlockInput.getGossipBlockInput(
        config,
        {
          type: GossipedInputType.blob,
          blobSidecar,
        },
        metrics
      );
      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      if (chain.emitter.listenerCount(routes.events.EventType.blobSidecar)) {
        chain.emitter.emit(routes.events.EventType.blobSidecar, {
          blockRoot: blockRootHex,
          slot,
          index: blobSidecar.index,
          kzgCommitment: toHex(blobSidecar.kzgCommitment),
          versionedHash: toHex(kzgCommitmentToVersionedHash(blobSidecar.kzgCommitment)),
        });
      }

      logger.debug("Received gossip blob", {
        slot: slot,
        root: blockShortHex,
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        delaySec,
        subnet,
        ...blockInputMeta,
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
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput | NullBlockInput> {
    metrics?.peerDas.dataColumnSidecarProcessingRequests.inc();
    const verificationTimer = metrics?.peerDas.dataColumnSidecarGossipVerificationTime.startTimer();

    const dataColumnBlockHeader = dataColumnSidecar.signedBlockHeader.message;
    const slot = dataColumnBlockHeader.slot;
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnBlockHeader));
    const blockShortHex = prettyBytes(blockRootHex);

    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToValLatency = Date.now() / 1000 - seenTimestampSec;

    try {
      await validateGossipDataColumnSidecar(chain, dataColumnSidecar, gossipSubnet, metrics);
      const {blockInput, blockInputMeta} = chain.seenGossipBlockInput.getGossipBlockInput(
        config,
        {
          type: GossipedInputType.dataColumn,
          dataColumnSidecar,
          dataColumnBytes,
        },
        metrics
      );

      const recvToValidation = Date.now() / 1000 - seenTimestampSec;
      const validationTime = recvToValidation - recvToValLatency;

      metrics?.peerDas.dataColumnSidecarProcessingSuccesses.inc();
      metrics?.gossipBlob.recvToValidation.observe(recvToValidation);
      metrics?.gossipBlob.validationTime.observe(validationTime);

      chain.emitter.emit(routes.events.EventType.dataColumnSidecar, {
        blockRoot: blockRootHex,
        slot,
        index: dataColumnSidecar.index,
        kzgCommitments: dataColumnSidecar.kzgCommitments.map(toHex),
      });

      logger.debug("Received gossip dataColumn", {
        slot: slot,
        root: blockShortHex,
        currentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
        delaySec,
        gossipSubnet,
        columnIndex: dataColumnSidecar.index,
        ...blockInputMeta,
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
      }

      throw e;
    } finally {
      verificationTimer?.();
    }
  }

  function handleValidBeaconBlock(blockInput: BlockInput, peerIdStr: string, seenTimestampSec: number): void {
    const signedBlock = blockInput.block;

    // Handler - MUST NOT `await`, to allow validation result to be propagated

    const delaySec = seenTimestampSec - (chain.genesisTime + signedBlock.message.slot * config.SECONDS_PER_SLOT);
    metrics?.gossipBlock.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);
    chain.validatorMonitor?.registerBeaconBlock(OpSource.gossip, delaySec, signedBlock.message);
    // if blobs are not yet fully available start an aggressive blob pull
    if (blockInput.type === BlockInputType.dataPromise) {
      events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
    } else if (blockInput.type === BlockInputType.availableData) {
      metrics?.blockInputFetchStats.totalDataAvailableBlockInputs.inc();
      metrics?.blockInputFetchStats.totalDataAvailableBlockInputBlobs.inc(
        (blockInput.block.message as deneb.BeaconBlock).body.blobKzgCommitments.length
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
        isGossipBlock: true,
      })
      .then(() => {
        // Returns the delay between the start of `block.slot` and `current time`
        const delaySec = chain.clock.secFromSlot(signedBlock.message.slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
        chain.seenGossipBlockInput.prune();
      })
      .catch((e) => {
        // Adjust verbosity based on error type
        let logLevel: LogLevel;

        if (e instanceof BlockError) {
          switch (e.type.code) {
            case BlockErrorCode.DATA_UNAVAILABLE: {
              const slot = signedBlock.message.slot;
              const forkTypes = config.getForkTypes(slot);
              const rootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));

              events.emit(NetworkEvent.unknownBlock, {rootHex, peer: peerIdStr});

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
        logger[logLevel]("Error receiving block", {slot: signedBlock.message.slot, peer: peerIdStr}, e as Error);
        chain.seenGossipBlockInput.prune();
      });

    if (blockInput.type === BlockInputType.dataPromise) {
      const blockSlot = blockInput.block.message.slot;
      // if blobs are not yet fully available start an aggressive blob pull
      chain.logger.debug("Block under processing is not available, racing with cutoff to add to unknownBlockInput", {
        blockSlot,
      });
      raceWithCutoff(
        chain,
        blockSlot,
        blockInput.cachedData.availabilityPromise as Promise<BlockInputAvailableData>,
        BLOCK_AVAILABILITY_CUTOFF_MS
      ).catch((_e) => {
        chain.logger.debug("Block under processing not yet available, racing with cutoff to add to unknownBlockInput", {
          blockSlot,
        });
        events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
        return null;
      });
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
      if (blockInput.block !== null) {
        if (blockInput.type === BlockInputType.dataPromise) {
          chain.logger.debug("Block corresponding to blob is available but waiting for data availability", {
            blobSlot,
            index,
          });
          await raceWithCutoff(
            chain,
            blobSlot,
            blockInput.cachedData.availabilityPromise as Promise<BlockInputAvailableData>,
            BLOCK_AVAILABILITY_CUTOFF_MS
          ).catch((_e) => {
            chain.logger.debug("Block under processing not yet fully available adding to unknownBlockInput", {
              blobSlot,
            });
            events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
          });
        }
      } else {
        // wait for the block to arrive till some cutoff else emit unknownBlockInput event
        chain.logger.debug("Block not yet available, racing with cutoff", {blobSlot, index});
        const normalBlockInput = await raceWithCutoff(
          chain,
          blobSlot,
          blockInput.blockInputPromise,
          BLOCK_AVAILABILITY_CUTOFF_MS
        ).catch((_e) => {
          return null;
        });

        if (normalBlockInput !== null) {
          // we can directly send it for processing but block gossip handler will queue it up anyway
          // if we see any issues later, we can send it to handleValidBeaconBlock
          //
          // handleValidBeaconBlock(normalBlockInput, peerIdStr, seenTimestampSec);
          //
          // however we can emit the event which will atleast add the peer to the list of peers to pull
          // data from
          if (normalBlockInput.type === BlockInputType.dataPromise) {
            chain.logger.debug("Block corresponding to blob is now available but waiting for data availability", {
              blobSlot,
              index,
            });
            await raceWithCutoff(
              chain,
              blobSlot,
              normalBlockInput.cachedData.availabilityPromise as Promise<BlockInputAvailableData>,
              BLOCK_AVAILABILITY_CUTOFF_MS
            ).catch((_e) => {
              chain.logger.debug("Block under processing not yet fully available adding to unknownBlockInput", {
                blobSlot,
              });
              events.emit(NetworkEvent.unknownBlockInput, {blockInput: normalBlockInput, peer: peerIdStr});
            });
          } else {
            chain.logger.debug("Block corresponding to blob is now available for processing", {blobSlot, index});
          }
        } else {
          chain.logger.debug(
            "Block corresponding to blob not available till BLOCK_AVAILABILITY_CUTOFF_MS adding to unknownBlockInput",
            {blobSlot, index}
          );
          events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
        }
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
      metrics?.dataColumns.elapsedTimeTillReceived.observe({source: DataColumnsSource.gossip}, delaySec);
      const blockInput = await validateBeaconDataColumn(
        dataColumnSidecar,
        serializedData,
        topic.subnet,
        peerIdStr,
        seenTimestampSec
      );
      if (blockInput.block !== null) {
        if (blockInput.type === BlockInputType.dataPromise) {
          chain.logger.debug("Block corresponding to data column is available but waiting for data availability", {
            dataColumnSlot,
            index,
          });
          await raceWithCutoff(
            chain,
            dataColumnSlot,
            blockInput.cachedData.availabilityPromise as Promise<BlockInputAvailableData>,
            BLOCK_AVAILABILITY_CUTOFF_MS
          ).catch((_e) => {
            chain.logger.debug("Block under processing not yet fully available adding to unknownBlockInput", {
              dataColumnSlot,
            });
            events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
          });
        }
      } else {
        // wait for the block to arrive till some cutoff else emit unknownBlockInput event
        chain.logger.debug("Block not yet available, racing with cutoff", {dataColumnSlot, index});
        const normalBlockInput = await raceWithCutoff(
          chain,
          dataColumnSlot,
          blockInput.blockInputPromise,
          BLOCK_AVAILABILITY_CUTOFF_MS
        ).catch((_e) => {
          return null;
        });

        if (normalBlockInput !== null) {
          if (normalBlockInput.type === BlockInputType.dataPromise) {
            chain.logger.debug(
              "Block corresponding to data column is now available but waiting for data availability",
              {
                dataColumnSlot,
                index,
              }
            );
            await raceWithCutoff(
              chain,
              dataColumnSlot,
              normalBlockInput.cachedData.availabilityPromise as Promise<BlockInputAvailableData>,
              BLOCK_AVAILABILITY_CUTOFF_MS
            ).catch((_e) => {
              chain.logger.debug("Block under processing not yet fully available adding to unknownBlockInput", {
                dataColumnSlot,
              });
              events.emit(NetworkEvent.unknownBlockInput, {blockInput: normalBlockInput, peer: peerIdStr});
            });
          } else {
            chain.logger.debug("Block corresponding to data column is now available for processing", {
              dataColumnSlot,
              index,
            });
          }
        } else {
          chain.logger.debug("Block not available till BLOCK_AVAILABILITY_CUTOFF_MS", {
            dataColumnSlot,
            index,
          });
          events.emit(NetworkEvent.unknownBlockInput, {blockInput, peer: peerIdStr});
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
          network.searchUnknownSlotRoot({slot, root: rootHex});
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

async function raceWithCutoff<T>(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger},
  blockSlot: Slot,
  availabilityPromise: Promise<T>,
  cutoffMsFromSlotStart: number
): Promise<T> {
  const cutoffTimeMs = Math.max(
    computeTimeAtSlot(chain.config, blockSlot, chain.genesisTime) * 1000 + cutoffMsFromSlotStart - Date.now(),
    0
  );
  const cutoffTimeout = new Promise((_resolve, reject) => setTimeout(reject, cutoffTimeMs));
  await Promise.race([availabilityPromise, cutoffTimeout]);
  // we can only be here if availabilityPromise has resolved else an error will be thrown
  return availabilityPromise;
}
