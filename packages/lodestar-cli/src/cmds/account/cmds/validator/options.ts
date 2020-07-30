import {Options} from "yargs";
import {IGlobalArgs, IParamsOptions, paramsOptions} from "../../../../options";
import {defaultAccountPaths} from "../../paths";

export type IAccountValidatorOptions =
  IGlobalArgs & IParamsOptions &
  {
    keystoresDir?: string;
    secretsDir?: string;
  };

export const accountValidatorOptions = {
  ...paramsOptions,

  keystoresDir: {
    description: "Directory for storing validator keystores.",
    defaultDescription: defaultAccountPaths.keystoresDir,
    normalize: true,
    type: "string",
  } as Options,

  secretsDir: {
    description: "Directory for storing validator keystore secrets.",
    defaultDescription: defaultAccountPaths.secretsDir,
    normalize: true,
    type: "string",
  } as Options,
};
