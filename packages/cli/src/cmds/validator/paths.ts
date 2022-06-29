import path from "node:path";
import {IGlobalArgs} from "../../options/index.js";
import {IGlobalPaths, getGlobalPaths} from "../../paths/global.js";

export type IValidatorPaths = {
  validatorsDbDir: string;
};

export type AccountPaths = {
  keystoresDir: string;
  secretsDir: string;
  remoteKeysDir: string;
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

/**
 * Defines the path structure of the account files
 *
 * ```bash
 * $accountsRootDir
 * ├── secrets
 * |   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037...
 * |   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f...
 * ├── keystores
 * |   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037...
 * |   |   ├── eth1-deposit-data.rlp
 * |   |   ├── eth1-deposit-gwei.txt
 * |   |   └── voting-keystore.json
 * |   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f...
 * |       ├── eth1-deposit-data.rlp
 * |       ├── eth1-deposit-gwei.txt
 * |       └── voting-keystore.json
 * └── remoteKeys
 *     └── 0xa329f988c16993768299643d918a2694892c012765d896a16f.json
 * ```
 */
// Using Pick<IGlobalArgs, "rootDir"> make changes in IGlobalArgs throw a type error here
export function getAccountPaths(
  args: Partial<AccountPaths> & Pick<IGlobalArgs, "rootDir">
): AccountPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args);

  const rootDir = globalPaths.rootDir;
  const keystoresDir = args.keystoresDir || path.join(rootDir, "keystores");
  const secretsDir = args.secretsDir || path.join(rootDir, "secrets");
  const remoteKeysDir = args.remoteKeysDir || path.join(rootDir, "remoteKeys");
  return {
    ...globalPaths,
    keystoresDir,
    secretsDir,
    remoteKeysDir,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultAccountPaths = getAccountPaths({rootDir: "$rootDir"});
