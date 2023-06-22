import {defaultExecutionBuilderHttpOpts, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type ExecutionBuilderArgs = {
  builder: boolean;
  "builder.urls"?: string[];
  "builder.timeout"?: number;
  "builder.faultInspectionWindow"?: number;
  "builder.allowedFaults"?: number;
};

export function parseArgs(args: ExecutionBuilderArgs): IBeaconNodeOptions["executionBuilder"] {
  return {
    enabled: args["builder"],
    urls: args["builder.urls"] ?? defaultExecutionBuilderHttpOpts.urls,
    timeout: args["builder.timeout"],
    faultInspectionWindow: args["builder.faultInspectionWindow"],
    allowedFaults: args["builder.allowedFaults"],
  };
}

export const options: CliCommandOptions<ExecutionBuilderArgs> = {
  builder: {
    description: "Enable builder interface",
    type: "boolean",
    default: defaultExecutionBuilderHttpOpts.enabled,
    group: "builder",
  },

  "builder.urls": {
    description: "Urls hosting the builder API",
    defaultDescription: defaultExecutionBuilderHttpOpts.urls.join(","),
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.map((item) => item.split(",")).flat(1),
    group: "builder",
  },

  "builder.timeout": {
    description: "Timeout in milliseconds for builder API HTTP client",
    type: "number",
    defaultDescription: String(defaultExecutionBuilderHttpOpts.timeout),
    group: "builder",
  },

  "builder.faultInspectionWindow": {
    type: "number",
    description: "Window to inspect missed slots for enabling/disabling builder circuit breaker",
    group: "builder",
  },

  "builder.allowedFaults": {
    type: "number",
    description: "Number of missed slots allowed in the `faultInspectionWindow` for builder circuit",
    group: "builder",
  },
};
