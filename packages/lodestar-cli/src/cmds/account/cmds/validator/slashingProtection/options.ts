import {ICliCommandOptions} from "../../../../../util";
import {IValidatorCliArgs, validatorOptions} from "../../../../validator/options";

export type ISlashingProtectionArgs = Pick<IValidatorCliArgs, "server">;

export const slashingProtectionOptions: ICliCommandOptions<ISlashingProtectionArgs> = {
  server: validatorOptions.server,
};
