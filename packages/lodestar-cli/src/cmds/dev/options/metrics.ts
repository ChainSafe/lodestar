import {Options} from "yargs";

export const metricsEnabled: Options = {
  alias: [
    "metrics.enabled",
  ],
  type: "boolean",
  default: false,
  group: "metrics",
};

export const metricsServerPort: Options = {
  alias: [
    "metrics.serverPort",
  ],
  type: "number",
  default: 5000,
  group: "metrics",
};

export const metricsTimeout: Options = {
  alias: [
    "metrics.timeout",
  ],
  type: "number",
  default: 5000,
  group: "metrics",
};

export const metricsPushGateway: Options = {
  alias: [
    "metrics.pushGateway",
  ],
  type: "boolean",
  default: false,
  group: "metrics",
};

export const metricsGatewayUrl: Options = {
  alias: [
    "metrics.gatewayUrl",
  ],
  type: "string",
  default: "",
  group: "metrics",
};
