import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {PublicKey, PrivateKey} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ValidatorDir} from "./ValidatorDir";
import {encodeDepositData} from "../depositContract/depositData";
import {writeFile600Perm} from "../util/fs";
import {
  VOTING_KEYSTORE_FILE,
  WITHDRAWAL_KEYSTORE_FILE,
  ETH1_DEPOSIT_DATA_FILE,
  ETH1_DEPOSIT_AMOUNT_FILE
} from "./paths";

interface IValidatorDirBuildOptions {
  votingKeystore: Keystore;
  votingPassword: string;
  withdrawalKeystore: Keystore;
  withdrawalPassword: string;
  /**
   * If `should_store == true`, the validator keystore will be saved in the `ValidatorDir` (and
   * the password to it stored in the `password_dir`). If `should_store == false`, the
   * withdrawal keystore will be dropped after `Self::build`.
   *
   * ## Notes
   *
   * If `should_store == false`, it is important to ensure that the withdrawal keystore is
   * backed up. Backup can be via saving the files elsewhere, or in the case of HD key
   * derivation, ensuring the seed and path are known.
   *
   * If the builder is not specifically given a withdrawal keystore then one will be generated
   * randomly. When this random keystore is generated, calls to this function are ignored and
   * the withdrawal keystore is *always* stored to disk. This is to prevent data loss.
   */
  storeWithdrawalKeystore: boolean;
  depositGwei: bigint;
  config: IBeaconConfig;
}


/**
 * A builder for creating a `ValidatorDir`.
 */
export class ValidatorDirBuilder {
  validatorsDir: string;
  secretsDir: string;

  /**
   * Instantiate a new builder.
   * @param base_validators_dir 
   * @param password_dir 
   */
  constructor (validatorsDir: string, secretsDir: string) {
    this.validatorsDir = validatorsDir;
    this.secretsDir = secretsDir;
  }

  build({
    votingKeystore,
    votingPassword,
    withdrawalKeystore,
    withdrawalPassword,
    storeWithdrawalKeystore,
    depositGwei,
    config
  }: IValidatorDirBuildOptions): ValidatorDir {
    const dir = path.join(this.validatorsDir, votingKeystore.pubkey);
    if (fs.existsSync(dir)) throw Error(`validator dir ${dir} already exists`);
    fs.mkdirSync(dir, {recursive: true});

    const withdrawalPublicKey = PublicKey.fromHex(withdrawalKeystore.pubkey);
    const votingPrivateKey = PrivateKey.fromBytes(votingKeystore.decrypt(votingPassword));

    // Save `ETH1_DEPOSIT_DATA_FILE` to file.
    // This allows us to know the RLP data for the eth1 transaction without needing to know
    // the withdrawal/voting keypairs again at a later date.
    const depositDataRlp = encodeDepositData(
      depositGwei,
      withdrawalPublicKey,
      votingPrivateKey,
      config
    );
    fs.writeFileSync(ETH1_DEPOSIT_DATA_FILE, depositDataRlp);

    // Save `ETH1_DEPOSIT_AMOUNT_FILE` to file.
    // This allows us to know the intended deposit amount at a later date.
    fs.writeFileSync(ETH1_DEPOSIT_AMOUNT_FILE, depositGwei.toString());

    // Only the withdrawal keystore if explicitly required.
    if (storeWithdrawalKeystore) {
      this.writePasswordToFile(withdrawalKeystore.pubkey, withdrawalPassword);
      this.writeKeystoreToFile(withdrawalKeystore, WITHDRAWAL_KEYSTORE_FILE);
    }

    // Always store voting credentials
    this.writePasswordToFile(votingKeystore.pubkey, votingPassword);
    this.writeKeystoreToFile(votingKeystore, VOTING_KEYSTORE_FILE);

    return new ValidatorDir(this.validatorsDir, votingKeystore.pubkey);
  }

  /**
   * Creates a file with `600 (-rw-------)` permissions.
   */
  private writePasswordToFile(pubkey: string, password: string): void {
    const filepath = path.join(this.secretsDir, pubkey);
    writeFile600Perm(filepath, password);
  }

  /**
   * Writes a JSON keystore to file.
   */
  private writeKeystoreToFile(keystore: Keystore, filename: string): void {
    const filepath = path.join(this.validatorsDir, filename);
    fs.writeFileSync(filepath, keystore);
  }
}
