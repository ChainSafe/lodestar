import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

export interface IMonitoringArgs {
  "monitoring.endpoint": string;
  "monitoring.interval": number;
}

export function parseArgs(args: IMonitoringArgs): IBeaconNodeOptions["monitoring"] {
  return {
    endpoint: args["monitoring.endpoint"],
    interval: args["monitoring.interval"],
  };
}

export const options: ICliCommandOptions<IMonitoringArgs> = {
  "monitoring.endpoint": {
    type: "string",
    description:
      "Enables monitoring service for sending clients stats to the specified endpoint of a remote server (e.g. beaconcha.in). It is required that metrics are enabled by supplying the --metrics flag.",
    group: "monitoring",
  },

  "monitoring.interval": {
    type: "number",
    description: "Interval in seconds between sending client stats to the remote server",
    defaultDescription: String(defaultOptions.monitoring.interval),
    group: "monitoring",
    hidden: true,
  },
};
