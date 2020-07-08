import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {accountValidatorOptions, IAccountValidatorOptions} from "./options";
import * as create from "./create";
import * as deposit from "./deposit";

export const validator: CommandModule<IGlobalArgs, IAccountValidatorOptions> = {
  command: "validator <command>",
  describe: "Provides commands for managing Eth2 validators.",
  builder: (yargs) => yargs
    .options(accountValidatorOptions)
    .command(create)
    .command(deposit),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
