import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiModules} from "../../types.js";
import {assertUniqueItems} from "../../utils.js";
import {getBlockResponse} from "../blocks/utils.js";

export function getBeaconRewardsApi({
  chain,
}: Pick<ApiModules, "chain">): ApplicationMethods<routes.beacon.rewards.Endpoints> {
  return {
    async getBlockRewards({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const data = await chain.getBlockRewards(block.message);
      return {data, meta: {executionOptimistic, finalized}};
    },
    async getAttestationsRewards({epoch, validatorIds}) {
      assertUniqueItems(validatorIds, "Duplicate validator IDs provided");

      const {rewards, executionOptimistic, finalized} = await chain.getAttestationsRewards(epoch, validatorIds);
      return {data: rewards, meta: {executionOptimistic, finalized}};
    },
    async getSyncCommitteeRewards({blockId, validatorIds}) {
      assertUniqueItems(validatorIds, "Duplicate validator IDs provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const data = await chain.getSyncCommitteeRewards(block.message, validatorIds);
      return {data, meta: {executionOptimistic, finalized}};
    },
  };
}
