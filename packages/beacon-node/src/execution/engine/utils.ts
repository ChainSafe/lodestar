import {isFetchError} from "@lodestar/api";
import {isErrorAborted} from "@lodestar/utils";
import {IJson, RpcPayload} from "../../eth1/interface.js";
import {IJsonRpcHttpClient, ErrorJsonRpcResponse, HttpRpcError} from "../../eth1/provider/jsonRpcHttpClient.js";
import {isQueueErrorAborted} from "../../util/queue/errors.js";
import {ExecutionPayloadStatus, ExecutionEngineState} from "./interface.js";

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

export const HTTP_FATAL_ERROR_CODES = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"];
export const HTTP_CONNECTION_ERROR_CODES = ["ECONNRESET", "ECONNABORTED"];

function getExecutionEngineStateForPayloadStatus(payloadStatus: ExecutionPayloadStatus): ExecutionEngineState {
  switch (payloadStatus) {
    case ExecutionPayloadStatus.ACCEPTED:
    case ExecutionPayloadStatus.VALID:
    case ExecutionPayloadStatus.UNSAFE_OPTIMISTIC_STATUS:
      return ExecutionEngineState.SYNCED;

    case ExecutionPayloadStatus.ELERROR:
    case ExecutionPayloadStatus.INVALID:
    case ExecutionPayloadStatus.SYNCING:
    case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
      return ExecutionEngineState.SYNCING;

    case ExecutionPayloadStatus.UNAVAILABLE:
      return ExecutionEngineState.OFFLINE;

    default:
      // In case we can't determine the state, we assume it stays in old state
      // This assumption is better than considering offline, because the offline state may trigger some notifications
      return ExecutionEngineState.ONLINE;
  }
}

function getExecutionEngineStateForPayloadError(
  payloadError: unknown,
  oldState: ExecutionEngineState
): ExecutionEngineState {
  if (isErrorAborted(payloadError) || isQueueErrorAborted(payloadError)) {
    return oldState;
  }

  // Originally this case was handled with {status: ExecutePayloadStatus.ELERROR}
  if (payloadError instanceof HttpRpcError || payloadError instanceof ErrorJsonRpcResponse) {
    return ExecutionEngineState.SYNCING;
  }

  if (payloadError && isFetchError(payloadError) && HTTP_FATAL_ERROR_CODES.includes(payloadError.code)) {
    return ExecutionEngineState.OFFLINE;
  }

  if (payloadError && isFetchError(payloadError) && HTTP_CONNECTION_ERROR_CODES.includes(payloadError.code)) {
    return ExecutionEngineState.AUTH_FAILED;
  }

  return oldState;
}

export function getExecutionEngineState<S extends ExecutionPayloadStatus | undefined, E extends unknown | undefined>({
  payloadError,
  payloadStatus,
  oldState,
}:
  | {payloadStatus: S; payloadError?: never; oldState: ExecutionEngineState}
  | {payloadStatus?: never; payloadError: E; oldState: ExecutionEngineState}): ExecutionEngineState {
  const newState =
    payloadStatus === undefined
      ? getExecutionEngineStateForPayloadError(payloadError, oldState)
      : getExecutionEngineStateForPayloadStatus(payloadStatus);

  return newState;
}
