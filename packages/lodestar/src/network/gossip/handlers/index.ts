import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../../metrics";
import {OpSource} from "../../../metrics/validatorMonitor";
import {IBeaconDb} from "../../../db";
import {IBeaconChain} from "../../../chain";
import {BlockError, BlockErrorCode} from "../../../chain/errors";
import {GossipTopicMap, GossipType, GossipTypeMap} from "../interface";
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

export type GossipHandlerFn = (object: GossipTypeMap[GossipType], topic: GossipTopicMap[GossipType]) => Promise<void>;
export type GossipHandlers = {
  [K in GossipType]: (object: GossipTypeMap[K], topic: GossipTopicMap[K]) => Promise<void>;
};

type ValidatorFnsModules = {
  chain: IBeaconChain;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
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
  const {chain, db, config, metrics, logger} = modules;

  return {
    [GossipType.beacon_block]: async (signedBlock) => {
      const seenTimestampSec = Date.now() / 1000;

      try {
        await validateGossipBlock(config, chain, db, {
          signedBlock,
          reprocess: false,
          prefinalized: false,
          validSignatures: false,
          validProposerSignature: false,
        });

        metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, signedBlock.message);

        // Handler

        try {
          chain.receiveBlock(signedBlock);
        } catch (e) {
          logger.error("Error receiving block", {}, e);
        }
      } catch (e) {
        if (
          e instanceof BlockError &&
          (e.type.code === BlockErrorCode.FUTURE_SLOT || e.type.code === BlockErrorCode.PARENT_UNKNOWN)
        ) {
          chain.receiveBlock(signedBlock);
        }

        throw e;
      }
    },

    [GossipType.beacon_aggregate_and_proof]: async (signedAggregateAndProof) => {
      const seenTimestampSec = Date.now() / 1000;

      const indexedAtt = await validateGossipAggregateAndProof(chain, signedAggregateAndProof);

      metrics?.registerAggregatedAttestation(OpSource.gossip, seenTimestampSec, signedAggregateAndProof, indexedAtt);

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

      db.aggregateAndProof.add(signedAggregateAndProof.message).catch((e) => {
        logger.error("Error adding aggregateAndProof to pool", {}, e);
      });
    },

    [GossipType.beacon_attestation]: async (attestation, {subnet}) => {
      const seenTimestampSec = Date.now() / 1000;

      const {indexedAttestation} = await validateGossipAttestation(chain, attestation, subnet);

      metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);

      // Handler

      try {
        chain.attestationPool.add(attestation);
      } catch (e) {
        logger.error("Error adding attestation to pool", {subnet}, e);
      }
    },

    [GossipType.voluntary_exit]: async (voluntaryExit) => {
      await validateGossipVoluntaryExit(chain, db, voluntaryExit);

      // Handler

      db.voluntaryExit.add(voluntaryExit).catch((e) => {
        logger.error("Error adding attesterSlashing to pool", {}, e);
      });
    },

    [GossipType.proposer_slashing]: async (proposerSlashing) => {
      await validateGossipProposerSlashing(chain, db, proposerSlashing);

      // Handler

      db.proposerSlashing.add(proposerSlashing).catch((e) => {
        logger.error("Error adding attesterSlashing to pool", {}, e);
      });
    },

    [GossipType.attester_slashing]: async (attesterSlashing) => {
      await validateGossipAttesterSlashing(chain, db, attesterSlashing);

      // Handler

      db.attesterSlashing.add(attesterSlashing).catch((e) => {
        logger.error("Error adding attesterSlashing to pool", {}, e);
      });
    },

    [GossipType.sync_committee_contribution_and_proof]: async (contributionAndProof) => {
      await validateSyncCommitteeGossipContributionAndProof(chain, contributionAndProof);

      // Handler

      try {
        chain.syncContributionAndProofPool.add(contributionAndProof.message);
      } catch (e) {
        logger.error("Error adding to contributionAndProof pool", {}, e);
      }
    },

    [GossipType.sync_committee]: async (syncCommittee, {subnet}) => {
      const {indexInSubCommittee} = await validateGossipSyncCommittee(chain, syncCommittee, subnet);

      // Handler

      try {
        chain.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubCommittee);
      } catch (e) {
        logger.error("Error adding to syncCommittee pool", {subnet}, e);
      }
    },
  };
}
