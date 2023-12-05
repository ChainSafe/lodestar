import {routes, ServerApi} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import { resolveBlockId } from "../blocks/utils.js";

export function getBeaconRewardsApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.beacon.rewards.Api> {

  return {
    async getProposerRewards(blockId) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      const data = await chain.getBlockRewards(block.message);
      return {data, executionOptimistic};
    }
  };
}
