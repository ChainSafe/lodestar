import {ICliCommand} from "../../../../util/index.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {accountValidatorOptions, IAccountValidatorArgs} from "./options.js";
import {create} from "./create.js";
import {deposit} from "./deposit.js";
import {importCmd} from "./import.js";
import {list} from "./list.js";
import {slashingProtection} from "./slashingProtection/index.js";
import {voluntaryExit} from "./voluntaryExit.js";
import {recover} from "./recover.js";

export const validator: ICliCommand<IAccountValidatorArgs, IGlobalArgs> = {
  command: "validator <command>",
  describe: "Provides commands for managing Ethereum Consensus validators.",
  options: accountValidatorOptions,
  subcommands: [create, deposit, importCmd, list, recover, slashingProtection, voluntaryExit],
};
