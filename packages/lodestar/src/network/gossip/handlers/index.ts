import {toHexString} from "@chainsafe/ssz";
import PeerId from "peer-id";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger, prettyBytes} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../../metrics";
import {OpSource} from "../../../metrics/validatorMonitor";
import {IBeaconChain} from "../../../chain";
import {
  AttestationError,
  AttestationErrorCode,
  BlockError,
  BlockErrorCode,
  BlockGossipError,
  GossipAction,
  SyncCommitteeError,
} from "../../../chain/errors";
import {GossipHandlers, GossipType} from "../interface";
import {
  validateGossipAggregateAndProof,
  validateGossipAttestation,
  validateGossipAttesterSlashing,
  validateGossipBlock,
  validateGossipProposerSlashing,
  validateGossipSyncCommittee,
  validateSyncCommitteeGossipContributionAndProof,
  validateGossipVoluntaryExit,
} from "../../../chain/validation";
import {INetwork} from "../../interface";
import {NetworkEvent} from "../../events";
import {PeerAction} from "../../peers";

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
  chain: IBeaconChain;
  config: IBeaconConfig;
  logger: ILogger;
  network: INetwork;
  metrics: IMetrics | null;
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
 * - Eth2.0 gossipsub protocol strictly defined a single topic for message
 */
export function getGossipHandlers(modules: ValidatorFnsModules, options: GossipHandlerOpts): GossipHandlers {
  const {chain, config, metrics, network, logger} = modules;

  return {
    [GossipType.beacon_block]: async (signedBlock, topic, peerIdStr, seenTimestampSec) => {
      const slot = signedBlock.message.slot;
      const blockHex = prettyBytes(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      logger.verbose("Received gossip block", {
        slot: slot,
        root: blockHex,
        curentSlot: chain.clock.currentSlot,
        peerId: peerIdStr,
      });

      try {
        await validateGossipBlock(config, chain, signedBlock, topic.fork);
      } catch (e) {
        if (e instanceof BlockGossipError) {
          if (e instanceof BlockGossipError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
            logger.debug("Gossip block has error", {slot, root: blockHex, code: e.type.code});
            network.events.emit(NetworkEvent.unknownBlockParent, signedBlock, peerIdStr);
          }
        }

        if (e instanceof BlockGossipError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "signedBlock",
            config.getForkTypes(slot).SignedBeaconBlock.serialize(signedBlock),
            `gossip_slot_${slot}`
          );
          logger.debug("The invalid gossip block was written to", archivedPath);
        }

        throw e;
      }

      // Handler - MUST NOT `await`, to allow validation result to be propagated

      metrics?.registerBeaconBlock(OpSource.gossip, seenTimestampSec, signedBlock.message);

      // `validProposerSignature = true`, in gossip validation the proposer signature is checked
      // At gossip time, it's critical to keep a good number of mesh peers.
      // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
      // Gossip Job Wait Time depends on the BLS Job Wait Time
      // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
      // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
      // See https://github.com/ChainSafe/lodestar/issues/3792
      chain
        .processBlock(signedBlock, {validProposerSignature: true, blsVerifyOnMainThread: true})
        .then(() => {
          // Returns the delay between the start of `block.slot` and `current time`
          const delaySec = Date.now() / 1000 - (chain.genesisTime + slot * config.SECONDS_PER_SLOT);
          metrics?.gossipBlock.elappsedTimeTillProcessed.observe(delaySec);
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
                network.reportPeer(
                  PeerId.createFromB58String(peerIdStr),
                  PeerAction.LowToleranceError,
                  "BadGossipBlock"
                );
            }
          }
          logger.error("Error receiving block", {slot, peer: peerIdStr}, e as Error);
        });
    },

    [GossipType.beacon_aggregate_and_proof]: async (signedAggregateAndProof, _topic, _peer, seenTimestampSec) => {
      let validationResult: {indexedAttestation: phase0.IndexedAttestation; committeeIndices: number[]};
      try {
        validationResult = await validateGossipAggregateAndProofRetryUnknownRoot(chain, signedAggregateAndProof);
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "signedAggregatedAndProof",
            ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof),
            toHexString(ssz.phase0.SignedAggregateAndProof.hashTreeRoot(signedAggregateAndProof))
          );
          logger.debug("The invalid gossip aggregate and proof was written to", archivedPath, e);
        }
        throw e;
      }

      // Handler
      const {indexedAttestation, committeeIndices} = validationResult;
      metrics?.registerAggregatedAttestation(
        OpSource.gossip,
        seenTimestampSec,
        signedAggregateAndProof,
        indexedAttestation
      );
      const aggregatedAttestation = signedAggregateAndProof.message.aggregate;

      chain.aggregatedAttestationPool.add(
        aggregatedAttestation,
        indexedAttestation.attestingIndices as ValidatorIndex[],
        committeeIndices
      );

      if (!options.dontSendGossipAttestationsToForkchoice) {
        try {
          chain.forkChoice.onAttestation(indexedAttestation);
        } catch (e) {
          logger.debug(
            "Error adding gossip aggregated attestation to forkchoice",
            {slot: aggregatedAttestation.data.slot},
            e as Error
          );
        }
      }
    },

    [GossipType.beacon_attestation]: async (attestation, {subnet}, _peer, seenTimestampSec) => {
      let validationResult: {indexedAttestation: phase0.IndexedAttestation; subnet: number};
      try {
        validationResult = await validateGossipAttestationRetryUnknownRoot(chain, attestation, subnet);
      } catch (e) {
        if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "attestation",
            ssz.phase0.Attestation.serialize(attestation),
            toHexString(ssz.phase0.Attestation.hashTreeRoot(attestation))
          );
          logger.debug("The invalid gossip attestation was written to", archivedPath);
        }
        throw e;
      }

      // Handler
      const {indexedAttestation} = validationResult;
      metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);

      // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
      // but don't import them, to save CPU and RAM
      if (!network.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
        return;
      }

      try {
        chain.attestationPool.add(attestation);
      } catch (e) {
        logger.error("Error adding unaggregated attestation to pool", {subnet}, e as Error);
      }

      if (!options.dontSendGossipAttestationsToForkchoice) {
        try {
          chain.forkChoice.onAttestation(indexedAttestation);
        } catch (e) {
          logger.debug("Error adding gossip unaggregated attestation to forkchoice", {subnet}, e as Error);
        }
      }
    },

    [GossipType.attester_slashing]: async (attesterSlashing) => {
      await validateGossipAttesterSlashing(chain, attesterSlashing);

      // Handler

      try {
        chain.opPool.insertAttesterSlashing(attesterSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    },

    [GossipType.proposer_slashing]: async (proposerSlashing) => {
      await validateGossipProposerSlashing(chain, proposerSlashing);

      // Handler

      try {
        chain.opPool.insertProposerSlashing(proposerSlashing);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    },

    [GossipType.voluntary_exit]: async (voluntaryExit) => {
      await validateGossipVoluntaryExit(chain, voluntaryExit);

      // Handler

      try {
        chain.opPool.insertVoluntaryExit(voluntaryExit);
      } catch (e) {
        logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    },

    [GossipType.sync_committee_contribution_and_proof]: async (contributionAndProof) => {
      const {syncCommitteeParticipants} = await validateSyncCommitteeGossipContributionAndProof(
        chain,
        contributionAndProof
      ).catch((e) => {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "contributionAndProof",
            ssz.altair.SignedContributionAndProof.serialize(contributionAndProof),
            toHexString(ssz.altair.SignedContributionAndProof.hashTreeRoot(contributionAndProof))
          );
          logger.debug("The invalid gossip contribution and proof was written to", archivedPath);
        }
        throw e;
      });

      // Handler

      try {
        chain.syncContributionAndProofPool.add(contributionAndProof.message, syncCommitteeParticipants);
      } catch (e) {
        logger.error("Error adding to contributionAndProof pool", {}, e as Error);
      }
    },

    [GossipType.sync_committee]: async (syncCommittee, {subnet}) => {
      let indexInSubcommittee = 0;
      try {
        indexInSubcommittee = (await validateGossipSyncCommittee(chain, syncCommittee, subnet)).indexInSubcommittee;
      } catch (e) {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "syncCommittee",
            ssz.altair.SyncCommitteeMessage.serialize(syncCommittee),
            toHexString(ssz.altair.SyncCommitteeMessage.hashTreeRoot(syncCommittee))
          );
          logger.debug("The invalid gossip sync committee was written to", archivedPath);
        }
        throw e;
      }

      // Handler

      try {
        chain.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee);
      } catch (e) {
        logger.error("Error adding to syncCommittee pool", {subnet}, e as Error);
      }
    },
  };
}

