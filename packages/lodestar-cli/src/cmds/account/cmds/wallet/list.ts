import {ICliCommand} from "../../../../util";
import {WalletManager} from "../../../../wallet";
import {getAccountPaths} from "../../paths";
import {IGlobalArgs} from "../../../../options";
import {IAccountWalletArgs} from "./options";

export const list: ICliCommand<{}, IAccountWalletArgs & IGlobalArgs> = {
  command: "list",

  describe: "Lists the names of all wallets",

  handler: async (options) => {
    const accountPaths = getAccountPaths(options);
    const walletManager = new WalletManager(accountPaths);
    for (const {name} of walletManager.wallets()) {
      // eslint-disable-next-line no-console
      console.log(name);
    }
  }
};

