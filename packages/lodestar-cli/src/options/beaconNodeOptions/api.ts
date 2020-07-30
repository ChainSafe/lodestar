import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const apiOptions = {
  "api.namespaces": {
    alias: ["api.namespaces", "api.rest.api"],
    type: "array",
    choices: ["beacon", "validator"],
    defaultDescription: JSON.stringify(defaultOptions.api.rest.api),
    group: "api",
  } as Options,

  "api.cors.origin": {
    alias: ["api.cors.origin", "api.rest.cors"],
    type: "string",
    defaultDescription: defaultOptions.api.rest.cors,
    group: "api",
  } as Options,

  "api.enabled": {
    alias: ["api.enabled", "api.rest.enabled"],
    type: "boolean",
    defaultDescription: String(defaultOptions.api.rest.enabled),
    group: "api",
  } as Options,

  "api.host": {
    alias: ["api.host", "api.rest.host"],
    type: "string",
    defaultDescription: defaultOptions.api.rest.host,
    group: "api",
  } as Options,

  "api.port": {
    alias: ["api.port", "api.rest.port"],
    type: "number",
    defaultDescription: String(defaultOptions.api.rest.port),
    group: "api",
  } as Options
};
