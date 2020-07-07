import {CommandBuilder} from "yargs";
import {WalletManager} from "../../../../wallet";
import {IGlobalArgs} from "../../../../options";
import {getAccountPaths} from "../../paths";

export const command = "list";

export const description = "Lists the names of all wallets";

export const builder: CommandBuilder<{}, IGlobalArgs> = {};

export function handler(options: IGlobalArgs): void {
  const accountPaths = getAccountPaths(options);

  const walletManager = new WalletManager(accountPaths);

  for (const {name} of walletManager.wallets()) {
    // eslint-disable-next-line no-console
    console.log(name);
  }
}
