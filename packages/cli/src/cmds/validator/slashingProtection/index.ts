import {CliCommand} from "../../../util/index.js";
import {AccountValidatorArgs} from "../options.js";
import {ISlashingProtectionArgs, slashingProtectionOptions} from "./options.js";
import {importCmd} from "./import.js";
import {exportCmd} from "./export.js";

export const slashingProtection: CliCommand<ISlashingProtectionArgs, AccountValidatorArgs> = {
  command: "slashing-protection <command>",
  describe: "Import or export slashing protection data to or from another client.",
  options: slashingProtectionOptions,
  subcommands: [importCmd, exportCmd],
};
