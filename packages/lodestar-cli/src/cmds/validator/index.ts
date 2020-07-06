import {CommandModule} from "yargs";
import {run} from "./run";
import {validatorOptions, IValidatorCliOptions} from "./options";
import {IGlobalArgs} from "../../options";

export const validatorCommandModule: CommandModule<IGlobalArgs, IValidatorCliOptions> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  builder: validatorOptions,
  handler: run,
};
