import {Argv} from "yargs";

import * as create from "./create";
import * as list from "./list";

export const command = "wallet <command>";

export const description = "Provides commands for managing Eth2 wallets.";

export function builder(yargs: Argv<{}>): Argv {
  return yargs
    .command(create)
    .command(list);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {}
