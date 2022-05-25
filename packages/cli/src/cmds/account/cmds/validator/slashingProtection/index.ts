import {ICliCommand} from "../../../../../util/index.js";
import {IAccountValidatorArgs} from "../options.js";
import {ISlashingProtectionArgs, slashingProtectionOptions} from "./options.js";
import {importCmd} from "./import.js";
import {exportCmd} from "./export.js";

export const slashingProtection: ICliCommand<ISlashingProtectionArgs, IAccountValidatorArgs> = {
  command: "slashing-protection <command>",
  describe: "Import or export slashing protection data to or from another client.",
  options: slashingProtectionOptions,
  subcommands: [importCmd, exportCmd],
};
