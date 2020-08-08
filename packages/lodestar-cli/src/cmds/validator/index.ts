import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {validatorOptions, IValidatorCliOptions} from "./options";
import {run} from "./run";

export const validator: ICliCommand<IValidatorCliOptions, IGlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  options: validatorOptions,
  handler: run
};
