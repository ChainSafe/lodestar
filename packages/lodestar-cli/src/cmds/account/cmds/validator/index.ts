import {Argv} from "yargs";

import * as create from "./create";
import * as deposit from "./deposit";

export const command = "validator <command>";

export const description = "Provides commands for managing Eth2 validators.";

export function builder(yargs: Argv<{}>): Argv {
  return yargs
    .command(create)
    .command(deposit);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {}
