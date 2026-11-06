import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../../options/index.js";
import {ISignerCliArgs} from "../options.js";
import {exportCmd} from "./export.js";
import {importCmd} from "./import.js";

export const slashingProtection: CliCommand<Record<never, never>, ISignerCliArgs & GlobalArgs> = {
  command: "slashing-protection <command>",
  describe: "Import or export slashing protection data to or from another client.",
  options: {},
  subcommands: [importCmd, exportCmd],
};
