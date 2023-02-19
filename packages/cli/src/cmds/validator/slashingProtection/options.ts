import {CliCommandOptions} from "../../../util/index.js";
import {IValidatorCliArgs, validatorOptions} from "../options.js";

export type ISlashingProtectionArgs = Pick<IValidatorCliArgs, "beaconNodes"> & {
  force?: boolean;
};

export const slashingProtectionOptions: CliCommandOptions<ISlashingProtectionArgs> = {
  beaconNodes: validatorOptions.beaconNodes,

  force: {
    description: "If genesisValidatorsRoot can't be fetched from the Beacon node, use a zero hash",
    type: "boolean",
  },
};
