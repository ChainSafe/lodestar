import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {getAccountPaths} from "../account/paths";
import {validatorHandler} from "./handler";
import {validatorOptions, IValidatorCliArgs} from "./options";

export const validator: ICliCommand<IValidatorCliArgs, IGlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  examples: [
    {
      command: "validator --network prater",
      description:
        "Run one validator client with all the keystores available in the directory" +
        ` ${getAccountPaths({rootDir: ".prater"}).keystoresDir}`,
    },
  ],
  options: validatorOptions,
  handler: validatorHandler,
};
