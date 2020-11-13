import {ICliCommandOptions} from "../../../../../util";
import {IValidatorCliArgs, validatorOptions} from "../../../../validator/options";

export type ISlashingProtectionArgs = Pick<IValidatorCliArgs, "server"> & {
  force?: boolean;
};

export const slashingProtectionOptions: ICliCommandOptions<ISlashingProtectionArgs> = {
  server: validatorOptions.server,

  force: {
    description: "If genesisValidatorsRoot can't be fetched from the Beacon node, use a zero hash",
    type: "boolean",
  },
};
