import path from "node:path";
import {IGlobalArgs} from "../../options";
import {IGlobalPaths, getGlobalPaths} from "../../paths/global";

export type IValidatorPaths = {
  validatorsDbDir: string;
};

/**
 * Defines the path structure of the validator files
 *
 * ```bash
 * $validatorRootDir
 * └── validator-db
 *     └── (db files)
 * ```
 */
export function getValidatorPaths(
  args: Partial<IValidatorPaths> & Pick<IGlobalArgs, "rootDir">
): IValidatorPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args);

  const rootDir = globalPaths.rootDir;
  const validatorsDbDir = args.validatorsDbDir || path.join(rootDir, "validator-db");
  return {
    ...globalPaths,
    validatorsDbDir,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultValidatorPaths = getValidatorPaths({rootDir: "$rootDir"});
