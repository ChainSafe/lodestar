import {CliCommand} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {getAccountPaths} from "./paths.js";
import {slashingProtection} from "./slashingProtection/index.js";
import {importCmd} from "./import.js";
import {list} from "./list.js";
import {voluntaryExit} from "./voluntaryExit.js";
import {blsToExecutionChange} from "./blsToExecutionChange.js";
import {validatorOptions, IValidatorCliArgs} from "./options.js";
import {validatorHandler} from "./handler.js";

export const validator: CliCommand<IValidatorCliArgs, GlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  examples: [
    {
      command: "validator --network goerli",
      description:
        "Run one validator client with all the keystores available in the directory" +
        ` ${getAccountPaths({dataDir: ".goerli"}, "goerli").keystoresDir}`,
    },
  ],
  options: validatorOptions,
  handler: validatorHandler,
  subcommands: [slashingProtection, importCmd, list, voluntaryExit, blsToExecutionChange],
};
