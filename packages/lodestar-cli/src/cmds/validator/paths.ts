import path from "path";
import {IGlobalArgs} from "../../options";
import {IGlobalPaths, getGlobalPaths} from "../../paths/global";

export type IValidatorPaths = IGlobalPaths & {
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
export function getValidatorPaths(options: Partial<IValidatorPaths> & Pick<IGlobalArgs, "rootDir">): IValidatorPaths {
  options = {
    ...options,
    ...getGlobalPaths(options),
  };
  const rootDir = options.rootDir;
  const validatorsDbDir = path.join(rootDir, options.validatorsDbDir || "validator-db");
  return {
    ...options,
    validatorsDbDir,
    validatorDbDir: (pubkey: string) => path.join(validatorsDbDir, pubkey)
  } as IValidatorPaths;
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultValidatorPaths = getValidatorPaths({rootDir: "$rootDir"});
