import path from "path";
import {IGlobalArgs} from "../../options";
import {IGlobalPaths, getGlobalPaths} from "../../paths/global";
import {joinIfRelative} from "../../util";

export type IValidatorPaths = {
  validatorsDbDir: string;
  validatorDbDir: (pubkey: string) => string;
};

/**
 * Defines the path structure of the validator files
 *
 * ```bash
 * $validatorRootDir
 * └── validator-db
 *     └── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037...
 *         └── (db files)
 * ```
 */
export function getValidatorPaths(
  args: Partial<IValidatorPaths> & Pick<IGlobalArgs, "rootDir">
): IValidatorPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args);

  const rootDir = globalPaths.rootDir;
  const validatorsDbDir = joinIfRelative(rootDir, args.validatorsDbDir || "validator-db");
  return {
    ...globalPaths,
    validatorsDbDir,
    validatorDbDir: (pubkey: string) => path.join(validatorsDbDir, pubkey),
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultValidatorPaths = getValidatorPaths({rootDir: "$rootDir"});
