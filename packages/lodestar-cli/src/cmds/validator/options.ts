import {ICliCommandOptions} from "../../util";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorArgs} from "../account/cmds/validator/options";
import {beaconOptions} from "../beacon/options";
import {LogLevels} from "@chainsafe/lodestar-utils";

export type IValidatorCliArgs = IAccountValidatorArgs & {
  validatorsDbDir?: string;
  server: string;
  force: boolean;
  graffiti: string;
  logFile: string;
  logLevel: string;
};

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...accountValidatorOptions,
  logFile: beaconOptions.logFile,

  validatorsDbDir: {
    description: "Data directory for validator databases.",
    defaultDescription: defaultValidatorPaths.validatorsDbDir,
    alias: ["dbDir", "db.dir", "db.name"],
    normalize: true,
    type: "string",
  },

  server: {
    description: "Address to connect to BeaconNode",
    default: "http://127.0.0.1:9596",
    type: "string",
  },

  force: {
    description: "Open validators even if there's a lockfile. Use with caution",
    type: "boolean",
  },

  graffiti: {
    description: "Specify your custom graffiti to be included in blocks (plain UTF8 text, 32 characters max)",
    // Don't use a default here since it should be computed only if necessary by getDefaultGraffiti()
    type: "string",
  },

  logLevel: {
    description: "Set the log level for the winston logger.",
    choices: LogLevels,
    type: "string",
  },
};
