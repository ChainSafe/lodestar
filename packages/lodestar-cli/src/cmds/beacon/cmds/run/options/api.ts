import {Options} from "yargs";

export const apiEnabled: Options = {
  alias: [
    "api.enabled",
    "api.rest.enabled",
  ],
  type: "boolean",
  default: false,
  group: "api",
};

export const apiNamespaces: Options = {
  alias: [
    "api.namespaces",
    "api.rest.api",
  ],
  type: "array",
  choices: ["beacon", "validator"],
  default: ["beacon", "validator"],
  group: "api",
};

export const apiHost: Options = {
  alias: [
    "api.host",
    "api.rest.host",
  ],
  type: "string",
  default: "127.0.0.1",
  group: "api",
};

export const apiPort: Options = {
  alias: [
    "api.port",
    "api.rest.port",
  ],
  type: "number",
  default: 9596,
  group: "api",
};

export const apiCorsOrigin: Options = {
  alias: [
    "api.cors.origin",
    "api.rest.cors",
  ],
  type: "string",
  default: "*",
  group: "api",
};
