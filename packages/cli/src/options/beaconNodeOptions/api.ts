import {defaultOptions, IBeaconNodeOptions, allNamespaces} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

const enabledAll = "*";

export interface IApiArgs {
  "api.maxGindicesInProof": number;
  "rest.namespace": string[];
  "rest.cors": string;
  rest: boolean;
  "rest.address": string;
  "rest.port": number;
  "rest.bodyLimit": number;
}

export function parseArgs(args: IApiArgs): IBeaconNodeOptions["api"] {
  return {
    maxGindicesInProof: args["api.maxGindicesInProof"],
    rest: {
      api: args["rest.namespace"] as IBeaconNodeOptions["api"]["rest"]["api"],
      cors: args["rest.cors"],
      enabled: args["rest"],
      address: args["rest.address"],
      port: args["rest.port"],
      bodyLimit: args["rest.bodyLimit"],
    },
  };
}

export const options: ICliCommandOptions<IApiArgs> = {
  rest: {
    type: "boolean",
    description: "Enable/disable HTTP API",
    defaultDescription: String(defaultOptions.api.rest.enabled),
    group: "api",
  },

  "api.maxGindicesInProof": {
    hidden: true,
    type: "number",
    description: "Limit max number of gindices in a single proof request. DoS vector protection",
    defaultDescription: String(defaultOptions.api.maxGindicesInProof),
    group: "api",
  },

  "rest.namespace": {
    type: "array",
    choices: [...allNamespaces, enabledAll],
    description: `Pick namespaces to expose for HTTP API. Set to '${enabledAll}' to enable all namespaces`,
    defaultDescription: JSON.stringify(defaultOptions.api.rest.api),
    group: "api",
    coerce: (namespaces: string[]): string[] => {
      // Enable all
      if (namespaces.includes(enabledAll)) return allNamespaces;
      // Parse ["debug,lodestar"] to ["debug", "lodestar"]
      return namespaces.map((val) => val.split(",")).flat(1);
    },
  },

  "rest.cors": {
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for HTTP API",
    defaultDescription: defaultOptions.api.rest.cors,
    group: "api",
  },

  "rest.address": {
    type: "string",
    description: "Set host for HTTP API",
    defaultDescription: defaultOptions.api.rest.address,
    group: "api",
  },

  "rest.port": {
    type: "number",
    description: "Set port for HTTP API",
    defaultDescription: String(defaultOptions.api.rest.port),
    group: "api",
  },
  "rest.bodyLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum payload, in bytes, the server is allowed to accept",
  },
};
