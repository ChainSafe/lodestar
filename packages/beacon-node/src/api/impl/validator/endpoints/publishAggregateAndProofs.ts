import {ServerApi, routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {ApiModules} from "../../types.js";
import {AttestationError, AttestationErrorCode} from "../../../../chain/errors/attestationError.js";
import {GossipAction} from "../../../../chain/errors/gossipValidation.js";
import {validateApiAggregateAndProof} from "../../../../chain/validation/aggregateAndProof.js";
import {validateGossipFnRetryUnknownRoot} from "../../../../network/processor/gossipHandlers.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildPublishAggregateAndProofs(
  {chain, metrics, network, logger}: ApiModules,
  {notWhileSyncing}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["publishAggregateAndProofs"] {
  return async function publishAggregateAndProofs(signedAggregateAndProofs) {
    notWhileSyncing();

    const seenTimestampSec = Date.now() / 1000;
    const errors: Error[] = [];
    const fork = chain.config.getForkName(chain.clock.currentSlot);

    await Promise.all(
      signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
        try {
          // TODO: Validate in batch
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          const validateFn = () => validateApiAggregateAndProof(fork, chain, signedAggregateAndProof);
          const {slot, beaconBlockRoot} = signedAggregateAndProof.message.aggregate.data;
          // when a validator is configured with multiple beacon node urls, this attestation may come from another beacon node
          // and the block hasn't been in our forkchoice since we haven't seen / processing that block
          // see https://github.com/ChainSafe/lodestar/issues/5098
          const {indexedAttestation, committeeIndices, attDataRootHex} = await validateGossipFnRetryUnknownRoot(
            validateFn,
            network,
            chain,
            slot,
            beaconBlockRoot
          );

          chain.aggregatedAttestationPool.add(
            signedAggregateAndProof.message.aggregate,
            attDataRootHex,
            indexedAttestation.attestingIndices.length,
            committeeIndices
          );
          const sentPeers = await network.publishBeaconAggregateAndProof(signedAggregateAndProof);
          metrics?.onPoolSubmitAggregatedAttestation(seenTimestampSec, indexedAttestation, sentPeers);
        } catch (e) {
          if (e instanceof AttestationError && e.type.code === AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN) {
            logger.debug("Ignoring known signedAggregateAndProof");
            return; // Ok to submit the same aggregate twice
          }

          errors.push(e as Error);
          logger.error(
            `Error on publishAggregateAndProofs [${i}]`,
            {
              slot: signedAggregateAndProof.message.aggregate.data.slot,
              index: signedAggregateAndProof.message.aggregate.data.index,
            },
            e as Error
          );
          if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
            chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "api_reject");
          }
        }
      })
    );

    if (errors.length > 1) {
      throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
    } else if (errors.length === 1) {
      throw errors[0];
    }
  };
}
