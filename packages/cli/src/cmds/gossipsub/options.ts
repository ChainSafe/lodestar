import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {beaconPathsOptions, logOptions} from "../beacon/options.js";
import {IBeaconPaths} from "../beacon/paths.js";

export type IGossipSubArgs = ILogArgs & {
  logFile: IBeaconPaths["logFile"];
  receiver: boolean;
};

export const gossipsubOptions: ICliCommandOptions<IGossipSubArgs> = {
  ...logOptions,
  logFile: beaconPathsOptions.logFile,
  receiver: {
    description: "receiver mode or sender mode",
    type: "boolean",
    require: true,
  },
};
