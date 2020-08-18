import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const metricsOptions = {
  "metrics.enabled": {
    type: "boolean",
    description: "Enable metrics",
    defaultDescription: String(defaultOptions.metrics.enabled),
    group: "metrics",
  } as Options,

  "metrics.gatewayUrl": {
    type: "string",
    description: "Gateway URL for metrics",
    defaultDescription: defaultOptions.metrics.gatewayUrl || "",
    group: "metrics",
  } as Options,

  "metrics.pushGateway": {
    type: "boolean",
    description: "Enable/disable Prometheus Pushgateway for metrics",
    defaultDescription: String(defaultOptions.metrics.pushGateway),
    group: "metrics",
  } as Options,

  "metrics.serverPort": {
    type: "number",
    description: "Server port for metrics",
    defaultDescription: String(defaultOptions.metrics.serverPort),
    group: "metrics",
  } as Options,

  "metrics.timeout": {
    type: "number",
    description: "How often metrics should be probed",
    defaultDescription: String(defaultOptions.metrics.timeout),
    group: "metrics",
  } as Options
};
