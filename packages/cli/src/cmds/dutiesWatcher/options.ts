import {ICliCommandOptions, ILogArgs} from "../../util";
import {beaconPathsOptions, logOptions} from "../beacon/options";
import {IBeaconPaths} from "../beacon/paths";

export type IDutiesWatcherArgs = ILogArgs & {
  logFile: IBeaconPaths["logFile"];
  beaconApiUrl: string;
  validatorIndexes: string;
};

export const dutiesWatcherOptions: ICliCommandOptions<IDutiesWatcherArgs> = {
  ...logOptions,
  logFile: beaconPathsOptions.logFile,
  beaconApiUrl: {
    description: "Url to a beacon node that support lightclient API",
    type: "string",
    require: true,
  },
  validatorIndexes: {
    hidden: false,
    description: "Range (inclusive) of validator key indexes to validate with: 270000..270016",
    type: "string",
    default: "270000..270016",
  },
};
