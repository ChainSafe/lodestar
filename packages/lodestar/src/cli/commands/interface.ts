/**
 * @module cli/commands
 */

import {CommanderStatic} from "commander";

export interface CliCommand {

  register(commander: CommanderStatic): void;

}
