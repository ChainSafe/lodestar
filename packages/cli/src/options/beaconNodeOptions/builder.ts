import {IBeaconNodeOptions, defaultExecutionBuilderHttpOpts} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {YargsError} from "../../util/index.js";

export type ExecutionBuilderArgs = {
  builder: boolean;
  "builder.url"?: string;
  "builder.timeout"?: number;
  "builder.faultInspectionWindow"?: number;
  "builder.allowedFaults"?: number;
};

/** Circuit breaker thresholds, also consumed by the chain options for the post-gloas breaker */
export type CircuitBreakerArgs = Pick<ExecutionBuilderArgs, "builder.faultInspectionWindow" | "builder.allowedFaults">;

export function parseArgs(args: ExecutionBuilderArgs): IBeaconNodeOptions["executionBuilder"] {
  if (Array.isArray(args["builder.url"]) || args["builder.url"]?.includes(",http")) {
    throw new YargsError(
      "Lodestar only supports a single builder URL. External tooling like mev-boost can be used to connect to multiple builder/relays"
    );
  }

  return {
    enabled: args.builder,
    url: args["builder.url"] ?? defaultExecutionBuilderHttpOpts.url,
    timeout: args["builder.timeout"],
    faultInspectionWindow: args["builder.faultInspectionWindow"],
    allowedFaults: args["builder.allowedFaults"],
  };
}

export const options: CliCommandOptions<ExecutionBuilderArgs> = {
  builder: {
    description: "Enable external builder",
    type: "boolean",
    default: defaultExecutionBuilderHttpOpts.enabled,
    group: "builder",
  },

  "builder.url": {
    alias: ["builder.urls"],
    description: "Url hosting the builder API",
    defaultDescription: defaultExecutionBuilderHttpOpts.url,
    type: "string",
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
    description:
      "Window used to inspect missed slots (pre-gloas) or calculate the canonical EMPTY block rate (post-gloas) for enabling/disabling the builder circuit breaker",
    group: "builder",
  },

  "builder.allowedFaults": {
    type: "number",
    description:
      "Number of missed slots allowed within `faultInspectionWindow` before ignoring the external builder (pre-gloas). Post-gloas, sets the tolerated rate of canonical blocks resolved EMPTY, defined as `allowedFaults` out of `faultInspectionWindow` and applied to resolved blocks in the window",
    group: "builder",
  },
};
