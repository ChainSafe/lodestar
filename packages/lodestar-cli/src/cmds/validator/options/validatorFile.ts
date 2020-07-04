import * as path from "path";
import {Options} from "yargs";

import {IValidatorDirArgs}  from "./validatorDir";

export interface IValidatorFileArgs extends IValidatorDirArgs {
  dbDir: string;
  keystoresDir: string;
  secretsDir: string;
}

export const keystoresDir = (args: IValidatorDirArgs): Options => ({
  alias: ["keystoresDir"],
  default: path.join(args.validatorDir, "validators"),
  description: "The directory for storing validator keystores",
  normalize: true,
  type: "string",
});

export const secretsDir = (args: IValidatorDirArgs): Options => ({
  alias: ["secretsDir"],
  default: path.join(args.validatorDir, "secrets"),
  description: "The directory for storing validator keystore secrets",
  normalize: true,
  type: "string",
});
