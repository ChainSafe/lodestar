import {IBeaconNodeOptions, defaultOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type DbArgs = {
  "db.saveBlindedBlocks"?: boolean;
};

export function parseArgs(args: DbArgs): Partial<IBeaconNodeOptions["db"]> {
  return {
    saveBlindedBlocks: args["db.saveBlindedBlocks"],
  };
}

export const dbOptions: CliCommandOptions<DbArgs> = {
  "db.saveBlindedBlocks": {
    type: "boolean",
    description: "Save blinded blocks to the database",
    defaultDescription: String(defaultOptions.db.saveBlindedBlocks),
    group: "db",
  },
};
