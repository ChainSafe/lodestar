import {logOptions} from "../../options/logOptions.js";
import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {ExecutionEngineArgs, options} from "../../options/beaconNodeOptions/execution.js";

export type ILightClientArgs = ILogArgs & {
  beaconApiUrl: string;
  checkpointRoot: string;
};

export const lightclientOptions: ICliCommandOptions<ILightClientArgs & ExecutionEngineArgs> = {
  ...logOptions,
  ...options,
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
