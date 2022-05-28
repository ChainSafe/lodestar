import fs from "node:fs";
import path from "node:path";
import bls from "@chainsafe/bls";
import type {SecretKey} from "@chainsafe/bls/types";
import {Keystore} from "@chainsafe/bls-keystore";
import {phase0} from "@chainsafe/lodestar-types";
import {lockFilepath, unlockFilepath} from "@chainsafe/lodestar-keymanager-server";
import {YargsError, readValidatorPassphrase, add0xPrefix} from "../util/index.js";
import {decodeEth1TxData} from "../depositContract/depositData.js";
import {
  VOTING_KEYSTORE_FILE,
  WITHDRAWAL_KEYSTORE_FILE,
  ETH1_DEPOSIT_DATA_FILE,
  ETH1_DEPOSIT_AMOUNT_FILE,
} from "./paths.js";

export interface IValidatorDirOptions {
  force: boolean;
}

export interface IEth1DepositData {
  /**
   * An RLP encoded Eth1 transaction.
   */
  rlp: string;
  /**
   * The deposit data used to generate `self.rlp`
   */
  depositData: phase0.DepositData;
  /**
   * The root of `self.deposit_data`
   */
  root: string;
}

/**
 * Provides a wrapper around a directory containing validator information
 * Creates/deletes a lockfile in `self.dir` to attempt to prevent concurrent
 * access from multiple processes.
 *
 * Example:
 * ```
 * 0x91494d3ac4c078049f37aa46934ba8cd...
 * ├── eth1_deposit_data.rlp
 * ├── deposit-tx-hash.txt
 * ├── voting-keystore.json
 * └── withdrawal-keystore.json
 * ```
 */
export class ValidatorDir {
  private readonly dirpath: string;

  /**
   * Open `dir`, creating a lockfile to prevent concurrent access.
   * Errors if there is a filesystem error or if a lockfile already exists
   */
  constructor(baseDir: string, pubkey: string, options?: IValidatorDirOptions) {
    this.dirpath = path.join(baseDir, add0xPrefix(pubkey));

    if (!fs.existsSync(this.dirpath)) {
      throw new YargsError(`Validator directory ${this.dirpath} does not exist`);
    }

    try {
      lockFilepath(this.dirpath);
    } catch (e) {
      if (options && options.force) {
        // Ignore error, maybe log?
      } else {
        throw e;
      }
    }
  }

  /**
   * Removes the lockfile associated with this validator dir
   */
  close(): void {
    unlockFilepath(this.dirpath);
  }

  /**
   * Attempts to read the keystore in `this.dir` and decrypt the secretKey using
   * a password file in `password_dir`.
   * The password file that is used will be based upon the pubkey value in the keystore.
   * Errors if there is a filesystem error, a password is missing or the password is incorrect.
   * @param secretsDir
   */
  async votingKeypair(secretsDir: string): Promise<SecretKey> {
    const keystorePath = path.join(this.dirpath, VOTING_KEYSTORE_FILE);
    return await this.unlockKeypair(keystorePath, secretsDir);
  }

  /**
   * Attempts to read the keystore in `this.dir` and decrypt the secretKey using
   * a password file in `password_dir`.
   * The password file that is used will be based upon the pubkey value in the keystore.
   * Errors if there is a filesystem error, a password is missing or the password is incorrect.
   * @param secretsDir
   */
  async withdrawalKeypair(secretsDir: string): Promise<SecretKey> {
    const keystorePath = path.join(this.dirpath, WITHDRAWAL_KEYSTORE_FILE);
    return await this.unlockKeypair(keystorePath, secretsDir);
  }

  /**
   * Decrypts a keystore in the validator's dir
   * @param keystorePath Path to a EIP-2335 keystore
   * @param secretsDir Directory containing keystore passwords
   */
  async unlockKeypair(keystorePath: string, secretsDir: string): Promise<SecretKey> {
    const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));
    const password = readValidatorPassphrase({secretsDir, pubkey: keystore.pubkey});
    const privKey = await keystore.decrypt(password);
    return bls.SecretKey.fromBytes(privKey);
  }

  /**
   * Attempts to read files in `this.dir` and return an `Eth1DepositData` that can be used for
   * submitting an Eth1 deposit.
   */
  eth1DepositData(): IEth1DepositData {
    const depositDataPath = path.join(this.dirpath, ETH1_DEPOSIT_DATA_FILE);
    const depositAmountPath = path.join(this.dirpath, ETH1_DEPOSIT_AMOUNT_FILE);
    const depositDataRlp = fs.readFileSync(depositDataPath, "utf8");
    const depositAmount = fs.readFileSync(depositAmountPath, "utf8");

    // This acts as a sanity check to ensure that the amount from `ETH1_DEPOSIT_AMOUNT_FILE`
    // matches the value that `ETH1_DEPOSIT_DATA_FILE` was created with.
    const {depositData, root} = decodeEth1TxData(depositDataRlp, depositAmount);

    return {rlp: depositDataRlp, depositData, root};
  }
}
