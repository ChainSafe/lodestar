import {defaultOptions, IBeaconNodeOptions, allNamespaces} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

const enabledAll = "*";

export interface IApiArgs {
  "api.maxGindicesInProof": number;
  "api.rest.api": string[];
  "api.rest.cors": string;
  "api.rest.enabled": boolean;
  "api.rest.host": string;
  "api.rest.port": number;
}

export function parseArgs(args: IApiArgs): IBeaconNodeOptions["api"] {
  return {
    maxGindicesInProof: args["api.maxGindicesInProof"],
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
  "api.maxGindicesInProof": {
    hidden: true,
    type: "number",
    description: "Limit max number of gindices in a single proof request. DoS vector protection",
    defaultDescription: String(defaultOptions.api.maxGindicesInProof),
    group: "api",
  },

  "api.rest.api": {
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
