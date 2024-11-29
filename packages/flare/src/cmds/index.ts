import {CliCommand} from "@lodestar/utils";
import {selfSlashAttester} from "./selfSlashAttester.js";
import {selfSlashProposer} from "./selfSlashProposer.js";

export const cmds: Required<CliCommand<Record<never, never>, Record<never, never>>>["subcommands"] = [
  selfSlashProposer,
  selfSlashAttester,
];
