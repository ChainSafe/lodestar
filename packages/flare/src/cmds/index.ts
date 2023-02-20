import {CliCommand} from "../util/command.js";
import {selfSlashProposer} from "./selfSlashProposer.js";
import {selfSlashAttester} from "./selfSlashAttester.js";

export const cmds: Required<CliCommand<Record<never, never>, Record<never, never>>>["subcommands"] = [
  selfSlashProposer,
  selfSlashAttester,
];
