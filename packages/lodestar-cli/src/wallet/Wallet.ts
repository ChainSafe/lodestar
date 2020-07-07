import * as bip39 from "bip39";
import {mapValues} from "lodash";
import {Keystore} from "@chainsafe/bls-keystore";
import {
  deriveEth2ValidatorKeys,
  IEth2ValidatorKeys,
} from "@chainsafe/bls-keygen";

export interface IWalletKeystoreJson {
  crypto: object;
  uuid: string;
  name: string;
  nextaccount: number;
  version: number;
  type: string;
}

export class Wallet extends Keystore {
  keystore: Keystore;
  name: string;
  nextaccount = 0;
  version = 1;
  type = "hierarchical deterministic";

  constructor(keystore: Partial<IWalletKeystoreJson>) {
    super(keystore);
    this.name = keystore.name;
    this.nextaccount = keystore.nextaccount;
    this.version = keystore.version;
    this.type = keystore.type;
  }

  /**
   * Creates a new builder for a seed specified as a BIP-39 `Mnemonic` (where the nmemonic itself does
   * not have a passphrase).
   */
  static fromMnemonic(mnemonic: string, password: string, name: string): Wallet {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const wallet = this.encrypt(seed, password) as Wallet;
    wallet.name = name;
    return wallet;
  }

  /**
   * Returns wallet data to write to disk as a parsed object
   */
  toWalletObject(): IWalletKeystoreJson {
    return {
      crypto: this.crypto.toObject(),
      uuid: this.uuid,
      name: this.name,
      nextaccount: this.nextaccount,
      version: this.version,
      type: this.type
    };
  }

  /**
   * Returns wallet data to write to disk as stringified JSON
   */
  toWalletJSON(): string {
    return JSON.stringify(this.toWalletObject());
  }

  /**
   * Produces a `Keystore` (encrypted with `keystore_password`) for the validator at
   * `self.nextaccount`, incrementing `self.nextaccount` if the keystore was successfully
   * generated.
   *
   * Uses the default encryption settings of `KeystoreBuilder`, not necessarily those that were
   * used to encrypt `this`.
   */
  nextValidator(
    walletPassword: string,
    passwords: { [key in keyof IEth2ValidatorKeys]: string }
  ): { [key in keyof IEth2ValidatorKeys]: Keystore } {
    const masterKey = this.decrypt(walletPassword);
    const validatorIndex = this.nextaccount;
    const privKeys = deriveEth2ValidatorKeys(masterKey, validatorIndex);

    // ### Todo: deriveEth2ValidatorKeys should return the paths somehow too
    //           to prevent code duplication
    const paths: { [key in keyof IEth2ValidatorKeys]: string } = {
      signing: `m/12381/3600/${validatorIndex}/0/0`,
      withdrawal: `m/12381/3600/${validatorIndex}/0`,
    };

    const keystores = mapValues(privKeys, (privKey, key) => {
      const type = key as keyof typeof privKeys;
      return Keystore.encrypt(privKey, passwords[type], paths[type]);
    });

    // Update nextaccount last in case Keystore generation throws
    this.nextaccount += 1;

    return keystores;
  }
}
