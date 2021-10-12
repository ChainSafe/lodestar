import {mapValues, values} from "lodash";
import bls from "@chainsafe/bls";
import {Keystore, IKeystore} from "@chainsafe/bls-keystore";
import {
  deriveEth2ValidatorKeys,
  IEth2ValidatorKeys,
  eth2ValidatorPaths,
  deriveKeyFromMnemonic,
} from "@chainsafe/bls-keygen";
import {randomPassword} from "../util";

/**
 * @chainsafe/bls-keystore@1.0.0-beta8 requires a pubKey argument
 * While the library is not agnostic use this empty value
 */

export interface IWalletKeystoreJson {
  crypto: Record<string, unknown>;
  uuid: string;
  name: string;
  nextaccount: number;
  version: number;
  type: string;
}

export class Wallet extends Keystore {
  name?: string;
  nextaccount: number;
  version: number;
  type: string;

  constructor(keystore: Partial<IWalletKeystoreJson>) {
    super(keystore as IKeystore);
    this.name = keystore.name;
    this.nextaccount = keystore.nextaccount ?? 0;
    this.version = keystore.version ?? 1;
    this.type = keystore.type || "hierarchical deterministic";
  }

  /**
   * Creates a new builder for a seed specified as a BIP-39 `Mnemonic` (where the nmemonic itself does
   * not have a passphrase).
   */
  static async fromMnemonic(mnemonic: string, password: string, name: string): Promise<Wallet> {
    const seed = deriveKeyFromMnemonic(mnemonic);
    const publicKey = bls.SecretKey.fromBytes(seed).toPublicKey().toBytes();

    const wallet = new Wallet(await this.create(password, seed, publicKey, ""));
    wallet.name = name;
    wallet.nextaccount = 0;
    wallet.version = 1;
    wallet.type = "hierarchical deterministic";
    return wallet;
  }

  /**
   * Returns wallet data to write to disk as a parsed object
   */
  toWalletObject(): IWalletKeystoreJson {
    return {
      crypto: this.crypto,
      uuid: this.uuid,
      name: this.name || "",
      nextaccount: this.nextaccount,
      version: this.version,
      type: this.type,
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
  async nextValidator(
    walletPassword: string,
    passwords: {[key in keyof IEth2ValidatorKeys]: string}
  ): Promise<
    {
      [key in keyof IEth2ValidatorKeys]: Keystore;
    }
  > {
    const masterKey = await this.decrypt(walletPassword);
    const validatorIndex = this.nextaccount;
    const privKeys = deriveEth2ValidatorKeys(masterKey, validatorIndex);
    const paths = eth2ValidatorPaths(validatorIndex);

    const keystores = mapValues(privKeys, async (privKey, key) => {
      const type = key as keyof typeof privKeys;
      const publicKey = bls.SecretKey.fromBytes(privKey).toPublicKey().toBytes();
      const keystore = await Keystore.create(passwords[type], privKey, publicKey, paths[type]);
      return keystore;
    });

    // Update nextaccount last in case Keystore generation throws
    this.nextaccount += 1;

    const resolved = await Promise.all(values(keystores));
    return {
      withdrawal: resolved[0],
      signing: resolved[1],
    };
  }

  /**
   * Utility function to generate passwords for the two eth2 pair keystores
   */
  randomPasswords(): {[key in keyof IEth2ValidatorKeys]: string} {
    return {
      signing: randomPassword(),
      withdrawal: randomPassword(),
    };
  }
}
