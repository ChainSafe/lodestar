import {CommandBuilder} from "yargs";
import {WalletManager} from "../../../../wallet";
import {IGlobalArgs} from "../../../../options";

export const command = "list";

export const description = "Lists the names of all wallets";

export const builder: CommandBuilder<{}, IGlobalArgs> = {};

export function handler(options: IGlobalArgs): void {
  const baseDir = options.rootDir;

  const walletManager = new WalletManager(baseDir);

  for (const {name} of walletManager.wallets()) {
    // eslint-disable-next-line no-console
    console.log(name);
  }
}
