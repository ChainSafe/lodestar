import path from "path";
import {IGlobalArgs} from "../../options";

export interface IValidatorPaths {
  validatorsDbDir: string;
  validatorDbDir: (pubkey: string) => string;
}

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
  const rootDir = options.rootDir || ".lodestart";
  const validatorsDbDir = path.join(rootDir, options.validatorsDbDir || "validator-db");
  return {
    validatorsDbDir,
    validatorDbDir: (pubkey: string) => path.join(validatorsDbDir, pubkey)
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultValidatorPaths = getValidatorPaths({rootDir: "$rootDir"});
