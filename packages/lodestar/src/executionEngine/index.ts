import {AbortSignal} from "@chainsafe/abort-controller";
import {IExecutionEngine} from "./interface";
import {ExecutionEngineDisabled} from "./disabled";
import {ExecutionEngineHttp, ExecutionEngineHttpOpts, defaultExecutionEngineHttpOpts} from "./http";
import {ExecutionEngineMock} from "./mock";

export {IExecutionEngine, ExecutionEngineHttp, ExecutionEngineDisabled, ExecutionEngineMock};

export type ExecutionEngineOpts = ExecutionEngineHttpOpts & {
  disabled?: boolean;
  mock?: boolean;
  urls: string[];
  timeout?: number;
};

export const defaultExecutionEngineOpts: ExecutionEngineOpts = defaultExecutionEngineHttpOpts;

export function initializeExecutionEngine(opts: ExecutionEngineOpts, signal: AbortSignal): IExecutionEngine {
  if (opts.disabled) {
    return new ExecutionEngineDisabled();
  } else if (opts.mock) {
    return new ExecutionEngineMock();
  } else {
    return new ExecutionEngineHttp(opts, signal);
  }
}
