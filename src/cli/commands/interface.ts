import {CommanderStatic} from "commander";

export interface CliCommand {

  register(commander: CommanderStatic): void;

}
