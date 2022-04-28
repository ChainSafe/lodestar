import {AbortSignal} from "@chainsafe/abort-controller";
import {IExecutionEngine} from "./interface";
import {ExecutionEngineDisabled} from "./disabled";
import {
  ExecutionEngineHttp,
  ExecutionEngineHttpOpts,
  defaultExecutionEngineHttpOpts,
  defaultDefaultSuggestedFeeRecipient,
} from "./http";
import {ExecutionEngineMock, ExecutionEngineMockOpts} from "./mock";

export {
  IExecutionEngine,
  ExecutionEngineHttp,
  ExecutionEngineDisabled,
  ExecutionEngineMock,
  defaultDefaultSuggestedFeeRecipient,
};

export type ExecutionEngineOpts =
  | ({mode?: "http"} & ExecutionEngineHttpOpts)
  | ({mode: "mock"} & ExecutionEngineMockOpts)
  | {mode: "disabled"};

export const defaultExecutionEngineOpts: ExecutionEngineOpts = defaultExecutionEngineHttpOpts;

export function initializeExecutionEngine(opts: ExecutionEngineOpts, signal: AbortSignal): IExecutionEngine {
  switch (opts.mode) {
    case "mock":
      return new ExecutionEngineMock(opts);
    case "disabled":
      return new ExecutionEngineDisabled();
    case "http":
    default:
      return new ExecutionEngineHttp(opts, signal);
  }
}
