import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {getAccountPaths} from "../account/paths";
import {validatorOptions, IValidatorCliArgs} from "./options";
import {validatorHandler} from "./handler";

export const validator: ICliCommand<IValidatorCliArgs, IGlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  examples: [
    {
      command: "validator --network medalla",
      description:
        "Run one validator client with all the keystores available in the directory" +
        ` ${getAccountPaths({rootDir: ".medalla"}).keystoresDir}`,
    },
  ],
  options: validatorOptions,
  handler: validatorHandler,
};
