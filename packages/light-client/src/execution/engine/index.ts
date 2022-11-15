import {IExecutionEngine} from "./interface.js";
import {
  ExecutionEngineHttp,
  defaultExecutionEngineHttpOpts,
  ExecutionEngineHttpOpts,
  ExecutionEngineModules,
} from "./http.js";

export {IExecutionEngine, ExecutionEngineHttp, defaultExecutionEngineHttpOpts};

export type ExecutionEngineOpts = ({mode?: "http"} & ExecutionEngineHttpOpts) | {mode: "disabled"};
export const defaultExecutionEngineOpts: ExecutionEngineOpts = defaultExecutionEngineHttpOpts;

export function initializeExecutionEngine(
  opts: ExecutionEngineOpts,
  modules: ExecutionEngineModules
): IExecutionEngine | undefined {
  switch (opts.mode) {
    case "disabled":
      return;
    case "http":
    default: {
      if (opts.urls === undefined) {
        return;
      } else {
        return new ExecutionEngineHttp(opts, modules);
      }
    }
  }
}
