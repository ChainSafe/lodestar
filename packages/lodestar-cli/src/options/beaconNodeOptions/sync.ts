import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const syncOptions = {
  "sync.minPeers": {
    type: "number",
    description: "Minimum number of peers before the beacon chain starts syncing",
    defaultDescription: String(defaultOptions.sync.minPeers),
    group: "sync",
  } as Options
};
