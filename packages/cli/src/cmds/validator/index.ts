import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {blsToExecutionChange} from "./blsToExecutionChange.js";
import {validatorHandler} from "./handler.js";
import {importCmd} from "./import.js";
import {list} from "./list.js";
import {IValidatorCliArgs, validatorOptions} from "./options.js";
import {getAccountPaths} from "./paths.js";
import {slashingProtection} from "./slashingProtection/index.js";
import {voluntaryExit} from "./voluntaryExit.js";

export const validator: CliCommand<IValidatorCliArgs, GlobalArgs> = {
  command: "validator",
  describe: "Run one or multiple validator clients",
  docsFolder: "run/validator-management",
  examples: [
    {
      command: "validator --network holesky",
      title: "Base `validator` command",
      description:
        "Run one validator client with all the keystores available in the directory" +
        ` ${getAccountPaths({dataDir: ".holesky"}, "holesky").keystoresDir}`,
    },
  ],
  options: validatorOptions,
  handler: validatorHandler,
  subcommands: [slashingProtection, importCmd, list, voluntaryExit, blsToExecutionChange],
};
