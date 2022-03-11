import * as fs from "node:fs";
import {ICliCommand, initBLS} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import inquirer from "inquirer";
import {createWalletFromArgsAndMnemonic} from "./utils";
import {IWalletCreateArgs, walletCreateOptions} from "./create";

/* eslint-disable no-console */

export type IWalletRecoverArgs = IWalletCreateArgs & {
  mnemonicInputPath: string;
};

export type ReturnType = string[];

export const recover: ICliCommand<IWalletRecoverArgs, IGlobalArgs, ReturnType> = {
  command: "recover",

  describe: "Recovers an EIP-2386 wallet from a given a BIP-39 mnemonic phrase.",

  examples: [
    {
      command: "account wallet recover",
      description: "Recover wallet",
    },
  ],

  options: {
    ...walletCreateOptions,
    mnemonicInputPath: {
      description: "If present, the mnemonic will be read in from this file.",
      type: "string",
    },
  },

  handler: async (args) => {
    await initBLS();

    const {mnemonicInputPath} = args;
    let mnemonic;

    console.log("\nWARNING: KEY RECOVERY CAN LEAD TO DUPLICATING VALIDATORS KEYS, WHICH CAN LEAD TO SLASHING.\n");

    if (mnemonicInputPath) {
      mnemonic = fs.readFileSync(mnemonicInputPath, "utf8").trim();
    } else {
      const input = await inquirer.prompt<{mnemonic: string}>([
        {
          name: "mnemonic",
          type: "input",
          message: "Enter the mnemonic phrase:",
        },
      ]);
      mnemonic = input.mnemonic;
    }

    const {uuid} = await createWalletFromArgsAndMnemonic(args, mnemonic);

    console.log(`Your wallet has been successfully recovered.
Your wallet's UUID is:

\t${uuid}

You do not need to backup your UUID or keep it secret.
`);

    return [uuid];
  },
};
