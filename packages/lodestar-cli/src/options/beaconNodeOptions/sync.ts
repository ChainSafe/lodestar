import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {ICliCommandOptions} from "../../util";

export interface IBeaconNodeSyncArgs {
  "sync.minPeers": number;
}

export function toSyncOptions(args: IBeaconNodeSyncArgs): IBeaconNodeOptions["sync"] {
  return {
    minPeers: args["sync.minPeers"],
  };
}

export const syncOptions: ICliCommandOptions<IBeaconNodeSyncArgs> = {
  "sync.minPeers": {
    type: "number",
    description: "Minimum number of peers before the beacon chain starts syncing",
    defaultDescription: String(defaultOptions.sync.minPeers),
    group: "sync",
  },
};
