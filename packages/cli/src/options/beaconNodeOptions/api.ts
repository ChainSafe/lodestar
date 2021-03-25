import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IApiArgs {
  "api.rest.api": string[];
  "api.rest.cors": string;
  "api.rest.enabled": boolean;
  "api.rest.host": string;
  "api.rest.port": number;
}

export function parseArgs(args: IApiArgs): IBeaconNodeOptions["api"] {
  return {
    rest: {
      api: args["api.rest.api"] as IBeaconNodeOptions["api"]["rest"]["api"],
      cors: args["api.rest.cors"],
      enabled: args["api.rest.enabled"],
      host: args["api.rest.host"],
      port: args["api.rest.port"],
    },
  };
}

export const options: ICliCommandOptions<IApiArgs> = {
  "api.rest.api": {
    type: "array",
    choices: ["beacon", "validator", "node", "events", "debug", "lodestar"],
    description: "Pick namespaces to expose for HTTP API",
    defaultDescription: JSON.stringify(defaultOptions.api.rest.api),
    group: "api",
  },

  "api.rest.cors": {
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for HTTP API",
    defaultDescription: defaultOptions.api.rest.cors,
    group: "api",
  },

  "api.rest.enabled": {
    type: "boolean",
    description: "Enable/disable HTTP API",
    defaultDescription: String(defaultOptions.api.rest.enabled),
    group: "api",
  },

  "api.rest.host": {
    type: "string",
    description: "Set host for HTTP API",
    defaultDescription: defaultOptions.api.rest.host,
    group: "api",
  },

  "api.rest.port": {
    type: "number",
    description: "Set port for HTTP API",
    defaultDescription: String(defaultOptions.api.rest.port),
    group: "api",
  },
};
