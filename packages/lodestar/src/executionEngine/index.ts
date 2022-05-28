import {IExecutionEngine} from "./interface.js";
import {ExecutionEngineDisabled} from "./disabled.js";
import {ExecutionEngineHttp, ExecutionEngineHttpOpts, defaultExecutionEngineHttpOpts} from "./http.js";
import {ExecutionEngineMock, ExecutionEngineMockOpts} from "./mock.js";

export {IExecutionEngine, ExecutionEngineHttp, ExecutionEngineDisabled, ExecutionEngineMock};

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
