import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";

export type ILightClientArgs = LogArgs & {
  beaconApiUrl: string;
  checkpointRoot: string;
};

export const lightclientOptions: CliCommandOptions<ILightClientArgs> = {
  ...logOptions,
  beaconApiUrl: {
    description: "Url to a beacon node that support lightclient API",
    type: "string",
    demandOption: true,
  },
  checkpointRoot: {
    description: "Checkpoint root hex string to sync the lightclient from, start with 0x",
    type: "string",
    demandOption: true,
  },
};
