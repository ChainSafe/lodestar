import path from "path";
import {IGlobalArgs} from "../../options";

export interface IValidatorPaths extends Pick<IGlobalArgs, "rootDir"> {
  dbDir?: string;
  validatorsDir?: string;
  secretsDir?: string;
}

/**
 * Defines the dynamic path structure of the validator files
 * 
 * ```
 * rootDir
 * ├── secrets
 * |   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037e1b601b3adbc1514483bf9faab7948dfcf325e751bb560
 * |   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f6add777d68f42225e6ff226ea5e9eec254e649c694564b
 * ├── validators
 * |   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037e1b601b3adbc1514483bf9faab7948dfcf325e751bb560
 * |   |   ├── eth1-deposit-data.rlp
 * |   |   ├── eth1-deposit-gwei.txt
 * |   |   └── voting-keystore.json
 * |   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f6add777d68f42225e6ff226ea5e9eec254e649c694564b
 * |       ├── eth1-deposit-data.rlp
 * |       ├── eth1-deposit-gwei.txt
 * |       └── voting-keystore.json
 * ├── wallet1.pass (arbitrary path)
 * └── wallets
 *    └── 96ae14b4-46d7-42dc-afd8-c782e9af87ef (dir)
 *        └── 96ae14b4-46d7-42dc-afd8-c782e9af87ef (json)
 * ```
 */
export function processValidatorPaths(options: IValidatorPaths): Required<IValidatorPaths> {
  const rootDir = options.rootDir;
  const dbDir = path.join(rootDir, options.dbDir || "validator-db");
  const validatorsDir = path.join(rootDir, options.validatorsDir || "validators");
  const secretsDir = path.join(rootDir, options.secretsDir || "secrets");
  return {rootDir, dbDir, validatorsDir, secretsDir};
}