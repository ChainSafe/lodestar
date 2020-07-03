import {CommandBuilder} from "yargs";

export interface IValidatorCliOptions {
  datadir: string;
  server: string;
  spec: string;
  validatorsDir: string;
  secretsDir: string;
}

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  datadir: {
    default: "validator",
    alias: ["datadir", "d"],
    description: "Data directory for keys and databases",
    type: "string"
  },

  server: {
    default: "http://localhost:5052/",
    alias: ["server"],
    description: "Address to connect to BeaconNode",
    type: "string"
  },

  spec: {
    default: "mainnet",
    alias: ["spec", "s"],
    description: "Specifies the default eth2 spec type",
    choices: ["mainnet", "minimal", "interop"],
    type: "string"
  },

  validatorsDir: {
    default: "~/.lodestar/validators",
    alias: ["validators-dir"],
    description: "The directory for storing validator keystores",
    type: "string"
  },

  secretsDir: {
    default: "~/.lodestar/secrets",
    alias: ["secrets-dir"],
    description: "The directory for storing validator keystore secrets",
    type: "string"
  }
};