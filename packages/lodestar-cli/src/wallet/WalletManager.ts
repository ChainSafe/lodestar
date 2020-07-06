import fs from "fs";
import path from "path";
import {Keypair} from "@chainsafe/bls";
import {ValidatorWallet, IValidatorDirOptions} from "./ValidatorDir";
import {Wallet, IWalletKeystoreJson} from "./Wallet";

/**
 * Manages a directory containing EIP-2386 wallets.
 *
 * Each wallet is stored in a directory with the name of the wallet UUID. Inside each directory a
 * EIP-2386 JSON wallet is also stored using the UUID as the filename.
 *
 * In each wallet directory an optional `.lock` exists to prevent concurrent reads and writes from
 * the same wallet.
 *
 * Example:
 *
 * ```bash
 * wallets
 * ├── 35c07717-c6f3-45e8-976f-ef5d267e86c9
 * |   └── 35c07717-c6f3-45e8-976f-ef5d267e86c9
 * └── 747ad9dc-e1a1-4804-ada4-0dc124e46c49
 *     ├── .lock
 *     ├── 747ad9dc-e1a1-4804-ada4-0dc124e46c49
 * ```
 */

export class WalletManager {
  dir: string;

  /**
   * Open a directory containing multiple validators.
   * @param dir 
   */
  constructor(dir: string) {
    if (!fs.existsSync(dir)) throw Error(`directory ${dir} does not exist`);
    this.dir = dir;
  }

  /**
   * Iterate the nodes in `self.dir`, returning only child directories.
   */
  iterDir(): string[] {
    return fs.readdirSync(this.dir)
      .map(file => path.join(this.dir, file))
      .filter(dirPath => fs.statSync(dirPath).isDirectory());
  }

  /**
   * Iterates all wallets in `this.dir` and returns a mapping of their name to their UUID.
   *
   * Ignores any items in `this.dir` that:
   *
   * - Are files.
   * - Are directories, but their file-name does not parse as a UUID.
   *
   * This function is fairly strict, it will fail if any directory is found that does not obey
   * the expected structure (e.g., there is a UUID directory that does not contain a valid JSON
   * keystore with the same UUID).
   */
  wallets(): IWalletKeystoreJson[] {
    return this.iterDir().map(walletDir => {
      const walletUuid = walletDir;
      if (uuid.parse(walletUuid))
        throw Error(`Validator dir ${walletDir} name must be a UUID`);
    
      const walletInfoPath = path.join(walletDir, walletUuid);
      const walletInfo = JSON.parse(fs.readFileSync(walletInfoPath, "utf8"));
      if (walletInfo.uuid !== walletUuid)
        throw Error(`Wallet UUID mismatch, ${walletInfo.uuid} !== ${walletUuid}`);

      return walletInfo;
    });
  }

  /**
   * Opens and searches all wallets in `self.dir` and returns the wallet with this name.
   *
   * ## Errors
   *
   * - If there is no wallet with this name.
   * - If there is a file-system or parsing error.
   */
  openByName(name: string): Wallet {
    const wallets = this.wallets();
    const walletKeystore = wallets.find(w => w.name === name);
    if (!walletKeystore) throw Error(`Wallet ${name} not found`);
    return new Wallet(walletKeystore);
  }

  /**  
   * Creates a new wallet with the given `name` in `self.dir` with the given `mnemonic` as a
   * seed, encrypted with `password`.
   *  
   * Errors
   *  - If a wallet with this name already exists.
   *  - If there is a file-system or parsing error.
   */
  createWallet(
    name: string,
    walletType: WalletType,
    mnemonic: Mnemonic,
    password: string
  ): Wallet {
    if (this.wallets().some(wallet => wallet.name === name))
      throw Error(`Wallet name ${name} already used`);

      
    const wallet = Wallet.fromMnemonic(mnemonic, password, name);
    const walletDir = path.join(this.dir, wallet.uuid);

    if (fs.existsSync(walletDir))
      throw Error(`Wallet dir ${walletDir} already exists`);

    fs.mkdirSync(walletDir, {recursive: true});
    const walletInfoPath = path.join(walletDir, wallet.uuid);
    fs.writeFileSync(walletInfoPath, wallet.toWalletJSON());

    return wallet;
  }
}
