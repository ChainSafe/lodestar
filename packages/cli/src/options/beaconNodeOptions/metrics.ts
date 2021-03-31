import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IMetricsArgs {
  "metrics.enabled": boolean;
  "metrics.gatewayUrl": string;
  "metrics.serverPort": number;
  "metrics.timeout": number;
  "metrics.listenAddr": string;
}

export function parseArgs(args: IMetricsArgs): IBeaconNodeOptions["metrics"] {
  return {
    enabled: args["metrics.enabled"],
    gatewayUrl: args["metrics.gatewayUrl"],
    serverPort: args["metrics.serverPort"],
    timeout: args["metrics.timeout"],
    listenAddr: args["metrics.listenAddr"],
  };
}

export const options: ICliCommandOptions<IMetricsArgs> = {
  "metrics.enabled": {
    type: "boolean",
    description: "Enable metrics",
    defaultDescription: String(defaultOptions.metrics.enabled),
    group: "metrics",
  },

  "metrics.gatewayUrl": {
    type: "string",
    description: "Gateway URL for metrics",
    defaultDescription: defaultOptions.metrics.gatewayUrl || "",
    group: "metrics",
  },

  "metrics.serverPort": {
    type: "number",
    description: "Server port for metrics",
    defaultDescription: String(defaultOptions.metrics.serverPort),
    group: "metrics",
  },

  "metrics.timeout": {
    type: "number",
    description: "How often metrics should be probed",
    defaultDescription: String(defaultOptions.metrics.timeout),
    group: "metrics",
  },

  "metrics.listenAddr": {
    type: "string",
    description: "The address for the metrics http server to listen on",
    defaultDescription: String(defaultOptions.metrics.listenAddr),
    group: "metrics",
  },
};
