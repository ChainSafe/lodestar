import {toHexString} from "@chainsafe/ssz";
import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {ApiError} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildProduceSyncCommitteeContribution(
  {chain, network, metrics}: ApiModules,
  {notOnOptimisticBlockRoot}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["produceSyncCommitteeContribution"] {
  /**
   * GET `/eth/v1/validator/sync_committee_contribution`
   *
   * Requests that the beacon node produce a sync committee contribution.
   *
   * https://github.com/ethereum/beacon-APIs/pull/138
   *
   * @param slot The slot for which a sync committee contribution should be created.
   * @param subcommitteeIndex The subcommittee index for which to produce the contribution.
   * @param beaconBlockRoot The block root for which to produce the contribution.
   */
  return async function produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot) {
    // when a validator is configured with multiple beacon node urls, this beaconBlockRoot may come from another beacon node
    // and it hasn't been in our forkchoice since we haven't seen / processing that block
    // see https://github.com/ChainSafe/lodestar/issues/5063
    if (!chain.forkChoice.hasBlock(beaconBlockRoot)) {
      const rootHex = toHexString(beaconBlockRoot);
      network.searchUnknownSlotRoot({slot, root: rootHex});
      // if result of this call is false, i.e. block hasn't seen after 1 slot then the below notOnOptimisticBlockRoot call will throw error
      await chain.waitForBlock(slot, rootHex);
    }

    // Check the execution status as validator shouldn't contribute on an optimistic head
    notOnOptimisticBlockRoot(beaconBlockRoot);

    const contribution = chain.syncCommitteeMessagePool.getContribution(subcommitteeIndex, slot, beaconBlockRoot);
    if (!contribution) throw new ApiError(500, "No contribution available");

    metrics?.production.producedSyncContributionParticipants.observe(
      contribution.aggregationBits.getTrueBitIndexes().length
    );

    return {data: contribution};
  };
}
