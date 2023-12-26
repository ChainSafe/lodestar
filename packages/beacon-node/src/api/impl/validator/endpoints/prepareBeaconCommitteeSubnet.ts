import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {computeSubnetForCommitteesAtSlot} from "../utils.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildPrepareBeaconCommitteeSubnet(
  {metrics, network}: ApiModules,
  {notWhileSyncing}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["prepareBeaconCommitteeSubnet"] {
  return async function prepareBeaconCommitteeSubnet(subscriptions) {
    notWhileSyncing();

    await network.prepareBeaconCommitteeSubnets(
      subscriptions.map(({validatorIndex, slot, isAggregator, committeesAtSlot, committeeIndex}) => ({
        validatorIndex: validatorIndex,
        subnet: computeSubnetForCommitteesAtSlot(slot, committeesAtSlot, committeeIndex),
        slot: slot,
        isAggregator: isAggregator,
      }))
    );

    // TODO:
    // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
    // required subnets.

    if (metrics) {
      for (const subscription of subscriptions) {
        metrics.registerLocalValidator(subscription.validatorIndex);
      }
    }
  };
}
