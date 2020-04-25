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
