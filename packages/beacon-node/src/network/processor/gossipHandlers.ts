import {peerIdFromString} from "@libp2p/peer-id";
import {toHexString} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {Logger, prettyBytes} from "@lodestar/utils";
import {Root, Slot, ssz} from "@lodestar/types";
import {ForkName, ForkSeq} from "@lodestar/params";
import {Metrics} from "../../metrics/index.js";
import {OpSource} from "../../metrics/validatorMonitor.js";
import {IBeaconChain} from "../../chain/index.js";
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
import {GossipHandlers, GossipType} from "../gossip/interface.js";
import {
  validateGossipAggregateAndProof,
  validateGossipAttestation,
  validateGossipAttesterSlashing,
  validateGossipBlock,
  validateGossipProposerSlashing,
  validateGossipSyncCommittee,
  validateSyncCommitteeGossipContributionAndProof,
  validateGossipVoluntaryExit,
  validateBlsToExecutionChange,
  AttestationValidationResult,
  AggregateAndProofValidationResult,
} from "../../chain/validation/index.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {PeerAction, PeerRpcScoreStore} from "../peers/index.js";
import {validateLightClientFinalityUpdate} from "../../chain/validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../chain/validation/lightClientOptimisticUpdate.js";
import {validateGossipBlobsSidecar} from "../../chain/validation/blobsSidecar.js";
import {BlockInput, getBlockInput} from "../../chain/blocks/types.js";
import {AttnetsService} from "../subnets/attnetsService.js";
import {sszDeserialize} from "../gossip/topic.js";

/**
 * Gossip handler options as part of network options
 */
export type GossipHandlerOpts = {
  dontSendGossipAttestationsToForkchoice: boolean;
};

/**
 * By default:
 * + pass gossip attestations to forkchoice
 */
export const defaultGossipHandlerOpts = {
  dontSendGossipAttestationsToForkchoice: false,
};

