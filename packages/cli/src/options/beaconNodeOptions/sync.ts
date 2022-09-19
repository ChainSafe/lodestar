import {IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

export interface ISyncArgs {
  "sync.isSingleNode"?: boolean;
  "sync.disableProcessAsChainSegment"?: boolean;
  "sync.backfillBatchSize"?: number;
}

export function parseArgs(args: ISyncArgs): IBeaconNodeOptions["sync"] {
  return {
    isSingleNode: args["sync.isSingleNode"],
    disableProcessAsChainSegment: args["sync.disableProcessAsChainSegment"],
    backfillBatchSize: args["sync.backfillBatchSize"],
  };
}

export const options: ICliCommandOptions<ISyncArgs> = {
  "sync.isSingleNode": {
    hidden: true,
    type: "boolean",
    description:
      "Allow node to consider itself synced without being connected to a peer. \
Use only for local networks with a single node, can be dangerous in regular networks.",
    group: "sync",
  },

  "sync.disableProcessAsChainSegment": {
    hidden: true,
    type: "boolean",
    description:
      "For RangeSync disable processing batches of blocks at once. Should only be used for debugging or testing.",
    group: "sync",
  },

  "sync.backfillBatchSize": {
    hidden: true,
    type: "number",
    description: "Batch size for backfill sync to sync/process blocks, set non zero to enable backfill sync",
    group: "sync",
  },
};
