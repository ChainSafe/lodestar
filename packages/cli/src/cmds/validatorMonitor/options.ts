import {ICliCommandOptions, ILogArgs} from "../../util";
import {beaconPathsOptions, logOptions} from "../beacon/options";
import {IBeaconPaths} from "../beacon/paths";

export type IValidatorMonitorArgs = ILogArgs & {
  logFile: IBeaconPaths["logFile"];
  beaconApiUrl: string;
  validatorIndexes: string;
};

export const validatorMonitorOptions: ICliCommandOptions<IValidatorMonitorArgs> = {
  ...logOptions,
  logFile: beaconPathsOptions.logFile,
  beaconApiUrl: {
    description: "Url to a beacon node",
    type: "string",
    require: true,
  },
  validatorIndexes: {
    description: "Range (inclusive) of validator key indexes to monitor",
    type: "string",
    require: true,
  },
};
