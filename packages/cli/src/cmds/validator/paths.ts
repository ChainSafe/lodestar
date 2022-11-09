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
  proposerDir: string;
};

/**
 * Defines the path structure of the validator files
 *
 * ```bash
 * $validatordataDir
 * └── validator-db
 *     └── (db files)
 * ```
 */
export function getValidatorPaths(
  args: Partial<IValidatorPaths> & Pick<IGlobalArgs, "dataDir">,
  network: string
): IValidatorPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const validatorsDbDir = args.validatorsDbDir ?? path.join(dataDir, "validator-db");

  return {
    ...globalPaths,
    validatorsDbDir,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultValidatorPaths = getValidatorPaths({dataDir: "$dataDir"}, "$network");

/**
 * Defines the path structure of the account files
 *
 * ```bash
 * $accountsdataDir
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
// Using Pick<IGlobalArgs, "dataDir"> make changes in IGlobalArgs throw a type error here
export function getAccountPaths(
  args: Partial<AccountPaths> & Pick<IGlobalArgs, "dataDir">,
  network: string
): AccountPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const keystoresDir = args.keystoresDir || path.join(dataDir, "keystores");
  const secretsDir = args.secretsDir || path.join(dataDir, "secrets");
  const remoteKeysDir = args.remoteKeysDir || path.join(dataDir, "remoteKeys");
  const proposerDir = args.proposerDir || path.join(dataDir, "proposerConfigs");
  return {
    ...globalPaths,
    keystoresDir,
    secretsDir,
    remoteKeysDir,
    proposerDir,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultAccountPaths = getAccountPaths({dataDir: "$dataDir"}, "$network");
