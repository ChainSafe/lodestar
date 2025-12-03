import {EraOptions, defaultEraOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export type EraArgs = {
  "era.dir"?: string;
};

export function parseArgs(args: EraArgs): EraOptions {
  return {
    dir: args["era.dir"] ?? defaultEraOptions.dir,
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
};
