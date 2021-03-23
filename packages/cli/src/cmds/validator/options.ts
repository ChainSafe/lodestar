import {LogLevel} from "@chainsafe/lodestar-utils";
import {ICliCommandOptions} from "../../util";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorArgs} from "../account/cmds/validator/options";
import {beaconExtraOptions, beaconPathsOptions} from "../beacon/options";

export type IValidatorCliArgs = IAccountValidatorArgs & {
  validatorsDbDir?: string;
  server: string;
  force: boolean;
  graffiti: string;
  logFile: string;
  logLevel: LogLevel;
  logLevelFile: LogLevel;
};

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...accountValidatorOptions,
  logFile: beaconPathsOptions.logFile,
  logLevel: beaconExtraOptions.logLevel,
  logLevelFile: beaconExtraOptions.logLevelFile,

  validatorsDbDir: {
    description: "Data directory for validator databases.",
    defaultDescription: defaultValidatorPaths.validatorsDbDir,
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
};
