import {IBeaconNodeOptions, defaultExecutionBuilderHttpOpts} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {YargsError} from "../../util/index.js";

export type ExecutionBuilderArgs = {
  builder: boolean;
  "builder.url"?: string;
  "builder.timeout"?: number;
  "builder.bidDeadline"?: number;
  "builder.bidDelay"?: number;
  "builder.bidRequests"?: number;
  "builder.bidStream"?: boolean;
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

  const bidDeadline = args["builder.bidDeadline"];
  if (bidDeadline !== undefined && (!Number.isInteger(bidDeadline) || bidDeadline <= 0)) {
    throw new YargsError("builder.bidDeadline must be a positive integer");
  }

  const bidDelay = args["builder.bidDelay"];
  if (bidDelay !== undefined && (!Number.isInteger(bidDelay) || bidDelay < 0)) {
    throw new YargsError("builder.bidDelay must be a non-negative integer");
  }

  const bidRequests = args["builder.bidRequests"];
  if (bidRequests !== undefined && (!Number.isInteger(bidRequests) || bidRequests <= 0)) {
    throw new YargsError("builder.bidRequests must be a positive integer");
  }

  return {
    enabled: args.builder,
    url: args["builder.url"] ?? defaultExecutionBuilderHttpOpts.url,
    timeout: args["builder.timeout"],
    bidDeadline,
    bidDelay,
    bidRequests,
    bidStream: args["builder.bidStream"] ?? defaultExecutionBuilderHttpOpts.bidStream,
    faultInspectionWindow: args["builder.faultInspectionWindow"],
    allowedFaults: args["builder.allowedFaults"],
  };
}

export const options: CliCommandOptions<ExecutionBuilderArgs> = {
  builder: {
    description:
      "Enable external builder. Pre-Gloas only, deprecated post-Gloas where builders are configured on the validator client",
    type: "boolean",
    default: defaultExecutionBuilderHttpOpts.enabled,
    group: "builder",
  },

  "builder.url": {
    alias: ["builder.urls"],
    description:
      "Url hosting the builder API. Pre-Gloas only, deprecated post-Gloas where builders are configured on the validator client",
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

  "builder.bidDeadline": {
    description:
      "Time in milliseconds builders are given to provide a bid once block production starts. Advertised to builder API endpoints via the `X-Timeout-Ms` header and applied to bids received via p2p. Post-Gloas only",
    type: "number",
    defaultDescription: String(defaultExecutionBuilderHttpOpts.bidDeadline),
    group: "builder",
  },

  "builder.bidDelay": {
    description:
      "Delay in milliseconds from the start of the slot before the first bid request is sent to builder API endpoints, bids received via p2p are selected after the same delay. Post-Gloas only",
    type: "number",
    defaultDescription: String(defaultExecutionBuilderHttpOpts.bidDelay),
    group: "builder",
  },

  "builder.bidRequests": {
    description:
      "Number of consecutive bid requests sent to builder API endpoints per proposal, each granting `builder.bidDeadline`, the highest bid is selected. Post-Gloas only",
    type: "number",
    defaultDescription: String(defaultExecutionBuilderHttpOpts.bidRequests),
    group: "builder",
  },

  "builder.bidStream": {
    description:
      "Request Gloas builder bids over WebSocket for each bid round, falling back to HTTP within the remaining deadline if the connection cannot be established",
    type: "boolean",
    default: defaultExecutionBuilderHttpOpts.bidStream,
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
      "Number of missed slots allowed within `faultInspectionWindow` before ignoring the external builder (pre-gloas). Post-gloas, sets the tolerated rate of canonical EMPTY blocks, defined as `allowedFaults` out of `faultInspectionWindow` and applied to canonical blocks in the window",
    group: "builder",
  },
};
