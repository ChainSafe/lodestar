import {isFetchError} from "@lodestar/utils";
import {IJson, RpcPayload} from "../../eth1/interface.js";
import {IJsonRpcHttpClient} from "../../eth1/provider/jsonRpcHttpClient.js";
import {ExecutePayloadStatus, ExecutionEngineState} from "./interface.js";

export type JsonRpcBackend = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handlers: Record<string, (...args: any[]) => any>;
};

export class ExecutionEngineMockJsonRpcClient implements IJsonRpcHttpClient {
  constructor(private readonly backend: JsonRpcBackend) {}

  async fetch<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    const handler = this.backend.handlers[payload.method];
    if (handler === undefined) {
      throw Error(`Unknown method ${payload.method}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return handler(...(payload.params as any[])) as R;
  }

  fetchWithRetries<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    return this.fetch(payload);
  }

  fetchBatch<R>(rpcPayloadArr: RpcPayload<IJson[]>[]): Promise<R[]> {
    return Promise.all(rpcPayloadArr.map((payload) => this.fetch<R>(payload)));
  }
}

const fatalErrorCodes = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"];
const connectionErrorCodes = ["ECONNRESET", "ECONNABORTED"];

export function getExecutionEngineState({
  payloadError,
  payloadStatus,
}:
  | {payloadStatus: ExecutePayloadStatus; payloadError?: never}
  | {payloadStatus?: never; payloadError: unknown}): ExecutionEngineState {
  switch (payloadStatus) {
    case ExecutePayloadStatus.ACCEPTED:
    case ExecutePayloadStatus.VALID:
    case ExecutePayloadStatus.UNSAFE_OPTIMISTIC_STATUS:
      return ExecutionEngineState.SYNCED;

    case ExecutePayloadStatus.ELERROR:
    case ExecutePayloadStatus.INVALID:
    case ExecutePayloadStatus.SYNCING:
    case ExecutePayloadStatus.INVALID_BLOCK_HASH:
      return ExecutionEngineState.SYNCING;

    case ExecutePayloadStatus.UNAVAILABLE:
      return ExecutionEngineState.OFFLINE;
  }

  if (payloadError && isFetchError(payloadError) && fatalErrorCodes.includes(payloadError.cause.code)) {
    return ExecutionEngineState.OFFLINE;
  }

  if (payloadError && isFetchError(payloadError) && connectionErrorCodes.includes(payloadError.cause.code)) {
    return ExecutionEngineState.AUTH_FAILED;
  }

  // In case we can't determine the state, we assume it's online
  // This assumption is better than considering offline, because the offline state may trigger some notifications
  return ExecutionEngineState.ONLINE;
}
