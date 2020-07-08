import {CommandModule} from "yargs";
import {IGlobalArgs} from "../../options";
import {validatorOptions, IValidatorCliOptions} from "./options";
import {run} from "./run";

export const validator: CommandModule<IGlobalArgs, IValidatorCliOptions> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  builder: validatorOptions,
  handler: run
};
