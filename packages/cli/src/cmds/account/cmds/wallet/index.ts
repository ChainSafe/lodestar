import {ICliCommand} from "../../../../util/index.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {accountWalletsOptions, IAccountWalletArgs} from "./options.js";
import {create} from "./create.js";
import {list} from "./list.js";
import {recover} from "./recover.js";

export const wallet: ICliCommand<IAccountWalletArgs, IGlobalArgs> = {
  command: "wallet <command>",
  describe: "Provides commands for managing Ethereum Consensus wallets.",
  options: accountWalletsOptions,
  subcommands: [create, list, recover],
};
