import fs from "node:fs";
import path from "node:path";
import {isUuid} from "uuidv4";
import {Wallet, IWalletKeystoreJson} from "./Wallet";
import {ensureDirExists, YargsError} from "../util";

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
  walletsDir: string;

  /**
   * Open a directory containing multiple validators.
   */
  constructor({walletsDir}: {walletsDir: string}) {
    ensureDirExists(walletsDir);
    this.walletsDir = walletsDir;
  }

  /**
   * Iterates all wallets in `this.walletsDir` and returns a mapping of their name to their UUID.
   *
   * Ignores any items in `this.walletsDir` that:
   *
   * - Are files.
   * - Are directories, but their file-name does not parse as a UUID.
   *
   * This function is fairly strict, it will fail if any directory is found that does not obey
   * the expected structure (e.g., there is a UUID directory that does not contain a valid JSON
   * keystore with the same UUID).
   */
  wallets(): IWalletKeystoreJson[] {
    return fs
      .readdirSync(this.walletsDir)
      .filter((file) => isUuid(file) && fs.statSync(path.join(this.walletsDir, file)).isDirectory())
      .map((walletUuid) => {
        const walletInfoPath = path.join(this.walletsDir, walletUuid, walletUuid);
        const walletInfo = JSON.parse(fs.readFileSync(walletInfoPath, "utf8")) as IWalletKeystoreJson;
        if (walletInfo.uuid !== walletUuid)
          throw new YargsError(`Wallet UUID mismatch, ${walletInfo.uuid} !== ${walletUuid}`);

        return walletInfo;
      });
  }

  /**
   * Opens and searches all wallets in `self.dir` and returns the wallet with this name.
   */
  openByName(name: string): Wallet {
    const wallets = this.wallets();
    const walletKeystore = wallets.find((w) => w.name === name);
    if (!walletKeystore) throw new YargsError(`Wallet ${name} not found`);
    return new Wallet(walletKeystore);
  }

  /**
   * Persist wallet info to disk
   */
  writeWallet(wallet: Wallet): void {
    if (!wallet.uuid) throw new YargsError("Wallet UUID is not defined");
    const walletInfoPath = path.join(this.walletsDir, wallet.uuid, wallet.uuid);
    fs.writeFileSync(walletInfoPath, wallet.toWalletJSON());
  }

  /**
   * Creates a new wallet with the given `name` in `self.dir` with the given `mnemonic` as a
   * seed, encrypted with `password`.
   */
  async createWallet(name: string, walletType: string, mnemonic: string, password: string): Promise<Wallet> {
    if (this.wallets().some((wallet) => wallet.name === name)) throw new YargsError(`Wallet name ${name} already used`);

    const wallet = await Wallet.fromMnemonic(mnemonic, password, name);
    const walletDir = path.join(this.walletsDir, wallet.uuid);

    if (fs.existsSync(walletDir)) throw new YargsError(`Wallet dir ${walletDir} already exists`);
    fs.mkdirSync(walletDir, {recursive: true});

    this.writeWallet(wallet);

    return wallet;
  }
}
