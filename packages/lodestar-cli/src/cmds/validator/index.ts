import {CommandModule} from "yargs";
import {run} from "./run";
import {mergeValidatorOptions, IValidatorCliArgs} from "./options";
import {IGlobalArgs} from "../../options";

export const validatorCommandModule: CommandModule<IGlobalArgs, IValidatorCliArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  builder: mergeValidatorOptions,
  handler: run,
};
