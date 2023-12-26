import {ServerApi, routes} from "@lodestar/api";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {CommitteeSubscription} from "../../../../network/subnets/interface.js";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildPrepareSyncCommitteeSubnets(
  {network, metrics}: ApiModules,
  {notWhileSyncing}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["prepareSyncCommitteeSubnets"] {
  /**
   * POST `/eth/v1/validator/sync_committee_subscriptions`
   *
   * Subscribe to a number of sync committee subnets.
   * Sync committees are not present in phase0, but are required for Altair networks.
   * Subscribing to sync committee subnets is an action performed by VC to enable network participation in Altair networks,
   * and only required if the VC has an active validator in an active sync committee.
   *
   * https://github.com/ethereum/beacon-APIs/pull/136
   */
  return async function prepareSyncCommitteeSubnets(subscriptions) {
    notWhileSyncing();

    // A `validatorIndex` can be in multiple subnets, so compute the CommitteeSubscription with double for loop
    const subs: CommitteeSubscription[] = [];
    for (const sub of subscriptions) {
      for (const committeeIndex of sub.syncCommitteeIndices) {
        const subnet = Math.floor(committeeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
        subs.push({
          validatorIndex: sub.validatorIndex,
          subnet: subnet,
          // Subscribe until the end of `untilEpoch`: https://github.com/ethereum/beacon-APIs/pull/136#issuecomment-840315097
          slot: computeStartSlotAtEpoch(sub.untilEpoch + 1),
          isAggregator: true,
        });
      }
    }

    await network.prepareSyncCommitteeSubnets(subs);

    if (metrics) {
      for (const subscription of subscriptions) {
        metrics.registerLocalValidatorInSyncCommittee(subscription.validatorIndex, subscription.untilEpoch);
      }
    }
  };
}
