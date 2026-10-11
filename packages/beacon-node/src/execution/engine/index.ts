import {LodestarError, fromHex, toPrintableUrl} from "@lodestar/utils";
import {getLodestarClientVersion} from "../../util/metadata.js";
import {ExecutionEngineDisabled} from "./disabled.js";
import {
  EngineApiMode,
  ExecutionEngineHttp,
  ExecutionEngineHttpOpts,
  ExecutionEngineModules,
  defaultExecutionEngineHttpOpts,
  engineApiModes,
} from "./http.js";
import {IExecutionEngine} from "./interface.js";
import {JsonRpcHttpClient} from "./jsonRpcHttpClient.js";
import {JsonRpcEngineTransport} from "./jsonRpcTransport.js";
import {ExecutionEngineMockBackend, ExecutionEngineMockOpts} from "./mock.js";
import {EngineRestHttpClient} from "./restHttpClient.js";
import {RestEngineTransport, formatClientVersionHeader} from "./restTransport.js";
import {ExecutionEngineMockJsonRpcClient, JsonRpcBackend} from "./utils.js";

export {ExecutionEngineHttp, ExecutionEngineDisabled, defaultExecutionEngineHttpOpts, engineApiModes};
export type {EngineApiMode};

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
  return new ExecutionEngineHttp({jsonRpc: new JsonRpcEngineTransport(rpc)}, modules);
}

export function getExecutionEngineHttp(
  opts: ExecutionEngineHttpOpts,
  modules: ExecutionEngineModules
): IExecutionEngine {
  const jwtSecret = opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined;
  const metrics = modules.metrics?.executionEnginerHttpClient;
  const engineApi = opts.engineApi ?? "auto";
  if (engineApi === "ssz" && opts.urls.length !== 1) {
    throw new LodestarError({code: "ENGINE_REST_REQUIRES_SINGLE_URL", count: opts.urls.length});
  }
  if (engineApi === "auto" && opts.urls.length > 1) {
    modules.logger.debug("Using JSON-RPC for multiple execution URLs", {count: opts.urls.length});
  }

  const rpc = new JsonRpcHttpClient(opts.urls, {
    ...opts,
    signal: modules.signal,
    metrics,
    jwtSecret,
    jwtId: opts.jwtId,
    jwtVersion: opts.jwtVersion,
  });

  const rest =
    engineApi === "json-rpc" || opts.urls.length !== 1
      ? undefined
      : new RestEngineTransport(
          new EngineRestHttpClient(opts.urls, {
            signal: modules.signal,
            timeout: opts.timeout,
            retries: opts.retries,
            retryDelay: opts.retryDelay,
            jwtSecret,
            jwtId: opts.jwtId,
            clientVersion: formatClientVersionHeader(getLodestarClientVersion(opts)),
            metrics,
          })
        );

  modules.logger.info("Execution client", {urls: opts.urls.map(toPrintableUrl).toString(), engineApi});
  return new ExecutionEngineHttp({jsonRpc: new JsonRpcEngineTransport(rpc), rest}, modules, opts);
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
      return getExecutionEngineHttp(opts, modules);

    default:
      return getExecutionEngineHttp(opts, modules);
  }
}
