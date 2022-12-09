import {ExecutionEngineHttp, ExecutionEngineHttpOpts, ExecutionEngineModules} from "./http.js";
import {ExecutionEngineMock, ExecutionEngineMockOpts} from "./mock.js";
import {IExecutionEngine} from "./interface.js";
import {ExecutionEngineDisabled} from "./disabled.js";

export type ExecutionEngineOpts =
  | ({mode?: "http"} & ExecutionEngineHttpOpts)
  | ({mode: "mock"} & ExecutionEngineMockOpts)
  | {mode: "disabled"};

export function initializeExecutionEngine(
  opts: ExecutionEngineOpts,
  modules: ExecutionEngineModules
): IExecutionEngine {
  switch (opts.mode) {
    case "mock":
      return new ExecutionEngineMock(opts);
    case "disabled":
      return new ExecutionEngineDisabled();
    case "http":
    default:
      return new ExecutionEngineHttp(opts, modules);
  }
}
