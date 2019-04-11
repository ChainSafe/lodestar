import {CommanderStatic} from "commander";

export interface ICliCommand {

  register(commander: CommanderStatic): void;

}
