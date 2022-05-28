import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util/index.js";

export interface IMetricsArgs {
  "metrics.enabled": boolean;
  "metrics.port": number;
  "metrics.address": string;
}

export function parseArgs(args: IMetricsArgs): IBeaconNodeOptions["metrics"] {
  return {
    enabled: args["metrics.enabled"],
    port: args["metrics.port"],
    address: args["metrics.address"],
  };
}

export const options: ICliCommandOptions<IMetricsArgs> = {
  "metrics.enabled": {
    type: "boolean",
    description: "Enable the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.enabled),
    group: "metrics",
  },

  "metrics.port": {
    type: "number",
    alias: ["metrics.serverPort"], // For backwards compatibility
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.port),
    group: "metrics",
  },

  "metrics.address": {
    type: "string",
    alias: ["metrics.listenAddr"], // For backwards compatibility
    description: "Listen address for the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.address),
    group: "metrics",
  },
};
