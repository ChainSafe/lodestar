import {routes} from "@chainsafe/lodestar-api";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ApiModules} from "../types";

export function getLodestarApi({
  chain,
  config,
  sync,
}: Pick<ApiModules, "chain" | "config" | "sync">): routes.lodestar.Api {
  let writingHeapdump = false;

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

    async writeHeapdump(dirpath = ".") {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

      if (writingHeapdump) {
        throw Error("Already writing heapdump");
      }
      // Lazily import NodeJS only modules
      const fs = await import("fs");
      const v8 = await import("v8");
      const snapshotStream = v8.getHeapSnapshot();
      // It's important that the filename end with `.heapsnapshot`,
      // otherwise Chrome DevTools won't open it.
      const filepath = `${dirpath}/${new Date().toISOString()}.heapsnapshot`;
      const fileStream = fs.createWriteStream(filepath);
      try {
        writingHeapdump = true;
        await new Promise<void>((resolve) => {
          snapshotStream.pipe(fileStream);
          snapshotStream.on("end", () => {
            resolve();
          });
        });
        return {data: {filepath}};
      } finally {
        writingHeapdump = false;
      }
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: allForks.getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },
  };
}
