import {toHexString} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {Logger, prettyBytes} from "@lodestar/utils";
import {phase0, Root, Slot, ssz} from "@lodestar/types";
import {ForkName, ForkSeq} from "@lodestar/params";
import {Metrics} from "../../../metrics/index.js";
import {IBeaconChain} from "../../../chain/index.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlockErrorCode,
  BlockGossipError,
  GossipAction,
  GossipActionError,
  SyncCommitteeError,
} from "../../../chain/errors/index.js";
import {GossipHandlers, GossipType} from "../interface.js";
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
} from "../../../chain/validation/index.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {PeerRpcScoreStore} from "../../peers/index.js";
import {validateLightClientFinalityUpdate} from "../../../chain/validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../../chain/validation/lightClientOptimisticUpdate.js";
import {validateGossipBlobsSidecar} from "../../../chain/validation/blobsSidecar.js";
import {BlockInput, getBlockInput} from "../../../chain/blocks/types.js";
import {AttnetsService} from "../../subnets/attnetsService.js";
import {NetworkImporter} from "../../processor/importer.js";

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

type ValidatorFnsModules = {
  attnetsService: AttnetsService;
  chain: IBeaconChain;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  networkEventBus: NetworkEventBus;
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
  const {attnetsService, chain, config, metrics, networkEventBus, peerRpcScores, logger} = modules;
  const networkImporter = new NetworkImporter({chain, attnetsService, peerRpcScores, logger, metrics}, options);

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
          networkEventBus.emit(NetworkEvent.unknownBlockParent, blockInput, peerIdStr);
        }
      }

      if (e instanceof BlockGossipError && e.action === GossipAction.REJECT) {
        chain.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `gossip_reject_slot_${slot}`);
      }

      throw e;
    }
  }

  return {
    [GossipType.beacon_block]: async (signedBlock, topic, peerIdStr, seenTimestampSec) => {
      // TODO Deneb: Can blocks be received by this topic?
      if (config.getForkSeq(signedBlock.message.slot) >= ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "POST_DENEB_BLOCK"});
      }

      const blockInput = getBlockInput.preDeneb(config, signedBlock);
      await validateBeaconBlock(blockInput, topic.fork, peerIdStr, seenTimestampSec);
      networkImporter.importGossipBlock(blockInput, peerIdStr, seenTimestampSec);
    },

    [GossipType.beacon_block_and_blobs_sidecar]: async (blockAndBlocks, topic, peerIdStr, seenTimestampSec) => {
      const {beaconBlock, blobsSidecar} = blockAndBlocks;
      // TODO Deneb: Should throw for pre fork blocks?
      if (config.getForkSeq(beaconBlock.message.slot) < ForkSeq.deneb) {
        throw new GossipActionError(GossipAction.REJECT, {code: "PRE_DENEB_BLOCK"});
      }

      // Validate block + blob. Then forward, then handle both
      const blockInput = getBlockInput.postDeneb(config, beaconBlock, blobsSidecar);
      await validateBeaconBlock(blockInput, topic.fork, peerIdStr, seenTimestampSec);
      validateGossipBlobsSidecar(beaconBlock, blobsSidecar);
      networkImporter.importGossipBlock(blockInput, peerIdStr, seenTimestampSec);
    },

    [GossipType.beacon_aggregate_and_proof]: async (signedAggregateAndProof, _topic, _peer, seenTimestampSec) => {
      let validationResult: {indexedAttestation: phase0.IndexedAttestation; committeeIndices: number[]};
      try {
        // If an attestation refers to a block root that's not known, it will wait for 1 slot max
        // See https://github.com/ChainSafe/lodestar/pull/3564 for reasoning and results
        // Waiting here requires minimal code and automatically affects attestation, and aggregate validation
        // both from gossip and the API. I also prevents having to catch and re-throw in multiple places.
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const validateFn = () => validateGossipAggregateAndProof(chain, signedAggregateAndProof);
        const {slot, beaconBlockRoot} = signedAggregateAndProof.message.aggregate.data;
        validationResult = await validateGossipFnRetryUnknownRoot(validateFn, chain, slot, beaconBlockRoot);
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "gossip_reject");
        }
        throw e;
      }

      // Handler
      const {indexedAttestation, committeeIndices} = validationResult;
      networkImporter.importGossipAggregateAttestation(
        indexedAttestation,
        committeeIndices,
        signedAggregateAndProof,
        seenTimestampSec
      );
    },

    [GossipType.beacon_attestation]: async (attestation, {subnet}, _peer, seenTimestampSec) => {
      let validationResult: {indexedAttestation: phase0.IndexedAttestation; subnet: number};
      try {
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const validateFn = () => validateGossipAttestation(chain, attestation, subnet);
        const {slot, beaconBlockRoot} = attestation.data;
        // If an attestation refers to a block root that's not known, it will wait for 1 slot max
        // See https://github.com/ChainSafe/lodestar/pull/3564 for reasoning and results
        // Waiting here requires minimal code and automatically affects attestation, and aggregate validation
        // both from gossip and the API. I also prevents having to catch and re-throw in multiple places.
        validationResult = await validateGossipFnRetryUnknownRoot(validateFn, chain, slot, beaconBlockRoot);
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(ssz.phase0.Attestation, attestation, "gossip_reject");
        }
        throw e;
      }

      // Handler
      const {indexedAttestation} = validationResult;
      networkImporter.importGossipAttestation(attestation, indexedAttestation, subnet, seenTimestampSec);
    },

    [GossipType.attester_slashing]: async (attesterSlashing) => {
      await validateGossipAttesterSlashing(chain, attesterSlashing);

      // Handler
      networkImporter.importGossipAttesterSlashing(attesterSlashing);
    },

    [GossipType.proposer_slashing]: async (proposerSlashing) => {
      await validateGossipProposerSlashing(chain, proposerSlashing);

      // Handler
      networkImporter.importGossipProposerSlashing(proposerSlashing);
    },

    [GossipType.voluntary_exit]: async (voluntaryExit) => {
      await validateGossipVoluntaryExit(chain, voluntaryExit);

      // Handler
      networkImporter.importGossipVoluntaryExit(voluntaryExit);
    },

    [GossipType.sync_committee_contribution_and_proof]: async (contributionAndProof) => {
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
      networkImporter.importGossipSyncCommitteeContributionAndProof(
        contributionAndProof,
        syncCommitteeParticipantIndices
      );
    },

    [GossipType.sync_committee]: async (syncCommittee, {subnet}) => {
      let indexInSubcommittee: number;
      try {
        indexInSubcommittee = (await validateGossipSyncCommittee(chain, syncCommittee, subnet)).indexInSubcommittee;
      } catch (e) {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, syncCommittee, "gossip_reject");
        }
        throw e;
      }

      // Handler
      networkImporter.importGossipSyncCommitteeMessage(syncCommittee, subnet, indexInSubcommittee);
    },

    [GossipType.light_client_finality_update]: async (lightClientFinalityUpdate) => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    },

    [GossipType.light_client_optimistic_update]: async (lightClientOptimisticUpdate) => {
      validateLightClientOptimisticUpdate(config, chain, lightClientOptimisticUpdate);
    },

    // blsToExecutionChange is to be generated and validated against GENESIS_FORK_VERSION
    [GossipType.bls_to_execution_change]: async (blsToExecutionChange) => {
      await validateBlsToExecutionChange(chain, blsToExecutionChange);

      // Handler
      networkImporter.importGossipBlsToExecutionChange(blsToExecutionChange);
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
