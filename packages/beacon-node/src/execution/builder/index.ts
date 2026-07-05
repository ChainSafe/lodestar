import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {Metrics} from "../../metrics/metrics.js";
import {ExecutionBuilderHttp, ExecutionBuilderHttpOpts, defaultExecutionBuilderHttpOpts} from "./http.js";
import {IExecutionBuilder} from "./interface.js";

export {ExecutionBuilderHttp, defaultExecutionBuilderHttpOpts};
export * from "./gloas.js";

export type ExecutionBuilderOpts = {mode?: "http"} & ExecutionBuilderHttpOpts;
export const defaultExecutionBuilderOpts: ExecutionBuilderOpts = defaultExecutionBuilderHttpOpts;

export function initializeExecutionBuilder(
  opts: ExecutionBuilderOpts,
  config: ChainForkConfig,
  metrics: Metrics | null = null,
  logger?: Logger
): IExecutionBuilder {
  switch (opts.mode) {
    case "http":
      return new ExecutionBuilderHttp(opts, config, metrics, logger);
    default:
      return new ExecutionBuilderHttp(opts, config, metrics, logger);
  }
}
