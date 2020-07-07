import {CommandBuilder} from "yargs";

import {accountValidatorOptions, IAccountValidatorOptions} from "./options";
import * as create from "./create";
import * as deposit from "./deposit";

export const command = "validator <command>";

export const description = "Provides commands for managing Eth2 validators.";

export const builder: CommandBuilder<{}, IAccountValidatorOptions> = (yargs) => {
  return yargs
    .options(accountValidatorOptions)
    .command(create)
    .command(deposit);
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {}
