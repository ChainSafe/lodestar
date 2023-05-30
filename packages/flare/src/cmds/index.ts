import {CliCommand} from "../util/command.js";
import {selfSlashProposer} from "./self_slash_proposer.js";
import {selfSlashAttester} from "./self_slash_attester.js";

export const cmds: Required<CliCommand<Record<never, never>, Record<never, never>>>["subcommands"] = [
  selfSlashProposer,
  selfSlashAttester,
];
