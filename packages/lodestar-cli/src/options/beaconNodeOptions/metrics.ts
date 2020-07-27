import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const metricsOptions = {
  "metrics.enabled": {
    type: "boolean",
    defaultDescription: String(defaultOptions.metrics.enabled),
    group: "metrics",
  } as Options,

  "metrics.gatewayUrl": {
    type: "string",
    defaultDescription: defaultOptions.metrics.gatewayUrl || "",
    group: "metrics",
  } as Options,

  "metrics.pushGateway": {
    type: "boolean",
    defaultDescription: String(defaultOptions.metrics.pushGateway),
    group: "metrics",
  } as Options,

  "metrics.serverPort": {
    type: "number",
    defaultDescription: String(defaultOptions.metrics.serverPort),
    group: "metrics",
  } as Options,

  "metrics.timeout": {
    type: "number",
    defaultDescription: String(defaultOptions.metrics.timeout),
    group: "metrics",
  } as Options
};
