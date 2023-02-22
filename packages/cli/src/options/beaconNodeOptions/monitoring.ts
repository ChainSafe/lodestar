import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type MonitoringArgs = {
  "monitoring.endpoint": string;
  "monitoring.interval": number;
  "monitoring.initialDelay": number;
  "monitoring.requestTimeout": number;
  "monitoring.collectSystemStats": boolean;
};

export function parseArgs(args: MonitoringArgs): IBeaconNodeOptions["monitoring"] {
  return {
    endpoint: args["monitoring.endpoint"],
    interval: args["monitoring.interval"],
    initialDelay: args["monitoring.initialDelay"],
    requestTimeout: args["monitoring.requestTimeout"],
    collectSystemStats: args["monitoring.collectSystemStats"],
  };
}

export const options: CliCommandOptions<MonitoringArgs> = {
  "monitoring.endpoint": {
    type: "string",
    description:
      "Enables monitoring service for sending clients stats to the specified endpoint of a remote service (e.g. beaconcha.in). It is required that metrics are also enabled by supplying the --metrics flag.",
    group: "monitoring",
  },

  "monitoring.interval": {
    type: "number",
    description: "Interval in milliseconds between sending client stats to the remote service",
    defaultDescription: String(defaultOptions.monitoring.interval),
    group: "monitoring",
  },

  "monitoring.initialDelay": {
    type: "number",
    description: "Initial delay in milliseconds before client stats are sent to the remote service",
    defaultDescription: String(defaultOptions.monitoring.initialDelay),
    group: "monitoring",
    hidden: true,
  },

  "monitoring.requestTimeout": {
    type: "number",
    description: "Timeout in milliseconds for sending client stats to the remote service",
    defaultDescription: String(defaultOptions.monitoring.requestTimeout),
    group: "monitoring",
    hidden: true,
  },

  "monitoring.collectSystemStats": {
    type: "boolean",
    description:
      "Enable collecting system stats. By default, the beacon node will collect system stats but this can also be handled by the validator client.",
    defaultDescription: String(defaultOptions.monitoring.collectSystemStats),
    group: "monitoring",
    hidden: true,
  },
};
