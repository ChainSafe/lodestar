import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";

export type IAccountValidatorOptions = 
  IGlobalArgs & 
  {
    keystoresDir?: string;
    secretsDir?: string;
  };

export const accountValidatorOptions = {
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
