import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {validator} from "./cmds/validator";
import {wallet} from "./cmds/wallet";

export const account: CommandModule<IGlobalArgs, IGlobalArgs> = {
  command: ["account <command>", "am", "a"],
  describe: "Utilities for generating and managing Ethereum 2.0 accounts",
  builder: (yargs) => yargs
    .command(validator)
    .command(wallet),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
