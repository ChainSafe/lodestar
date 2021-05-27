import {routes} from "@chainsafe/lodestar-api";
import {getLatestWeakSubjectivityCheckpointEpoch} from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/util/weakSubjectivity";
import {ApiModules} from "../types";

export function getLodestarApi({
  chain,
  config,
  sync,
}: Pick<ApiModules, "chain" | "config" | "sync">): routes.lodestar.Api {
  return {
    /**
     * Get a wtfnode dump of all active handles
     * Will only load the wtfnode after the first call, and registers async hooks
     * and other listeners to the global process instance
     */
    async getWtfNode() {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

      // eslint-disable-next-line
      const wtfnode = require("wtfnode");
      const logs: string[] = [];
      function logger(...args: string[]): void {
        for (const arg of args) logs.push(arg);
      }
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      wtfnode.setLogger("info", logger);
      wtfnode.setLogger("warn", logger);
      wtfnode.setLogger("error", logger);
      wtfnode.dump();
      return {data: logs.join("\n")};
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },
  };
}
