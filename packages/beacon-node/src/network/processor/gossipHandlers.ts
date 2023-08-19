import {toHexString} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {Logger, prettyBytes} from "@lodestar/utils";
import {Root, Slot, ssz, allForks, deneb} from "@lodestar/types";
import {ForkName, ForkSeq} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {OpSource} from "../../metrics/validatorMonitor.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlockError,
  BlockErrorCode,
  BlockGossipError,
  GossipAction,
  GossipActionError,
  SyncCommitteeError,
} from "../../chain/errors/index.js";
import {GossipHandlerParamGeneric, GossipHandlers, GossipType} from "../gossip/interface.js";
import {
  validateGossipAggregateAndProof,
  validateGossipAttesterSlashing,
  validateGossipBlock,
  validateGossipProposerSlashing,
  validateGossipSyncCommittee,
  validateSyncCommitteeGossipContributionAndProof,
  validateGossipVoluntaryExit,
  validateGossipBlsToExecutionChange,
  AggregateAndProofValidationResult,
  validateGossipAttestationsSameAttData,
  validateGossipAttestation,
  AttestationOrBytes,
  AttestationValidationResult,
} from "../../chain/validation/index.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {PeerAction} from "../peers/index.js";
import {validateLightClientFinalityUpdate} from "../../chain/validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../chain/validation/lightClientOptimisticUpdate.js";
import {validateGossipBlobSidecar} from "../../chain/validation/blobSidecar.js";
import {BlockInput, BlockSource, getBlockInput, GossipedInputType} from "../../chain/blocks/types.js";
import {sszDeserialize} from "../gossip/topic.js";
import {INetworkCore} from "../core/index.js";
import {INetwork} from "../interface.js";
import {IBeaconChain} from "../../chain/interface.js";
import {AggregatorTracker} from "./aggregatorTracker.js";

/**
 * Gossip handler options as part of network options
 */
export type GossipHandlerOpts = {
  /** By default pass gossip attestations to forkchoice */
  dontSendGossipAttestationsToForkchoice?: boolean;
  /** By default don't validate gossip attestations in batch */
  beaconAttestationBatchValidation?: boolean;
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
  const defaultHandlers = getDefaultHandlers(modules, options);
  if (options.beaconAttestationBatchValidation) {
    const batchHandlers = getBatchHandlers(modules, options);
    return {...defaultHandlers, ...batchHandlers};
  }
  return defaultHandlers;
}

/**
 * Default handlers validate gossip messages one by one.
 * We only have a choice to do batch validation for beacon_attestation topic.
 */
function getDefaultHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): GossipHandlers {
  const {chain, config, metrics, events, logger, core, aggregatorTracker} = modules;

  async function validateBeaconBlock(
    signedBlock: allForks.SignedBeaconBlock,
    blockBytes: Uint8Array,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput | null> {
    const slot = signedBlock.message.slot;
    const forkTypes = config.getForkTypes(slot);
    const blockHex = prettyBytes(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToVal = Date.now() / 1000 - seenTimestampSec;

    let blockInput;
    let blockInputMeta;
    if (config.getForkSeq(signedBlock.message.slot) >= ForkSeq.deneb) {
      const blockInputRes = getBlockInput.getGossipBlockInput(config, {
        type: GossipedInputType.block,
        signedBlock,
        blockBytes,
      });
      blockInput = blockInputRes.blockInput;
      blockInputMeta = blockInputRes.blockInputMeta;
    } else {
      blockInput = getBlockInput.preDeneb(config, signedBlock, BlockSource.gossip, blockBytes);
      blockInputMeta = {};
    }

    metrics?.gossipBlock.receivedToGossipValidate.observe(recvToVal);
    logger.verbose("Received gossip block", {
      slot: slot,
      root: blockHex,
      curentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      recvToVal,
      ...blockInputMeta,
    });

    try {
      await validateGossipBlock(config, chain, signedBlock, fork);
      // TODO: freetheblobs add some serialized data
      return blockInput;
    } catch (e) {
      if (e instanceof BlockGossipError) {
        // Don't trigger this yet if full block and blobs haven't arrived yet
        if (e instanceof BlockGossipError && e.type.code === BlockErrorCode.PARENT_UNKNOWN && blockInput !== null) {
          logger.debug("Gossip block has error", {slot, root: blockHex, code: e.type.code});
          events.emit(NetworkEvent.unknownBlockParent, {blockInput, peer: peerIdStr});
        }
      }

      if (e instanceof BlockGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
      }

      throw e;
    }
  }

  async function validateBeaconBlob(
    signedBlob: deneb.SignedBlobSidecar,
    blobBytes: Uint8Array,
    gossipIndex: number,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<BlockInput | null> {
    const slot = signedBlob.message.slot;
    const blockHex = prettyBytes(signedBlob.message.blockRoot);
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToVal = Date.now() / 1000 - seenTimestampSec;

    const {blockInput, blockInputMeta} = getBlockInput.getGossipBlockInput(config, {
      type: GossipedInputType.blob,
      signedBlob,
      blobBytes,
    });

    // TODO: freetheblobs
    // metrics?.gossipBlock.receivedToGossipValidate.observe(recvToVal);
    logger.verbose("Received gossip blob", {
      slot: slot,
      root: blockHex,
      curentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      recvToVal,
      gossipIndex,
      ...blockInputMeta,
    });

    try {
      await validateGossipBlobSidecar(config, chain, signedBlob, gossipIndex);
      return blockInput;
    } catch (e) {
      if (e instanceof BlockGossipError) {
        // Don't trigger this yet if full block and blobs haven't arrived yet
        if (e instanceof BlockGossipError && e.type.code === BlockErrorCode.PARENT_UNKNOWN && blockInput !== null) {
          logger.debug("Gossip blob has error", {slot, root: blockHex, code: e.type.code});
          events.emit(NetworkEvent.unknownBlockParent, {blockInput, peer: peerIdStr});
        }
      }

      if (e instanceof BlockGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(ssz.deneb.SignedBlobSidecar, signedBlob, `gossip_reject_slot_${slot}`);
      }

      throw e;
    }
  }

  function handleValidBeaconBlock(blockInput: BlockInput, peerIdStr: string, seenTimestampSec: number): void {
    const signedBlock = blockInput.block;

    // Handler - MUST NOT `await`, to allow validation result to be propagated

    metrics?.registerBeaconBlock(OpSource.gossip, seenTimestampSec, signedBlock.message);

    chain
      .processBlock(blockInput, {
        // block may be downloaded and processed by UnknownBlockSync
        ignoreIfKnown: true,
        // proposer signature already checked in validateBeaconBlock()
        validProposerSignature: true,
        // blobSidecars already checked in validateGossipBlobSidecars()
        validBlobSidecars: true,
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
        const delaySec = chain.clock.secFromSlot(signedBlock.message.slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
      })
      .catch((e) => {
        if (e instanceof BlockError) {
          switch (e.type.code) {
            // ALREADY_KNOWN should not happen with ignoreIfKnown=true above
            // PARENT_UNKNOWN should not happen, we handled this in validateBeaconBlock() function above
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              break;
            default:
              // TODO: Should it use PeerId or string?
              core.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadGossipBlock");
          }
        }
        metrics?.gossipBlock.processBlockErrors.inc({error: e instanceof BlockError ? e.type.code : "NOT_BLOCK_ERROR"});
        logger.error("Error receiving block", {slot: signedBlock.message.slot, peer: peerIdStr}, e as Error);
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
      const blockInput = await validateBeaconBlock(
        signedBlock,
        serializedData,
        topic.fork,
        peerIdStr,
        seenTimestampSec
      );
      if (blockInput !== null) {
        handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
      } else {
        // TODO DENEB:
        //
        // If block + blobs not fully recieved in the slot within some deadline, we should trigger block/blob
        // pull using req/resp by root pre-emptively even though it will be trigged on seeing any block/blob
        // gossip on next slot via missing parent checks
      }
    },

    [GossipType.blob_sidecar]: async ({
      gossipData,
      topic,
      peerIdStr,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.blob_sidecar>) => {
      const {serializedData} = gossipData;
      const signedBlob = sszDeserialize(topic, serializedData);
      if (config.getForkSeq(signedBlob.message.slot) < ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "PRE_DENEB_BLOCK"});
      }
      const blockInput = await validateBeaconBlob(signedBlob, serializedData, topic.index, peerIdStr, seenTimestampSec);
      if (blockInput !== null) {
        handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
      } else {
        // TODO DENEB:
        //
        // If block + blobs not fully recieved in the slot within some deadline, we should trigger block/blob
        // pull using req/resp by root pre-emptively even though it will be trigged on seeing any block/blob
        // gossip on next slot via missing parent checks
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
          chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "gossip_reject");
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
    [GossipType.beacon_attestation]: async ({
      gossipData,
      topic,
      seenTimestampSec,
    }: GossipHandlerParamGeneric<GossipType.beacon_attestation>): Promise<void> => {
      const {serializedData, msgSlot} = gossipData;
      if (msgSlot == undefined) {
        throw Error("msgSlot is undefined for beacon_attestation topic");
      }
      const {subnet, fork} = topic;

      // do not deserialize gossipSerializedData here, it's done in validateGossipAttestation only if needed
      let validationResult: AttestationValidationResult;
      try {
        validationResult = await validateGossipAttestation(
          fork,
          chain,
          {attestation: null, serializedData, attSlot: msgSlot},
          subnet
        );
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszBytes(ssz.phase0.Attestation.typeName, serializedData, "gossip_reject");
        }
        throw e;
      }

      // Handler
      const {indexedAttestation, attDataRootHex, attestation} = validationResult;
      metrics?.registerGossipUnaggregatedAttestation(seenTimestampSec, indexedAttestation);

      try {
        // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
        // but don't add to attestation pool, to save CPU and RAM
        if (aggregatorTracker.shouldAggregate(subnet, indexedAttestation.data.slot)) {
          const insertOutcome = chain.attestationPool.add(attestation, attDataRootHex);
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

      chain.emitter.emit(routes.events.EventType.attestation, attestation);
    },

    [GossipType.attester_slashing]: async ({
      gossipData,
      topic,
    }: GossipHandlerParamGeneric<GossipType.attester_slashing>) => {
      const {serializedData} = gossipData;
      const attesterSlashing = sszDeserialize(topic, serializedData);
      await validateGossipAttesterSlashing(chain, attesterSlashing);

      // Handler

      try {
        chain.opPool.insertAttesterSlashing(attesterSlashing);
        chain.forkChoice.onAttesterSlashing(attesterSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
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
function getBatchHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): Partial<GossipHandlers> {
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
      })) as AttestationOrBytes[];
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

        results.push(null);

        // Handler
        const {indexedAttestation, attDataRootHex, attestation} = validationResult.result;
        metrics?.registerGossipUnaggregatedAttestation(gossipHandlerParams[i].seenTimestampSec, indexedAttestation);

        try {
          // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
          // but don't add to attestation pool, to save CPU and RAM
          if (aggregatorTracker.shouldAggregate(subnet, indexedAttestation.data.slot)) {
            const insertOutcome = chain.attestationPool.add(attestation, attDataRootHex);
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

        chain.emitter.emit(routes.events.EventType.attestation, attestation);
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
  // eslint-disable-next-line no-constant-condition
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
          const rootHex = toHexString(blockRoot);
          network.searchUnknownSlotRoot({slot, root: rootHex});
        }

        if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
          const foundBlock = await chain.waitForBlock(slot, toHexString(blockRoot));
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
