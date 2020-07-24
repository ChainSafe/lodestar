import { IYargsOptionsMap } from "../../../../../util/yargs";

export const metricsOptions: IYargsOptionsMap = {
  "metrics.enabled": {
    type: "boolean",
    default: false,
    group: "metrics",
  },

  "metrics.timeout": {
    type: "number",
    default: 5000,
    group: "metrics",
  },

  "metrics.pushGateway": {
    type: "boolean",
    default: false,
    group: "metrics",
  },

  "metrics.gatewayUrl": {
    type: "string",
    default: "",
    group: "metrics",
  },

  "metrics.serverPort": {
    type: "number",
    default: 8008,
    group: "metrics",
  },
};
