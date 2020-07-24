import {Options} from "yargs";

export const apiOptions = {
  "api.rest.enabled": {
    alias: ["api.enabled"],
    type: "boolean",
    default: false,
    group: "api",
  } as Options,

  "api.rest.api": {
    alias: ["api.namespaces"],
    type: "array",
    choices: ["beacon", "validator"],
    default: ["beacon", "validator"],
    group: "api",
  } as Options,

  "api.rest.host": {
    alias: ["api.host"],
    type: "string",
    default: "127.0.0.1",
    group: "api",
  } as Options,

  "api.rest.port": {
    alias: ["api.port"],
    type: "number",
    default: 9596,
    group: "api",
  } as Options,

  "api.rest.cors": {
    alias: ["api.cors.origin"],
    type: "string",
    default: "*",
    group: "api",
  } as Options,
};
