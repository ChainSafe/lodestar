import {ApplicationMethods, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {resolveBlockId} from "../blocks/utils.js";

export function getBeaconRewardsApi({
  chain,
}: Pick<ApiModules, "chain">): ApplicationMethods<routes.beacon.rewards.Endpoints> {
  return {
    async getBlockRewards({blockId}) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      const data = await chain.getBlockRewards(block.message);
      return {data, meta: {executionOptimistic}};
    },
    async getSyncCommitteeRewards({blockId, validatorIds}) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      const data = await chain.getSyncCommitteeRewards(block.message, validatorIds);
      return {data, meta: {executionOptimistic}};
    },
  };
}
