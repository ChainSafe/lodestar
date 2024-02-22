import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export type SyncArgs = {
  "sync.isSingleNode"?: boolean;
  "sync.disableProcessAsChainSegment"?: boolean;
  "sync.disableRangeSync"?: boolean;
  "sync.backfillBatchSize"?: number;
  "sync.slotImportTolerance"?: number;
};

export function parseArgs(args: SyncArgs): IBeaconNodeOptions["sync"] {
  return {
    isSingleNode: args["sync.isSingleNode"],
    disableProcessAsChainSegment: args["sync.disableProcessAsChainSegment"],
    backfillBatchSize: args["sync.backfillBatchSize"] ?? defaultOptions.sync.backfillBatchSize,
    disableRangeSync: args["sync.disableRangeSync"],
    slotImportTolerance: args["sync.slotImportTolerance"] ?? defaultOptions.sync.slotImportTolerance,
  };
}

export const options: CliCommandOptions<SyncArgs> = {
  "sync.isSingleNode": {
    hidden: true,
    type: "boolean",
    description:
      "Allow node to consider itself synced without being connected to a peer. \
Use only for local networks with a single node, can be dangerous in regular networks.",
    defaultDescription: String(defaultOptions.sync.isSingleNode),
    group: "sync",
  },

  "sync.disableRangeSync": {
    hidden: true,
    type: "boolean",
    description: "Disable range sync completely. Should only be used for debugging or testing.",
    defaultDescription: String(defaultOptions.sync.disableRangeSync),
    group: "sync",
  },

  "sync.slotImportTolerance": {
    hidden: true,
    type: "number",
    description: "Number of slot tolerance to trigger range sync and to measure if node is synced.",
    defaultDescription: String(defaultOptions.sync.slotImportTolerance),
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

  "sync.backfillBatchSize": {
    hidden: true,
    type: "number",
    description: "Batch size for backfill sync to sync/process blocks, set non zero to enable backfill sync",
    defaultDescription: String(defaultOptions.sync.backfillBatchSize),
    group: "sync",
  },
};
