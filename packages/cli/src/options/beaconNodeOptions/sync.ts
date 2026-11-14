import {IBeaconNodeOptions, defaultOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export type SyncArgs = {
  "sync.isSingleNode"?: boolean;
  "sync.disableProcessAsChainSegment"?: boolean;
  "sync.disableRangeSync"?: boolean;
  "sync.backfill"?: boolean;
  "sync.slotImportTolerance"?: number;
};

export function parseArgs(args: SyncArgs): IBeaconNodeOptions["sync"] {
  return {
    isSingleNode: args["sync.isSingleNode"],
    disableProcessAsChainSegment: args["sync.disableProcessAsChainSegment"],
    disableRangeSync: args["sync.disableRangeSync"],
    backfill: args["sync.backfill"] ?? defaultOptions.sync.backfill,
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

  "sync.backfill": {
    type: "boolean",
    description:
      "Backfill blocks and custody data columns below the checkpoint the node was synced from, down to `MIN_EPOCHS_FOR_BLOCK_REQUESTS` epochs behind the current epoch, to serve them to peers.",
    default: defaultOptions.sync.backfill,
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
};
