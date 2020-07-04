import path from "path";
import {IGlobalArgs} from "../../options";

export interface IValidatorPaths extends Pick<IGlobalArgs, "rootDir"> {
  dbDir?: string;
  validatorDir?: string;
  keystoresDir?: string;
  secretsDir?: string;
}

/**
 * Defines the dynamic path structure of the validator files
 */
export function processValidatorPaths(options: IValidatorPaths): Required<IValidatorPaths> {
  const rootDir = options.rootDir;
  const dbDir = path.join(rootDir, options.dbDir || "validator-db");
  const validatorDir = path.join(rootDir, options.validatorDir || "validator");
  const keystoresDir = path.join(validatorDir, options.keystoresDir || "validators");
  const secretsDir = path.join(validatorDir, options.keystoresDir || "secrets");
  return {rootDir, dbDir, validatorDir, keystoresDir, secretsDir};
}