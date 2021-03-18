import * as bip39 from "bip39";
import {ICliCommand, ICliCommandOptions, initBLS} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {accountWalletsOptions, IAccountWalletArgs} from "./options";
import {createWalletFromArgsAndMnemonic} from "./utils";

export const command = "create";

export const description = "Creates a new HD (hierarchical-deterministic) EIP-2386 wallet";

export type IWalletCreateArgs = {
  name: string;
  passphraseFile: string;
  type: string;
  mnemonicOutputPath?: string;
};

export const walletCreateOptions: ICliCommandOptions<IWalletCreateArgs> = {
  ...accountWalletsOptions,
  name: {
    description:
      "The wallet will be created with this name. It is not allowed to \
create two wallets with the same name for the same --base-dir.",
    alias: ["n"],
    demandOption: true,
    type: "string",
  },

  passphraseFile: {
    description:
      "A path to a file containing the password which will unlock the wallet. \
If the file does not exist, a random password will be generated and saved at that \
path. To avoid confusion, if the file does not already exist it must include a \
'.pass' suffix.",
    alias: ["p"],
    demandOption: true,
    type: "string",
  },

  type: {
    description: "The type of wallet to create. Only HD (hierarchical-deterministic) \
wallets are supported presently.",
    choices: ["hd"],
    default: "hd",
    type: "string",
  },

  mnemonicOutputPath: {
    description: "If present, the mnemonic will be saved to this file",
    type: "string",
  },
};

export type ReturnType = {
  mnemonic: string;
  uuid: string;
  password: string;
};

export const create: ICliCommand<IWalletCreateArgs, IAccountWalletArgs & IGlobalArgs, ReturnType> = {
  command: "create",

  describe: "Creates a new HD (hierarchical-deterministic) EIP-2386 wallet",

  examples: [
    {
      command: "account wallet create --name primary --passphraseFile primary.pass",
      description: "Create an HD wallet named 'primary'",
    },
  ],

  options: walletCreateOptions,

  handler: async (args) => {
    await initBLS();

    // Create a new random mnemonic.
    const mnemonic = bip39.generateMnemonic();

    const {uuid, password} = await createWalletFromArgsAndMnemonic(args, mnemonic);

    // eslint-disable-next-line no-console
    console.log(
      `
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

  \t${uuid}

  You do not need to backup your UUID or keep it secret.`
    );

    // Return values for testing
    return {mnemonic, uuid, password};
  },
};
