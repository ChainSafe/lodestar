import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface ISyncArgs {
  "sync.minPeers": number;
}

export function parseArgs(args: ISyncArgs): IBeaconNodeOptions["sync"] {
  return {
    minPeers: args["sync.minPeers"],
  };
}

export const options: ICliCommandOptions<ISyncArgs> = {
  "sync.minPeers": {
    type: "number",
    description: "Minimum number of peers before the beacon chain starts syncing",
    defaultDescription: String(defaultOptions.sync.minPeers),
    group: "sync",
  },
};
