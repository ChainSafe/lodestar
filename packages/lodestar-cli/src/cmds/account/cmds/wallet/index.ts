import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {accountWalletsOptions, IAccountWalletOptions} from "./options";
import {create} from "./create";
import {list} from "./list";

export const wallet: ICliCommand<IAccountWalletOptions, IGlobalArgs> = {
  command: "wallet <command>",
  describe: "Provides commands for managing Eth2 wallets.",
  options: accountWalletsOptions,
  subcommands: [create, list],
};
