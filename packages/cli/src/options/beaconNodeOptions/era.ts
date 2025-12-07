import {EraOptions, defaultEraOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export type EraArgs = {
  "era.dir"?: string;
  "era.archiveDir"?: string;
};

export function parseArgs(args: EraArgs): EraOptions {
  return {
    dir: args["era.dir"] ?? defaultEraOptions.dir,
    archiveDir: args["era.archiveDir"] ?? defaultEraOptions.archiveDir,
  };
}

export const options: CliCommandOptions<EraArgs> = {
  "era.dir": {
    type: "string",
    description:
      "Directory containing ERA files to serve historical data from. When set, the beacon node will use ERA files as a data source for historical blocks and states.",
    default: defaultEraOptions.dir,
    group: "era",
  },
  "era.archiveDir": {
    type: "string",
    description:
      "Directory to write archived ERA files to. When set, blocks older than MIN_EPOCHS_FOR_BLOCK_REQUESTS will be written to ERA files and pruned from the database. Archived blocks are served via beacon API but not on P2P.",
    default: defaultEraOptions.archiveDir,
    group: "era",
  },
};
