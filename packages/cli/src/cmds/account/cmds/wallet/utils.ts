import fs from "node:fs";
import path from "node:path";
import {IGlobalArgs} from "../../../../options/index.js";
import {YargsError, writeFile600Perm, randomPassword, readPassphraseFile} from "../../../../util/index.js";
import {WalletManager} from "../../../../wallet/index.js";
import {getAccountPaths} from "../../paths.js";
import {IWalletRecoverArgs} from "./recover.js";

export async function createWalletFromArgsAndMnemonic(
  args: Pick<IWalletRecoverArgs & IGlobalArgs, "name" | "type" | "passphraseFile" | "mnemonicOutputPath" | "rootDir">,
  mnemonic: string
): Promise<{uuid: string; password: string}> {
  const {name, type, passphraseFile, mnemonicOutputPath} = args;
  const accountPaths = getAccountPaths(args);

  if (path.parse(passphraseFile).ext !== ".pass") {
    throw new YargsError("passphraseFile must end with .pass, make sure to not provide the actual password");
  }

  if (!fs.existsSync(passphraseFile)) {
    writeFile600Perm(passphraseFile, randomPassword());
  }

  const password = readPassphraseFile(passphraseFile);

  const walletManager = new WalletManager(accountPaths);
  const wallet = await walletManager.createWallet(name, type, mnemonic, password);
  const uuid = wallet.toWalletObject().uuid;

  if (mnemonicOutputPath) {
    writeFile600Perm(mnemonicOutputPath, mnemonic);
  }

  return {uuid, password};
}
