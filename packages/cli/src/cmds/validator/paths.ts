import path from "node:path";
import {GlobalArgs} from "../../options/index.js";
import {GlobalPaths, getGlobalPaths} from "../../paths/global.js";

export type IValidatorPaths = {
  validatorsDbDir: string;
};

export type AccountPaths = {
  cacheDir: string;
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
  args: Partial<IValidatorPaths> & Pick<GlobalArgs, "dataDir">,
  network: string
): IValidatorPaths & GlobalPaths {
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
// Using Pick<GlobalArgs, "dataDir"> make changes in GlobalArgs throw a type error here
export function getAccountPaths(
  args: Partial<AccountPaths> & Pick<GlobalArgs, "dataDir">,
  network: string
): AccountPaths & GlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const cacheDir = args.cacheDir || path.join(dataDir, "cache");
  const keystoresDir = args.keystoresDir || path.join(dataDir, "keystores");
  const secretsDir = args.secretsDir || path.join(dataDir, "secrets");
  const remoteKeysDir = args.remoteKeysDir || path.join(dataDir, "remoteKeys");
  const proposerDir = args.proposerDir || path.join(dataDir, "proposerConfigs");
  return {
    ...globalPaths,
    cacheDir,
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
