import fs from "fs";
import path from "path";
import {CommandBuilder} from "yargs";
import * as bip39 from "bip39";
import {randomPassword, writeFile600Perm,YargsError} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {WalletManager} from "../../../../wallet";

export const command = "create";

export const description = "Creates a new HD (hierarchical-deterministic) EIP-2386 wallet";

interface IWalletCreateOptions extends IGlobalArgs {
  name: string;
  passphraseFile: string;
  type: string;
  mnemonicOutputPath?: string;
}

export const builder: CommandBuilder<{}, IWalletCreateOptions> = {
  name: {
    description: "The wallet will be created with this name. It is not allowed to \
create two wallets with the same name for the same --base-dir.",
    alias: ["n"],
    demandOption: true,
    type: "string"
  },

  passphraseFile: {
    description: "A path to a file containing the password which will unlock the wallet. \
If the file does not exist, a random password will be generated and saved at that \
path. To avoid confusion, if the file does not already exist it must include a \
'.pass' suffix.",
    alias: ["passphrase-file", "p"],
    demandOption: true,
    type: "string"
  },

  type: {
    description: `The type of wallet to create. Only HD (hierarchical-deterministic)
wallets are supported presently.`,
    choices: ["hd"],
    default: "hd",
    type: "string"
  },

  mnemonicOutputPath: {
    description: "If present, the mnemonic will be saved to this file",
    alias: ["mnemonic-output-path"],
    type: "string"
  }
};

export async function handler(options: IWalletCreateOptions): Promise<void> {
  const name = options.name;
  const type = options.type;
  const passphraseFile = options.passphraseFile;
  const mnemonicOutputPath = options.mnemonicOutputPath;
  const baseDir = options.rootDir;

  // Create a new random mnemonic.
  const mnemonic = bip39.generateMnemonic();

  // Create a random password if the file does not exist.
  if (!fs.existsSync(passphraseFile)) {
    if (path.parse(passphraseFile).ext !== ".pass") {
      throw new YargsError("passphraseFile must end with .pass, make sure to not provide the actual password");
    }
    writeFile600Perm(passphraseFile, randomPassword());
  }
  const password = fs.readFileSync(passphraseFile, "utf8");

  const walletManager = new WalletManager(baseDir);
  const wallet = walletManager.createWallet(name, type, mnemonic, password);

  if (mnemonicOutputPath) {
    writeFile600Perm(mnemonicOutputPath, mnemonic);
  }

  // eslint-disable-next-line no-console
  console.log(`
Your wallet's 12-word BIP-39 mnemonic is:

\t${mnemonic}

This mnemonic can be used to fully restore your wallet, should 
you lose the JSON file or your password. 

It is very important that you DO NOT SHARE this mnemonic as it will 
reveal the private keys of all validators and keys generated with
this wallet. That would be catastrophic.

It is also important to store a backup of this mnemonic so you can 
recover your private keys in the case of data loss. Writing it on 
a piece of paper and storing it in a safe place would be prudent.

Your wallet's UUID is:

\t${wallet.toWalletObject().uuid}

You do not need to backup your UUID or keep it secret.
`);
}

