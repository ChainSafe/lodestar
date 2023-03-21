import {fromHex} from "@lodestar/utils";
import {JsonRpcHttpClient} from "../../eth1/provider/jsonRpcHttpClient.js";
import {IExecutionEngine} from "./interface.js";
import {ExecutionEngineDisabled} from "./disabled.js";
import {
  ExecutionEngineHttp,
  ExecutionEngineModules,
  ExecutionEngineHttpOpts,
  defaultExecutionEngineHttpOpts,
} from "./http.js";
import {ExecutionEngineMockOpts, ExecutionEngineMockBackend} from "./mock.js";
import {ExecutionEngineMockJsonRpcClient, JsonRpcBackend} from "./utils.js";

export {IExecutionEngine, ExecutionEngineHttp, ExecutionEngineDisabled, defaultExecutionEngineHttpOpts};

export type ExecutionEngineOpts =
  | ({mode?: "http"} & ExecutionEngineHttpOpts)
  | ({mode: "mock"} & ExecutionEngineMockOpts)
  | {mode: "disabled"};
export const defaultExecutionEngineOpts: ExecutionEngineOpts = defaultExecutionEngineHttpOpts;

export function getExecutionEngineFromBackend(
  backend: JsonRpcBackend,
  modules: ExecutionEngineModules
): IExecutionEngine {
  const rpc = new ExecutionEngineMockJsonRpcClient(backend);
  return new ExecutionEngineHttp(rpc, modules);
}

export function getExecutionEngineHttp(
  opts: ExecutionEngineHttpOpts,
  modules: ExecutionEngineModules
): IExecutionEngine {
  const rpc = new JsonRpcHttpClient(opts.urls, {
    ...opts,
    signal: modules.signal,
    metrics: modules.metrics?.executionEnginerHttpClient,
    jwtSecret: opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined,
  });
  return new ExecutionEngineHttp(rpc, modules);
}

export function initializeExecutionEngine(
  opts: ExecutionEngineOpts,
  modules: ExecutionEngineModules
): IExecutionEngine {
  switch (opts.mode) {
    case "disabled":
      return new ExecutionEngineDisabled();

    case "mock":
      return getExecutionEngineFromBackend(new ExecutionEngineMockBackend(opts), modules);

    case "http":
    default:
      return getExecutionEngineHttp(opts, modules);
  }
}
