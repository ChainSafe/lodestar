import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type MetricsArgs = {
  metrics: boolean;
  "metrics.port": number;
  "metrics.address": string;
};

export function parseArgs(args: MetricsArgs): IBeaconNodeOptions["metrics"] {
  return {
    enabled: args["metrics"],
    port: args["metrics.port"],
    address: args["metrics.address"],
  };
}

export const options: CliCommandOptions<MetricsArgs> = {
  metrics: {
    type: "boolean",
    description: "Enable the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.enabled),
    group: "metrics",
  },

  "metrics.port": {
    type: "number",
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.port),
    group: "metrics",
  },

  "metrics.address": {
    type: "string",
    description: "Listen address for the Prometheus metrics HTTP server",
    defaultDescription: String(defaultOptions.metrics.address),
    group: "metrics",
  },
};
