import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {validator} from "./cmds/validator/index.js";
import {wallet} from "./cmds/wallet/index.js";

export const account: ICliCommand<Record<never, never>, IGlobalArgs> = {
  command: "account <command>",
  describe: "Utilities for generating and managing Ethereum Consensus accounts",
  subcommands: [validator, wallet],
};
