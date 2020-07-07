import {CommandBuilder} from "yargs";
import {IGlobalArgs} from "../../options";
import {chainPreset, IChainArgs} from "../dev/options/chain";
import {defaultPaths, IAccountPaths, IValidatorPaths} from "../account/paths";

export interface IValidatorCliOptions extends IGlobalArgs, IAccountPaths, IValidatorPaths, IChainArgs {
  server: string;
  force: boolean;
}

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  chainPreset,

  server: {
    description: "Address to connect to BeaconNode",
    default: "http://127.0.0.1:9596",
    alias: ["server"],
    type: "string"
  },
  
  validatorDir:  {
    description: `Data directory for keys and secrets.\n[default: ${defaultPaths.validatorDir}]`,
    normalize: true,
    type: "string",
  },

  force: {
    description: "Open validators even if there's a lockfile. Use with caution",
    type: "boolean"
  },

  validatorsDbDir: {
    description: `Data directory for validator databases.\n[default: ${defaultPaths.validatorsDbDir}]`,
    alias: ["dbDir", "db.dir", "db.name"],
    normalize: true,
    type: "string",
  },

  keystoresDir: {
    description: `The directory for storing validator keystores.\n[default: ${defaultPaths.keystoresDir}]`,
    normalize: true,
    type: "string",
  },

  secretsDir: {
    description: `The directory for storing validator keystore secrets.\n[default: ${defaultPaths.secretsDir}]`,
    normalize: true,
    type: "string",
  },
};

