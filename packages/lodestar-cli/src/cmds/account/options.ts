import {CommandBuilder} from "yargs";
import {IGlobalArgs} from "../../options";
import {chainPreset, IChainArgs} from "../dev/options/chain";
import {processValidatorPaths, IValidatorPaths} from "./paths";

export interface IValidatorCliOptions extends IGlobalArgs, IValidatorPaths, IChainArgs {
  server: string;
}

/**
 * Constructs representations of the path structure to show in command's description
 */
const defaultPaths = processValidatorPaths({rootDir: "$rootDir"});

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  baseDir: {
    description: `A path containing Eth2 EIP-2386 wallets.\n[default: ${defaultPaths..baseDir}]`
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

