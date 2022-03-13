import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {accountWalletsOptions, IAccountWalletArgs} from "./options";
import {create} from "./create";
import {list} from "./list";
import {recover} from "./recover";

export const wallet: ICliCommand<IAccountWalletArgs, IGlobalArgs> = {
  command: "wallet <command>",
  describe: "Provides commands for managing Ethereum Consensus wallets.",
  options: accountWalletsOptions,
  subcommands: [create, list, recover],
};
