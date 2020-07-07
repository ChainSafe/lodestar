import {CommandBuilder} from "yargs";

import {accountWalletsOptions, IAccountWalletOptions} from "./options";
import * as create from "./create";
import * as list from "./list";

export const command = "wallet <command>";

export const description = "Provides commands for managing Eth2 wallets.";

export const builder: CommandBuilder<{}, IAccountWalletOptions> = (yargs) => {
  return yargs
    .options(accountWalletsOptions)
    .command(create)
    .command(list);
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {}
