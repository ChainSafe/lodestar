import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";
import {chainPreset, IChainArgs} from "../../../dev/options/chain";

export interface IAccountValidatorOptions extends IGlobalArgs, IChainArgs {
  keystoresDir?: string;
  secretsDir?: string;
}

export const accountValidatorOptions = {
  chainPreset,

  keystoresDir: {
    description: `The directory for storing validator keystores.\n[default: ${defaultAccountPaths.keystoresDir}]`,
    normalize: true,
    type: "string",
  } as Options,

  secretsDir: {
    description: `The directory for storing validator keystore secrets.\n[default: ${defaultAccountPaths.secretsDir}]`,
    normalize: true,
    type: "string",
  } as Options,
};
