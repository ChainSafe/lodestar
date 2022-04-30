import {ICliCommandOptions, ILogArgs} from "../../util";
import {beaconPathsOptions, logOptions} from "../beacon/options";
import {IBeaconPaths} from "../beacon/paths";

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
