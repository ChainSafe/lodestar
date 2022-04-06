import {ICliCommand} from "../../../../util/index.js";
import {WalletManager} from "../../../../wallet/index.js";
import {getAccountPaths} from "../../paths.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {IAccountWalletArgs} from "./options.js";

export type ReturnType = string[];

export const list: ICliCommand<Record<never, never>, IAccountWalletArgs & IGlobalArgs, ReturnType> = {
  command: "list",

  describe: "Lists the names of all wallets",

  examples: [
    {
      command: "account wallet list --walletsDir .network/wallets",
      description: "List all wallets in .network/wallets",
    },
  ],

  handler: async (args) => {
    const accountPaths = getAccountPaths(args);
    const walletManager = new WalletManager(accountPaths);
    const walletNames = walletManager.wallets().map(({name}) => name);
    // eslint-disable-next-line no-console
    console.log(walletNames.join("\n"));

    // Return values for testing
    return walletNames;
  },
};
