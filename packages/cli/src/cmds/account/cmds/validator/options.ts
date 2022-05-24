import {ICliCommandOptions} from "../../../../util/index.js";
import {defaultAccountPaths} from "../../paths.js";

export interface IAccountValidatorArgs {
  keystoresDir?: string;
  secretsDir?: string;
}

export const accountValidatorOptions: ICliCommandOptions<IAccountValidatorArgs> = {
  keystoresDir: {
    description: "Directory for storing validator keystores.",
    defaultDescription: defaultAccountPaths.keystoresDir,
    type: "string",
  },

  secretsDir: {
    description: "Directory for storing validator keystore secrets.",
    defaultDescription: defaultAccountPaths.secretsDir,
    type: "string",
  },
};
