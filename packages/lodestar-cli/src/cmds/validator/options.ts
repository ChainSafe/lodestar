import {CommandBuilder} from "yargs";
import {IGlobalArgs} from "../../options";
import {chainPreset, IChainArgs} from "../dev/options/chain";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorOptions} from "../account/cmds/validator/options";

export interface IValidatorCliOptions extends IGlobalArgs, IAccountValidatorOptions, IChainArgs {
  validatorsDbDir?: string;
  server: string;
  force: boolean;
}

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  ...accountValidatorOptions,
  chainPreset,

  validatorsDbDir: {
    description: `Data directory for validator databases.\n[default: ${defaultValidatorPaths.validatorsDbDir}]`,
    alias: ["dbDir", "db.dir", "db.name"],
    normalize: true,
    type: "string",
  },

  server: {
    description: "Address to connect to BeaconNode",
    default: "http://127.0.0.1:9596",
    alias: ["server"],
    type: "string"
  },

  force: {
    description: "Open validators even if there's a lockfile. Use with caution",
    type: "boolean"
  }
};

