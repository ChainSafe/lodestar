import {CommandBuilder} from "yargs";
import {WalletManager} from "../../../../wallet";
import {getAccountPaths} from "../../paths";
import {IAccountWalletOptions} from "./options";

export const command = "list";

export const description = "Lists the names of all wallets";

export const builder: CommandBuilder<{}, IAccountWalletOptions> = {};

export async function handler(options: IAccountWalletOptions): Promise<void> {
  const accountPaths = getAccountPaths(options);

  const walletManager = new WalletManager(accountPaths);

  for (const {name} of walletManager.wallets()) {
    // eslint-disable-next-line no-console
    console.log(name);
  }
}
