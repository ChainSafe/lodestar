import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {validator} from "./cmds/validator";
import {wallet} from "./cmds/wallet";

export const account: ICliCommand<Record<never, never>, IGlobalArgs> = {
  command: "account <command>",
  describe: "Utilities for generating and managing Ethereum Consensus accounts",
  subcommands: [validator, wallet],
};
