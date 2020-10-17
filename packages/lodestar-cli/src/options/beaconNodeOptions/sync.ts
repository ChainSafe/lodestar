import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {ICliCommandOptions} from "../../util";

export interface IArgs {
  "sync.minPeers": number;
}

export function parseArgs(args: IArgs): IBeaconNodeOptions["sync"] {
  return {
    minPeers: args["sync.minPeers"],
  };
}

export const options: ICliCommandOptions<IArgs> = {
  "sync.minPeers": {
    type: "number",
    description: "Minimum number of peers before the beacon chain starts syncing",
    defaultDescription: String(defaultOptions.sync.minPeers),
    group: "sync",
  },
};
