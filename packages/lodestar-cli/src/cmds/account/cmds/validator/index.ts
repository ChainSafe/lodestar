import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {accountValidatorOptions, IAccountValidatorOptions} from "./options";
import {create} from "./create";
// import * as deposit from "./deposit";
// import * as list from "./list";
// import * as importCmd from "./import";

export const validator: ICliCommand<IAccountValidatorOptions, IGlobalArgs> = {
// CommandModule<IGlobalArgs, IAccountValidatorOptions> = {
  command: "validator <command>",
  describe: "Provides commands for managing Eth2 validators.",
  options: accountValidatorOptions,
  subcommands: [create],
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {}
};
