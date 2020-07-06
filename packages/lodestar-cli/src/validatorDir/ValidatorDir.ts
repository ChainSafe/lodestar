import fs from "fs";
import path from "path";
import lockFile from "lockfile";
import {Keypair} from "@chainsafe/bls";
import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {unlockKeypair} from "../cmds/account/utils/unlockKeypair";
import {decodeEth1TxData} from "../depositContract/depositData";
import {
  VOTING_KEYSTORE_FILE,
  WITHDRAWAL_KEYSTORE_FILE,
  LOCK_FILE,
  ETH1_DEPOSIT_DATA_FILE,
  ETH1_DEPOSIT_AMOUNT_FILE,
  ETH1_DEPOSIT_TX_HASH_FILE
} from "./paths";

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
  depositData: DepositData;
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
  dir: string;
  private lockfilePath: string;

  /**
   * Open `dir`, creating a lockfile to prevent concurrent access.
   * Errors if there is a filesystem error or if a lockfile already exists
   * @param dir
   */
  constructor(baseDir: string, pubkey: string, options?: IValidatorDirOptions) {
    this.dir = path.join(baseDir, pubkey);
    this.lockfilePath = path.join(this.dir, LOCK_FILE);

    if (!fs.existsSync(this.dir))
      throw Error(`Directory ${this.dir} does not exists`);

    try {
      lockFile.lockSync(this.lockfilePath);
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
    lockFile.unlockSync(this.lockfilePath);
  }

  /**
   * Attempts to read the keystore in `this.dir` and decrypt the keypair using
   * a password file in `password_dir`.
   * The password file that is used will be based upon the pubkey value in the keystore.
   * Errors if there is a filesystem error, a password is missing or the password is incorrect.
   * @param secretsDir 
   */
  votingKeypair(secretsDir: string): Keypair {
    const keystorePath = path.join(this.dir, VOTING_KEYSTORE_FILE);
    return unlockKeypair({keystorePath, secretsDir});
  }

  /**
   * Attempts to read the keystore in `this.dir` and decrypt the keypair using
   * a password file in `password_dir`.
   * The password file that is used will be based upon the pubkey value in the keystore.
   * Errors if there is a filesystem error, a password is missing or the password is incorrect.
   * @param secretsDir 
   */
  withdrawalKeypair(secretsDir: string): Keypair {
    const keystorePath = path.join(this.dir, WITHDRAWAL_KEYSTORE_FILE);
    return unlockKeypair({keystorePath, secretsDir});
  }

  /**
   * Indicates if there is a file containing an eth1 deposit transaction. This can be used to
   * check if a deposit transaction has been created.
   *
   * *Note*: It's possible to submit an Eth1 deposit without creating this file, so use caution
   * when relying upon this value.
   */
  eth1DepositTxHashExists(): boolean {
    return fs.existsSync(path.join(this.dir, ETH1_DEPOSIT_TX_HASH_FILE));
  }

  /**
   * Saves the `tx_hash` to a file in `self.dir`.
   *
   * Errors
   * If there is a file-system error, or if there is already a transaction hash stored in
   * `self.dir`.
   */
  saveEth1DepositTxHash(txHash: string): void {
    const filepath = path.join(this.dir, ETH1_DEPOSIT_TX_HASH_FILE);

    if (fs.existsSync(filepath))
      throw Error(`ETH1_DEPOSIT_TX_HASH_FILE ${filepath} already exists`);

    fs.writeFileSync(filepath, txHash);
  }

  /**
   * Attempts to read files in `self.dir` and return an `Eth1DepositData` that can be used for
   * submitting an Eth1 deposit.
   *
   * Errors
   * If there is a file-system error, not all required files exist or the files are
   * inconsistent.
   */
  eth1DepositData(config: IBeaconConfig): IEth1DepositData {
    const depositDataPath = path.join(this.dir, ETH1_DEPOSIT_DATA_FILE);
    const depositAmountPath = path.join(this.dir, ETH1_DEPOSIT_AMOUNT_FILE);
    const depositDataRlp = fs.readFileSync(depositDataPath, "utf8");
    const depositAmount = fs.readFileSync(depositAmountPath, "utf8");

    // This acts as a sanity check to ensure that the amount from `ETH1_DEPOSIT_AMOUNT_FILE`
    // matches the value that `ETH1_DEPOSIT_DATA_FILE` was created with.
    const {depositData, root} = decodeEth1TxData(depositDataRlp, depositAmount, config);
   
    return {rlp: depositDataRlp, depositData, root};
  }
}