/**
 * If an attestation refers to a block root that's not known, it will wait for 1 slot max
 * See https://github.com/ChainSafe/lodestar/pull/3564 for reasoning and results
 * Waiting here requires minimal code and automatically affects attestation, and aggregate validation
 * both from gossip and the API. I also prevents having to catch and re-throw in multiple places.
 */
async function validateGossipAggregateAndProofRetryUnknownRoot(
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<ReturnType<typeof validateGossipAggregateAndProof>> {
  let unknownBlockRootRetries = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await validateGossipAggregateAndProof(chain, signedAggregateAndProof);
    } catch (e) {
      if (e instanceof AttestationError && e.type.code === AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT) {
        if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
          // Trigger unknown block root search here

          const attestation = signedAggregateAndProof.message.aggregate;
          const foundBlock = await chain.waitForBlockOfAttestation(
            attestation.data.slot,
            toHexString(attestation.data.beaconBlockRoot)
          );
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

/**
 * If an attestation refers to a block root that's not known, it will wait for 1 slot max
 * See https://github.com/ChainSafe/lodestar/pull/3564 for reasoning and results
 * Waiting here requires minimal code and automatically affects attestation, and aggregate validation
 * both from gossip and the API. I also prevents having to catch and re-throw in multiple places.
 */
async function validateGossipAttestationRetryUnknownRoot(
  chain: IBeaconChain,
  attestation: phase0.Attestation,
  subnet: number | null
): Promise<ReturnType<typeof validateGossipAttestation>> {
  let unknownBlockRootRetries = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await validateGossipAttestation(chain, attestation, subnet);
    } catch (e) {
      if (e instanceof AttestationError && e.type.code === AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT) {
        if (unknownBlockRootRetries++ < MAX_UNKNOWN_BLOCK_ROOT_RETRIES) {
          // Trigger unknown block root search here

          const foundBlock = await chain.waitForBlockOfAttestation(
            attestation.data.slot,
            toHexString(attestation.data.beaconBlockRoot)
          );
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
