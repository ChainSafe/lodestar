import {ICliCommand} from "../../../../../util";
import {IAccountValidatorArgs} from "../options";
import {ISlashingProtectionArgs, slashingProtectionOptions} from "./options";
import {importCmd} from "./import";
import {exportCmd} from "./export";

export const slashingProtection: ICliCommand<ISlashingProtectionArgs, IAccountValidatorArgs> = {
  command: "slashing-protection <command>",
  describe: "Import or export slashing protection data to or from another client.",
  options: slashingProtectionOptions,
  subcommands: [importCmd, exportCmd],
};
