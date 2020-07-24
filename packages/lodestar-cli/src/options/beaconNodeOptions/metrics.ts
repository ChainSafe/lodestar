import {Options} from "yargs";

export const metricsOptions = {
  "metrics.enabled": {
    type: "boolean",
    default: false,
    group: "metrics",
  } as Options,

  "metrics.timeout": {
    type: "number",
    default: 5000,
    group: "metrics",
  } as Options,

  "metrics.pushGateway": {
    type: "boolean",
    default: false,
    group: "metrics",
  } as Options,

  "metrics.gatewayUrl": {
    type: "string",
    default: "",
    group: "metrics",
  } as Options,

  "metrics.serverPort": {
    type: "number",
    default: 8008,
    group: "metrics",
  } as Options,
};
