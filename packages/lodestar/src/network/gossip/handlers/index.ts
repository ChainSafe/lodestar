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

type ValidatorFnsModules = {
  chain: IBeaconChain;
  config: IBeaconConfig;
  logger: ILogger;
  network: INetwork;
  metrics: IMetrics | null;
};

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
export function getGossipHandlers(modules: ValidatorFnsModules): GossipHandlers {
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
      chain
        .processBlock(signedBlock, {validProposerSignature: true})
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
                break;
              default:
                network.peerRpcScores.applyAction(
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
      try {
        const {indexedAttestation, committeeIndices} = await validateGossipAggregateAndProof(
          chain,
          signedAggregateAndProof
        );

        metrics?.registerAggregatedAttestation(
          OpSource.gossip,
          seenTimestampSec,
          signedAggregateAndProof,
          indexedAttestation
        );

        // TODO: Add DoS resistant pending attestation pool
        // switch (e.type.code) {
        //   case AttestationErrorCode.FUTURE_SLOT:
        //     chain.pendingAttestations.putBySlot(e.type.attestationSlot, attestation);
        //     break;
        //   case AttestationErrorCode.UNKNOWN_TARGET_ROOT:
        //   case AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
        //     chain.pendingAttestations.putByBlock(e.type.root, attestation);
        //     break;
        // }

        // Handler
        const aggregatedAttestation = signedAggregateAndProof.message.aggregate;

        chain.aggregatedAttestationPool.add(
          aggregatedAttestation,
          indexedAttestation.attestingIndices as ValidatorIndex[],
          committeeIndices
        );
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
    },

    [GossipType.beacon_attestation]: async (attestation, {subnet}, _peer, seenTimestampSec) => {
      let indexedAttestation: phase0.IndexedAttestation | undefined = undefined;
      try {
        indexedAttestation = (await validateGossipAttestation(chain, attestation, subnet)).indexedAttestation;
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

      metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);

      // Handler

      // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
      // but don't import them, to save CPU and RAM
      if (!network.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
        return;
      }

      try {
        chain.attestationPool.add(attestation);
      } catch (e) {
        logger.error("Error adding attestation to pool", {subnet}, e as Error);
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
      try {
        await validateSyncCommitteeGossipContributionAndProof(chain, contributionAndProof);
      } catch (e) {
        if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
          const archivedPath = chain.persistInvalidSszObject(
            "contributionAndProof",
            ssz.altair.SignedContributionAndProof.serialize(contributionAndProof),
            toHexString(ssz.altair.SignedContributionAndProof.hashTreeRoot(contributionAndProof))
          );
          logger.debug("The invalid gossip contribution and proof was written to", archivedPath);
        }
        throw e;
      }

      // Handler

      try {
        chain.syncContributionAndProofPool.add(contributionAndProof.message);
      } catch (e) {
        logger.error("Error adding to contributionAndProof pool", {}, e as Error);
      }
    },

    [GossipType.sync_committee]: async (syncCommittee, {subnet}) => {
      let indexInSubCommittee = 0;
      try {
        indexInSubCommittee = (await validateGossipSyncCommittee(chain, syncCommittee, subnet)).indexInSubCommittee;
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
        chain.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubCommittee);
      } catch (e) {
        logger.error("Error adding to syncCommittee pool", {subnet}, e as Error);
      }
    },
  };
}
