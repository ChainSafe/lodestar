import {ICliCommandOptions} from "../../../util/index.js";
import {IValidatorCliArgs, validatorOptions} from "../options.js";

export type ISlashingProtectionArgs = Pick<IValidatorCliArgs, "server"> & {
  force?: boolean;
  fetchCustomGenesis?: boolean;
};

export const slashingProtectionOptions: ICliCommandOptions<ISlashingProtectionArgs> = {
  server: validatorOptions.server,

  force: {
    description: "If genesisValidatorsRoot can't be fetched from the Beacon node, use a zero hash",
    type: "boolean",
  },
  fetchCustomGenesis: {
    description: "Fetch genesisValidatorsRoot from beacon node for custom network",
    type: "boolean",
  },
};
