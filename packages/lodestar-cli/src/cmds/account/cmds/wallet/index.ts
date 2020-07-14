import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {accountWalletsOptions, IAccountWalletOptions} from "./options";
import * as create from "./create";
import * as list from "./list";

export const wallet: CommandModule<IGlobalArgs, IAccountWalletOptions> = {
  command: "wallet <command>",
  describe: "Provides commands for managing Eth2 wallets.",
  builder: (yargs) => yargs
    .options(accountWalletsOptions)
    .command(create)
    .command(list),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
