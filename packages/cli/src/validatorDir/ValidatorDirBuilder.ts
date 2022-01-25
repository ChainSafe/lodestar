import fs from "node:fs";
import path from "node:path";
import {Keystore} from "@chainsafe/bls-keystore";
import bls from "@chainsafe/bls";
import {IEth2ValidatorKeys} from "@chainsafe/bls-keygen";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ValidatorDir} from "./ValidatorDir";
import {encodeDepositData} from "../depositContract/depositData";
import {ensureDirExists, YargsError, writeValidatorPassphrase} from "../util";
import {
  VOTING_KEYSTORE_FILE,
  WITHDRAWAL_KEYSTORE_FILE,
  ETH1_DEPOSIT_DATA_FILE,
  ETH1_DEPOSIT_AMOUNT_FILE,
  getValidatorDirPath,
} from "./paths";

interface IValidatorDirBuildOptions {
  keystores: {[key in keyof IEth2ValidatorKeys]: Keystore};
  passwords: {[key in keyof IEth2ValidatorKeys]: string};
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
  storeWithdrawalKeystore?: boolean;
  depositGwei: number;
  config: IChainForkConfig;
}

/**
 * A builder for creating a `ValidatorDir`.
 */
export class ValidatorDirBuilder {
  keystoresDir: string;
  secretsDir: string;

  /**
   * Instantiate a new builder.
   */
  constructor({keystoresDir, secretsDir}: {keystoresDir: string; secretsDir: string}) {
    ensureDirExists(keystoresDir);
    ensureDirExists(secretsDir);
    this.keystoresDir = keystoresDir;
    this.secretsDir = secretsDir;
  }

  async build({
    keystores,
    passwords,
    storeWithdrawalKeystore,
    depositGwei,
    config,
  }: IValidatorDirBuildOptions): Promise<ValidatorDir> {
    const keystoresDir = this.keystoresDir;
    const secretsDir = this.secretsDir;
    const pubkey = keystores.signing.pubkey;
    if (!pubkey) throw Error("signing keystore has no pubkey");

    const dir = getValidatorDirPath({keystoresDir, pubkey, prefixed: true});
    if (fs.existsSync(dir) || fs.existsSync(getValidatorDirPath({keystoresDir, pubkey}))) {
      throw new YargsError(`validator dir for ${pubkey} already exists`);
    }
    fs.mkdirSync(dir, {recursive: true});

    const withdrawalPublicKey = bls.PublicKey.fromHex(keystores.withdrawal.pubkey);
    const votingPrivateKey = bls.SecretKey.fromBytes(await keystores.signing.decrypt(passwords.signing));

    // Save `ETH1_DEPOSIT_DATA_FILE` to file.
    // This allows us to know the RLP data for the eth1 transaction without needing to know
    // the withdrawal/voting keypairs again at a later date.
    const depositDataRlp = encodeDepositData(depositGwei, withdrawalPublicKey, votingPrivateKey, config);
    fs.writeFileSync(path.join(dir, ETH1_DEPOSIT_DATA_FILE), depositDataRlp);

    // Save `ETH1_DEPOSIT_AMOUNT_FILE` to file.
    // This allows us to know the intended deposit amount at a later date.
    fs.writeFileSync(path.join(dir, ETH1_DEPOSIT_AMOUNT_FILE), depositGwei.toString());

    // Only the withdrawal keystore if explicitly required.
    if (storeWithdrawalKeystore) {
      fs.writeFileSync(path.join(dir, WITHDRAWAL_KEYSTORE_FILE), keystores.withdrawal.stringify());
      writeValidatorPassphrase({secretsDir, pubkey: keystores.withdrawal.pubkey, passphrase: passwords.withdrawal});
    }

    // Always store voting credentials
    fs.writeFileSync(path.join(dir, VOTING_KEYSTORE_FILE), keystores.signing.stringify());
    writeValidatorPassphrase({secretsDir, pubkey, passphrase: passwords.signing});

    return new ValidatorDir(this.keystoresDir, pubkey);
  }
}
