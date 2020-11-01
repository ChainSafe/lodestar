import {ICliCommand} from "../../../../../util";
import {IAccountValidatorArgs} from "../options";
import {importCmd} from "./import";
import {exportCmd} from "./export";

/* eslint-disable no-console */

export const validator: ICliCommand<{}, IAccountValidatorArgs> = {
  command: "slashing-protection <command>",
  describe: "Import or export slashing protection data to or from another client.",
  options: {},
  subcommands: [importCmd, exportCmd],
};
