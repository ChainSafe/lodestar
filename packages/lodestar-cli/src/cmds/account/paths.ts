import path from "path";
import {IGlobalArgs} from "../../options";

export interface IAccountPaths {
  keystoresDir: string;
  secretsDir: string;
  walletsDir: string;
}

export interface IValidatorPaths {
  validatorsDbDir: string;
  validatorDbDir: (pubkey: string) => string;
}

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
 * ├── wallet1.pass (arbitrary path)
 * └── wallets
 *     └── 96ae14b4-46d7-42dc-afd8-c782e9af87ef (dir)
 *         └── 96ae14b4-46d7-42dc-afd8-c782e9af87ef (json)
 * ```
 */
// Using Pick<IGlobalArgs, "rootDir"> make changes in IGlobalArgs throw a type error here
export function getAccountPaths(options: Partial<IAccountPaths> & Pick<IGlobalArgs, "rootDir">): IAccountPaths {
  const rootDir = options.rootDir || ".lodestart";
  const keystoresDir = path.join(rootDir, options.keystoresDir || "keystores");
  const secretsDir = path.join(rootDir, options.secretsDir || "secrets");
  const walletsDir = path.join(rootDir, options.walletsDir || "wallets");
  return {
    keystoresDir,
    secretsDir,
    walletsDir
  };
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
export const defaultPaths = {
  ...getAccountPaths({rootDir: "$rootDir"}),
  ...getValidatorPaths({rootDir: "$rootDir"})
};
