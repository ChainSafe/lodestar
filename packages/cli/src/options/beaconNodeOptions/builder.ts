import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

export type ExecutionBuilderArgs = {
  builder: boolean;
  "builder.urls": string[];
  "builder.timeout": number;
};

export function parseArgs(args: ExecutionBuilderArgs): IBeaconNodeOptions["executionBuilder"] {
  return {
    enabled: args["builder"],
    urls: args["builder.urls"],
    timeout: args["builder.timeout"],
  };
}

export const options: ICliCommandOptions<ExecutionBuilderArgs> = {
  builder: {
    description: "Enable builder interface",
    type: "boolean",
    defaultDescription: `${
      defaultOptions.executionBuilder.mode === "http" ? defaultOptions.executionBuilder.enabled : false
    }`,
    group: "builder",
  },

  "builder.urls": {
    description: "Urls hosting the builder API",
    type: "array",
    defaultDescription:
      defaultOptions.executionBuilder.mode === "http" ? defaultOptions.executionBuilder.urls.join(" ") : "",
    group: "builder",
  },

  "builder.timeout": {
    description: "Timeout in miliseconds for builder API HTTP client",
    type: "number",
    defaultDescription:
      defaultOptions.executionBuilder.mode === "http" ? String(defaultOptions.executionBuilder.timeout) : "",
    group: "builder",
  },
};
