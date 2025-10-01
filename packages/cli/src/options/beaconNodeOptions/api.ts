import {IBeaconNodeOptions, allNamespaces, defaultOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export const enabledAll = "*";
export const enabledAllBashFriendly = "all";

export type ApiArgs = {
  "api.maxGindicesInProof"?: number;
  "rest.namespace"?: string[];
  "rest.cors"?: string;
  rest: boolean;
  "rest.address"?: string;
  "rest.port": number;
  "rest.headerLimit"?: number;
  "rest.bodyLimit"?: number;
  "rest.stacktraces"?: boolean;
  "rest.swaggerUI"?: boolean;
};

export function parseArgs(args: ApiArgs): IBeaconNodeOptions["api"] {
  // Apply namespace coerce logic
  let namespaces = args["rest.namespace"];
  if (namespaces) {
    // Enable all - support both '*' (backward compat) and 'all' (bash-friendly)
    if (namespaces.includes(enabledAll) || namespaces.includes(enabledAllBashFriendly)) {
      namespaces = allNamespaces;
    } else {
      // Parse ["debug,lodestar"] to ["debug", "lodestar"]
      namespaces = namespaces.flatMap((val) => val.split(","));
    }
  }

  // Apply cors coerce logic
  let cors = args["rest.cors"];
  if (cors === enabledAllBashFriendly) {
    cors = enabledAll;
  }

  return {
    maxGindicesInProof: args["api.maxGindicesInProof"],
    rest: {
      api: namespaces as IBeaconNodeOptions["api"]["rest"]["api"],
      cors,
      enabled: args.rest,
      address: args["rest.address"],
      port: args["rest.port"],
      headerLimit: args["rest.headerLimit"],
      bodyLimit: args["rest.bodyLimit"],
      stacktraces: args["rest.stacktraces"],
      swaggerUI: args["rest.swaggerUI"],
    },
  };
}

export const options: CliCommandOptions<ApiArgs> = {
  rest: {
    type: "boolean",
    description: "Enable/disable HTTP API",
    default: defaultOptions.api.rest.enabled,
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
    choices: [...allNamespaces, enabledAll, enabledAllBashFriendly],
    description: `Pick namespaces to expose for HTTP API. Set to '${enabledAllBashFriendly}' (or '${enabledAll}') to enable all namespaces`,
    defaultDescription: JSON.stringify(defaultOptions.api.rest.api),
    group: "api",
  },

  "rest.cors": {
    type: "string",
    description: `Configures the Access-Control-Allow-Origin CORS header for HTTP API. Use '${enabledAllBashFriendly}' to allow all origins`,
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
    default: defaultOptions.api.rest.port,
    group: "api",
  },
  "rest.headerLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum length of request headers, in bytes, the server is allowed to accept",
  },
  "rest.bodyLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum payload, in bytes, the server is allowed to accept",
  },

  "rest.stacktraces": {
    hidden: true,
    type: "boolean",
    description: "Return stacktraces in HTTP error responses",
    group: "api",
  },

  "rest.swaggerUI": {
    type: "boolean",
    description: "Enable Swagger UI for API exploration at http://{address}:{port}/documentation",
    default: Boolean(defaultOptions.api.rest.swaggerUI),
    group: "api",
  },
};
