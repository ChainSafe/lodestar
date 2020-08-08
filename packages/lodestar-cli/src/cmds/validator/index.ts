import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {validatorOptions, IValidatorCliArgs} from "./options";
import {validatorHandler} from "./handler";

export const validator: ICliCommand<IValidatorCliArgs, IGlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  options: validatorOptions,
  handler: validatorHandler
};
