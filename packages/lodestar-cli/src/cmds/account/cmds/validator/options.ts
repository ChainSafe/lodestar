import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultPaths} from "../../paths";
import {chainPreset, IChainArgs} from "../../../dev/options/chain";

export interface IAccountValidatorOptions extends IGlobalArgs, IChainArgs {
  keystoresDir?: string;
  secretsDir?: string;
}

export const accountValidatorOptions: {[key: string]: Options} = {
  chainPreset,

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
