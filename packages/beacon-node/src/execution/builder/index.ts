import {IChainForkConfig} from "@lodestar/config";
import {IExecutionBuilder} from "./interface.js";

import {ExecutionBuilderHttp, ExecutionBuilderHttpOpts, defaultExecutionBuilderHttpOpts} from "./http.js";

export {IExecutionBuilder, ExecutionBuilderHttp, defaultExecutionBuilderHttpOpts};

export type ExecutionBuilderOpts = {mode?: "http"} & ExecutionBuilderHttpOpts;
export const defaultExecutionBuilderOpts: ExecutionBuilderOpts = defaultExecutionBuilderHttpOpts;

export function initializeExecutionBuilder(opts: ExecutionBuilderOpts, config: IChainForkConfig): IExecutionBuilder {
  switch (opts.mode) {
    case "http":
    default:
      return new ExecutionBuilderHttp(opts, config);
  }
}
