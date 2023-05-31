import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type ExecutionBuilderArgs = {
  builder: boolean;
  "builder.urls": string[];
  "builder.timeout": number;
  "builder.faultInspectionWindow": number;
  "builder.allowedFaults": number;
};

export function parseArgs(args: ExecutionBuilderArgs): IBeaconNodeOptions["executionBuilder"] {
  return {
    enabled: args["builder"],
    urls: args["builder.urls"],
    timeout: args["builder.timeout"],
    faultInspectionWindow: args["builder.faultInspectionWindow"],
    allowedFaults: args["builder.allowedFaults"],
  };
}

export const options: CliCommandOptions<ExecutionBuilderArgs> = {
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
    description: "Timeout in milliseconds for builder API HTTP client",
    type: "number",
    defaultDescription:
      defaultOptions.executionBuilder.mode === "http" ? String(defaultOptions.executionBuilder.timeout) : "",
    group: "builder",
  },

  "builder.faultInspectionWindow": {
    type: "number",
    description: "Window to inspect missed slots for enabling/disabling builder circuit breaker",
    group: "builder",
  },

  "builder.allowedFaults": {
    type: "number",
    description: "Number of missed slots allowed in the faultInspectionWindow for builder circuit",
    group: "builder",
  },
};
