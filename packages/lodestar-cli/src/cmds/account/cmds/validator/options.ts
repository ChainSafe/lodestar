import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";
import {chainPreset, IChainArgs} from "../../../dev/options/chain";
import {withDefaultValue} from "../../../../util";

export interface IAccountValidatorOptions extends IGlobalArgs, IChainArgs {
  keystoresDir?: string;
  secretsDir?: string;
}

export const accountValidatorOptions = {
  chainPreset,

  keystoresDir: {
    description: withDefaultValue("Directory for storing validator keystores.", defaultAccountPaths.keystoresDir),
    normalize: true,
    type: "string",
  } as Options,

  secretsDir: {
    description: withDefaultValue("Directory for storing validator keystore secrets.", defaultAccountPaths.secretsDir),
    normalize: true,
    type: "string",
  } as Options,
};
