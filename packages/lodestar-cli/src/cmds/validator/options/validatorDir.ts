import path from "path";
import {Options} from "yargs";

export interface IValidatorDirArgs extends IGlobalArgs {
  dbDir: string;
  validatorDir: string;
}

import {IGlobalArgs} from "../../../options";

export const dbDir = (args: IGlobalArgs): Options => ({
  description: "Data directory for validator databases",
  alias: ["dbDir", "db.dir", "db.name"],
  hidden: true,
  default: path.join(args.rootDir, "validator-db"),
  normalize: true,
  type: "string",
});

export const validatorDir = (args: IGlobalArgs): Options => ({
  description: "Data directory for keys and secrets",
  default: path.join(args.rootDir, "validator"),
  hidden: true,
  type: "string",
});
