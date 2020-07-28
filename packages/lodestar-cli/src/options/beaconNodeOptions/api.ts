import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const apiOptions = {
  "api.rest.api": {
    alias: ["api.namespaces"],
    type: "array",
    choices: ["beacon", "validator"],
    description: "Pick namespaces to expose for HTTP API",
    defaultDescription: JSON.stringify(defaultOptions.api.rest.api),
    group: "api",
  } as Options,

  "api.rest.cors": {
    alias: ["api.cors.origin"],
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for HTTP API",
    defaultDescription: defaultOptions.api.rest.cors,
    group: "api",
  } as Options,

  "api.rest.enabled": {
    alias: ["api.enabled"],
    type: "boolean",
    description: "Enable/disable HTTP API",
    defaultDescription: String(defaultOptions.api.rest.enabled),
    group: "api",
  } as Options,

  "api.rest.host": {
    alias: ["api.host"],
    type: "string",
    description: "Set host for HTTP API",
    defaultDescription: defaultOptions.api.rest.host,
    group: "api",
  } as Options,

  "api.rest.port": {
    alias: ["api.port"],
    type: "number",
    description: "Set port for HTTP API",
    defaultDescription: String(defaultOptions.api.rest.port),
    group: "api",
  } as Options
};
