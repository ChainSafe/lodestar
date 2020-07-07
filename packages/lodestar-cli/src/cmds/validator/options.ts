import {CommandBuilder} from "yargs";
import {IGlobalArgs} from "../../options";
import {chainPreset, IChainArgs} from "../dev/options/chain";
import {processValidatorPaths, IValidatorPaths} from "./paths";

export interface IValidatorCliOptions extends IGlobalArgs, IValidatorPaths, IChainArgs {
  server: string;
  force: boolean;
}

// Constructs representations of the path structure to show in command's description
const defaultPaths = processValidatorPaths({rootDir: "$rootDir"});

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

  dbDir: {
    description: `Data directory for validator databases.\n[default: ${defaultPaths.dbDir}]`,
    alias: ["dbDir", "db.dir", "db.name"],
    normalize: true,
    type: "string",
  },

  keystoresDir: {
    description: `The directory for storing validator keystores.\n[default: ${defaultPaths.validatorsDir}]`,
    normalize: true,
    type: "string",
  },

  secretsDir: {
    description: `The directory for storing validator keystore secrets.\n[default: ${defaultPaths.secretsDir}]`,
    normalize: true,
    type: "string",
  },
};

