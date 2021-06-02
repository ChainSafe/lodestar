import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface ISyncArgs {
  "sync.isSingleNode": boolean;
  "sync.disableProcessAsChainSegment": boolean;
}

export function parseArgs(args: ISyncArgs): IBeaconNodeOptions["sync"] {
  return {
    isSingleNode: args["sync.isSingleNode"],
    disableProcessAsChainSegment: args["sync.disableProcessAsChainSegment"],
  };
}

export const options: ICliCommandOptions<ISyncArgs> = {
  "sync.isSingleNode": {
    hidden: true,
    type: "boolean",
    description:
      "Allow node to consider itself synced without being connected to a peer. \
Use only for local networks with a single node, can be dangerous in regular networks.",
    defaultDescription: String(defaultOptions.sync.isSingleNode),
    group: "sync",
  },

  "sync.disableProcessAsChainSegment": {
    hidden: true,
    type: "boolean",
    description:
      "For RangeSync disable processing batches of blocks at once. Should only be used for debugging or testing.",
    defaultDescription: String(defaultOptions.sync.disableProcessAsChainSegment),
    group: "sync",
  },
};
