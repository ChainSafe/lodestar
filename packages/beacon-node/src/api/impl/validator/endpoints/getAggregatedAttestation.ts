import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildGetAggregatedAttestation(
  {chain, metrics}: ApiModules,
  {notWhileSyncing, waitForSlotWithDisparity}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["getAggregatedAttestation"] {
  return async function getAggregatedAttestation(attestationDataRoot, slot) {
    notWhileSyncing();

    await waitForSlotWithDisparity(slot); // Must never request for a future slot > currentSlot

    const aggregate = chain.attestationPool.getAggregate(slot, attestationDataRoot);
    metrics?.production.producedAggregateParticipants.observe(aggregate.aggregationBits.getTrueBitIndexes().length);

    return {
      data: aggregate,
    };
  };
}
