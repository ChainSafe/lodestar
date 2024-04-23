import {routes, ServerApi} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {resolveBlockId} from "../blocks/utils.js";

export function getBeaconRewardsApi({chain}: Pick<ApiModules, "chain">): ServerApi<routes.beacon.rewards.Api> {
  return {
    async getBlockRewards(blockId) {
      const {block, executionOptimistic, finalized} = await resolveBlockId(chain, blockId);
      const data = await chain.getBlockRewards(block.message);
      return {data, executionOptimistic, finalized};
    },
    async getAttestationsRewards(epoch, validatorIds) {
      const {rewards, executionOptimistic, finalized} = await chain.getAttestationsRewards(epoch, validatorIds);
      return {data: rewards, executionOptimistic, finalized};
    },
    async getSyncCommitteeRewards(blockId, validatorIds) {
      const {block, executionOptimistic, finalized} = await resolveBlockId(chain, blockId);
      const data = await chain.getSyncCommitteeRewards(block.message, validatorIds);
      return {data, executionOptimistic, finalized};
    },
  };
}
