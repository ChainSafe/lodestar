import {ICliCommand, readFileIfExists} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import inquirer from "inquirer";
import {createWalletFromArgsAndMnemonic, printUuidData} from "./utils";
import {IWalletCreateArgs, walletCreateOptions} from "./create";

export type IWalletRecoverArgs = IWalletCreateArgs & {
  mnemonicPath: string;
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
    mnemonicPath: {
      description: "If present, the mnemonic will be read in from this file.",
      type: "string",
    },
  },

  handler: async (args) => {
    const {mnemonicPath} = args;
    let mnemonic;

    console.log("\nWARNING: KEY RECOVERY CAN LEAD TO DUPLICATING VALIDATORS KEYS, WHICH CAN LEAD TO SLASHING.\n");

    if (mnemonicPath) {
      mnemonic = readFileIfExists(mnemonicPath);
    } else {
      const input = await inquirer.prompt([
        {
          name: "mnemonic",
          type: "input",
          message: "Enter the mnemonic phrase:",
        },
      ]);
      mnemonic = input.mnemonic;
    }

    const {uuid} = await createWalletFromArgsAndMnemonic(args, mnemonic);

    console.log!("Your wallet has been successfully recovered.", printUuidData(uuid));

    return [uuid];
  },
};
