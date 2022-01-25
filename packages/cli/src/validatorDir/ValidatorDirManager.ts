import fs from "node:fs";
import path from "node:path";
import {ValidatorDir, IValidatorDirOptions} from "./ValidatorDir";
import {SecretKey} from "@chainsafe/bls";
import {YargsError} from "../util";

/**
 * Manages a directory containing multiple `ValidatorDir` directories.
 *
 * Example:
 * ```
 * validators
 * └── 0x91494d3ac4c078049f37aa46934ba8cd...
 *     ├── eth1_deposit_data.rlp
 *     ├── deposit-tx-hash.txt
 *     ├── voting-keystore.json
 *     └── withdrawal-keystore.json
 * └── 0xb9bcfeb3c752a36c9edc5b9028c984a6...
 * ```
 */
export class ValidatorDirManager {
  keystoresDir: string;
  secretsDir: string;

  /**
   * Open a directory containing multiple validators.
   */
  constructor({keystoresDir, secretsDir}: {keystoresDir: string; secretsDir: string}) {
    if (!fs.existsSync(keystoresDir)) throw new YargsError(`keystoresDir ${keystoresDir} does not exist`);
    if (!fs.existsSync(secretsDir)) throw new YargsError(`secretsDir ${secretsDir} does not exist`);

    this.keystoresDir = keystoresDir;
    this.secretsDir = secretsDir;
  }

  /**
   * Iterate the nodes in `this.keystoresDir`, filtering out things that are unlikely to be
   * a validator directory.
   */
  iterDir(): string[] {
    return fs
      .readdirSync(this.keystoresDir)
      .filter((pubkey) => fs.statSync(path.join(this.keystoresDir, pubkey)).isDirectory());
  }

  /**
   * Open a `ValidatorDir` at the given `path`.
   * *Note*: It is not enforced that `path` is contained in `this.dir`.
   */
  openValidator(pubkey: string, options?: IValidatorDirOptions): ValidatorDir {
    return new ValidatorDir(this.keystoresDir, pubkey, options);
  }

  /**
   * Opens all the validator directories in `this`.
   * *Note*: Returns an error if any of the directories is unable to be opened
   */
  openAllValidators(options?: IValidatorDirOptions): ValidatorDir[] {
    return this.iterDir().map((pubkey) => this.openValidator(pubkey, options));
  }

  /**
   * Opens the given validator and decrypts its secretKeys.
   */
  async decryptValidator(pubkey: string, options?: IValidatorDirOptions): Promise<SecretKey> {
    const validator = this.openValidator(pubkey, options);
    return await validator.votingKeypair(this.secretsDir);
  }

  /**
   * Opens all the validator directories in `this` and decrypts the validator secretKeys.
   */
  async decryptAllValidators(options?: IValidatorDirOptions): Promise<SecretKey[]> {
    const validators = this.openAllValidators(options);
    return await Promise.all(validators.map(async (validator) => validator.votingKeypair(this.secretsDir)));
  }
}
