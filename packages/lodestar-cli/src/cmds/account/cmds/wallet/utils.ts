import fs from "fs";
import path from "path";
import {IGlobalArgs} from "../../../../options";
import {YargsError, writeFile600Perm, randomPassword, readPassphraseFile, initBLS} from "../../../../util";
import {WalletManager} from "../../../../wallet";
import {getAccountPaths} from "../../paths";
import {IWalletRecoverArgs} from "./recover";

export async function createWalletFromArgsAndMnemonic(
  args: Pick<IWalletRecoverArgs & IGlobalArgs, "name" | "type" | "passphraseFile" | "mnemonicOutputPath" | "rootDir">,
  mnemonic: string
): Promise<{uuid: string; password: string}> {
  await initBLS();

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

export function printUuidData(uuid: string): string {
  return `
Your wallet's UUID is:

\t${uuid}

You do not need to backup your UUID or keep it secret.`;
}
