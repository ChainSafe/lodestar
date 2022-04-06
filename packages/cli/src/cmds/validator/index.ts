import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {getAccountPaths} from "../account/paths.js";
import {validatorOptions, IValidatorCliArgs} from "./options.js";
import {validatorHandler} from "./handler.js";

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
