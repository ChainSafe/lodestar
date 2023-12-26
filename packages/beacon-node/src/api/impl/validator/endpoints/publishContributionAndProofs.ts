import {ServerApi, routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {GossipAction} from "../../../../chain/errors/gossipValidation.js";
import {SyncCommitteeError} from "../../../../chain/errors/syncCommitteeError.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../../chain/validation/syncCommitteeContributionAndProof.js";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildPublishContributionAndProofs(
  {chain, network, logger}: ApiModules,
  {notWhileSyncing}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["publishContributionAndProofs"] {
  /**
   * POST `/eth/v1/validator/contribution_and_proofs`
   *
   * Publish multiple signed sync committee contribution and proofs
   *
   * https://github.com/ethereum/beacon-APIs/pull/137
   */
  return async function publishContributionAndProofs(contributionAndProofs) {
    notWhileSyncing();

    const errors: Error[] = [];

    await Promise.all(
      contributionAndProofs.map(async (contributionAndProof, i) => {
        try {
          // TODO: Validate in batch
          const {syncCommitteeParticipantIndices} = await validateSyncCommitteeGossipContributionAndProof(
            chain,
            contributionAndProof,
            true // skip known participants check
          );
          chain.syncContributionAndProofPool.add(contributionAndProof.message, syncCommitteeParticipantIndices.length);
          await network.publishContributionAndProof(contributionAndProof);
        } catch (e) {
          errors.push(e as Error);
          logger.error(
            `Error on publishContributionAndProofs [${i}]`,
            {
              slot: contributionAndProof.message.contribution.slot,
              subcommitteeIndex: contributionAndProof.message.contribution.subcommitteeIndex,
            },
            e as Error
          );
          if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
            chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "api_reject");
          }
        }
      })
    );

    if (errors.length > 1) {
      throw Error("Multiple errors on publishContributionAndProofs\n" + errors.map((e) => e.message).join("\n"));
    } else if (errors.length === 1) {
      throw errors[0];
    }
  };
}