export type ValidatorFnsModules = {
  attnetsService: AttnetsService;
  chain: IBeaconChain;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  events: NetworkEventBus;
  peerRpcScores: PeerRpcScoreStore;
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
  const {attnetsService, chain, config, metrics, events, peerRpcScores, logger} = modules;

  async function validateBeaconBlock(
    blockInput: BlockInput,
    fork: ForkName,
    peerIdStr: string,
    seenTimestampSec: number
  ): Promise<void> {
    const signedBlock = blockInput.block;
    const slot = signedBlock.message.slot;
    const forkTypes = config.getForkTypes(slot);
    const blockHex = prettyBytes(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
    const recvToVal = Date.now() / 1000 - seenTimestampSec;
    metrics?.gossipBlock.receivedToGossipValidate.observe(recvToVal);
    logger.verbose("Received gossip block", {
      slot: slot,
      root: blockHex,
      curentSlot: chain.clock.currentSlot,
      peerId: peerIdStr,
      delaySec,
      recvToVal,
    });

    try {
      await validateGossipBlock(config, chain, signedBlock, fork);
    } catch (e) {
      if (e instanceof BlockGossipError) {
        if (e instanceof BlockGossipError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
          logger.debug("Gossip block has error", {slot, root: blockHex, code: e.type.code});
          events.emit(NetworkEvent.unknownBlockParent, blockInput, peerIdStr);
        }
      }

      if (e instanceof BlockGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
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
        // proposer signature already checked in validateBeaconBlock()
        validProposerSignature: true,
        // blobsSidecar already checked in validateGossipBlobsSidecar()
        validBlobsSidecar: true,
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
        const delaySec = chain.clock.secFromSlot(signedBlock.message.slot);
        metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
      })
      .catch((e) => {
        if (e instanceof BlockError) {
          switch (e.type.code) {
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              break;
            default:
              peerRpcScores.applyAction(peerIdFromString(peerIdStr), PeerAction.LowToleranceError, "BadGossipBlock");
          }
        }
        logger.error("Error receiving block", {slot: signedBlock.message.slot, peer: peerIdStr}, e as Error);
      });
  }

  return {
    [GossipType.beacon_block]: async ({serializedData}, topic, peerIdStr, seenTimestampSec) => {
      const signedBlock = sszDeserialize(topic, serializedData);
      // TODO Deneb: Can blocks be received by this topic?
      if (config.getForkSeq(signedBlock.message.slot) >= ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "POST_DENEB_BLOCK"});
      }

      const blockInput = getBlockInput.preDeneb(config, signedBlock);
      await validateBeaconBlock(blockInput, topic.fork, peerIdStr, seenTimestampSec);
      handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
    },

    [GossipType.beacon_block_and_blobs_sidecar]: async ({serializedData}, topic, peerIdStr, seenTimestampSec) => {
      const blockAndBlocks = sszDeserialize(topic, serializedData);
      const {beaconBlock, blobsSidecar} = blockAndBlocks;
      // TODO Deneb: Should throw for pre fork blocks?
      if (config.getForkSeq(beaconBlock.message.slot) < ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "PRE_DENEB_BLOCK"});
      }

      // Validate block + blob. Then forward, then handle both
      const blockInput = getBlockInput.postDeneb(config, beaconBlock, blobsSidecar);
      await validateBeaconBlock(blockInput, topic.fork, peerIdStr, seenTimestampSec);
      validateGossipBlobsSidecar(beaconBlock, blobsSidecar);
      handleValidBeaconBlock(blockInput, peerIdStr, seenTimestampSec);
    },

    [GossipType.beacon_aggregate_and_proof]: async ({serializedData}, topic, _peer, seenTimestampSec) => {
      let validationResult: AggregateAndProofValidationResult;
      const signedAggregateAndProof = sszDeserialize(topic, serializedData);

      try {
        validationResult = await validateGossipAggregateAndProof(chain, signedAggregateAndProof, false, serializedData);
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
    },

    [GossipType.beacon_attestation]: async ({serializedData, msgSlot}, {subnet}, _peer, seenTimestampSec) => {
      if (msgSlot === undefined) {
        throw Error("msgSlot is undefined for beacon_attestation topic");
      }
      // do not deserialize gossipSerializedData here, it's done in validateGossipAttestation only if needed
      let validationResult: AttestationValidationResult;
      try {
        validationResult = await validateGossipAttestation(
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
        if (attnetsService.shouldProcess(subnet, indexedAttestation.data.slot)) {
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
    },

    [GossipType.attester_slashing]: async ({serializedData}, topic) => {
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

    [GossipType.proposer_slashing]: async ({serializedData}, topic) => {
      const proposerSlashing = sszDeserialize(topic, serializedData);
      await validateGossipProposerSlashing(chain, proposerSlashing);

      // Handler

      try {
        chain.opPool.insertProposerSlashing(proposerSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    },

    [GossipType.voluntary_exit]: async ({serializedData}, topic) => {
      const voluntaryExit = sszDeserialize(topic, serializedData);
      await validateGossipVoluntaryExit(chain, voluntaryExit);

      // Handler

      try {
        chain.opPool.insertVoluntaryExit(voluntaryExit);
      } catch (e) {
        logger.error("Error adding voluntaryExit to pool", {}, e as Error);
      }
    },

    [GossipType.sync_committee_contribution_and_proof]: async ({serializedData}, topic) => {
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
    },

    [GossipType.sync_committee]: async ({serializedData}, topic) => {
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

    [GossipType.light_client_finality_update]: async ({serializedData}, topic) => {
      const lightClientFinalityUpdate = sszDeserialize(topic, serializedData);
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    },

    [GossipType.light_client_optimistic_update]: async ({serializedData}, topic) => {
      const lightClientOptimisticUpdate = sszDeserialize(topic, serializedData);
      validateLightClientOptimisticUpdate(config, chain, lightClientOptimisticUpdate);
    },

    // blsToExecutionChange is to be generated and validated against GENESIS_FORK_VERSION
    [GossipType.bls_to_execution_change]: async ({serializedData}, topic) => {
      const blsToExecutionChange = sszDeserialize(topic, serializedData);
      await validateBlsToExecutionChange(chain, blsToExecutionChange);

      // Handler
      try {
        chain.opPool.insertBlsToExecutionChange(blsToExecutionChange);
      } catch (e) {
        logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
      }
    },
  };
}

/**
 * Retry a function if it throws error code UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
 */
export async function validateGossipFnRetryUnknownRoot<T>(
  fn: () => Promise<T>,
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
        if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
          // Trigger unknown block root search here
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
