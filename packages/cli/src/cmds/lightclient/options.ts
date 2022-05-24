import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {beaconPathsOptions, logOptions} from "../beacon/options.js";
import {IBeaconPaths} from "../beacon/paths.js";

export type ILightClientArgs = ILogArgs & {
  logFile: IBeaconPaths["logFile"];
  beaconApiUrl: string;
  checkpointRoot: string;
};

export const lightclientOptions: ICliCommandOptions<ILightClientArgs> = {
  ...logOptions,
  logFile: beaconPathsOptions.logFile,
  beaconApiUrl: {
    description: "Url to a beacon node that support lightclient API",
    type: "string",
    require: true,
  },
  checkpointRoot: {
    description: "Checkpoint root hex string to sync the lightclient from, start with 0x",
    type: "string",
    require: true,
  },
};
