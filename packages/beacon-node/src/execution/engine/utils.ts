import {isFetchError} from "@lodestar/api";
import {isErrorAborted} from "@lodestar/utils";
import {IJson, RpcPayload} from "../../eth1/interface.js";
import {IJsonRpcHttpClient, ErrorJsonRpcResponse, HttpRpcError} from "../../eth1/provider/jsonRpcHttpClient.js";
import {isQueueErrorAborted} from "../../util/queue/errors.js";
import {ExecutionPayloadStatus, ExecutionState} from "./interface.js";

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

function getExecutionStateForPayloadStatus(payloadStatus: ExecutionPayloadStatus): ExecutionState {
  switch (payloadStatus) {
    case ExecutionPayloadStatus.ACCEPTED:
    case ExecutionPayloadStatus.VALID:
    case ExecutionPayloadStatus.UNSAFE_OPTIMISTIC_STATUS:
      return ExecutionState.SYNCED;

    case ExecutionPayloadStatus.ELERROR:
    case ExecutionPayloadStatus.INVALID:
    case ExecutionPayloadStatus.SYNCING:
    case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
      return ExecutionState.SYNCING;

    case ExecutionPayloadStatus.UNAVAILABLE:
      return ExecutionState.OFFLINE;

    default:
      // In case we can't determine the state, we assume it stays in old state
      // This assumption is better than considering offline, because the offline state may trigger some notifications
      return ExecutionState.ONLINE;
  }
}

function getExecutionStateForPayloadError(payloadError: unknown, oldState: ExecutionState): ExecutionState {
  if (isErrorAborted(payloadError) || isQueueErrorAborted(payloadError)) {
    return oldState;
  }

  // Originally this case was handled with {status: ExecutePayloadStatus.ELERROR}
  if (payloadError instanceof HttpRpcError || payloadError instanceof ErrorJsonRpcResponse) {
    return ExecutionState.SYNCING;
  }

  if (payloadError && isFetchError(payloadError) && HTTP_FATAL_ERROR_CODES.includes(payloadError.code)) {
    return ExecutionState.OFFLINE;
  }

  if (payloadError && isFetchError(payloadError) && HTTP_CONNECTION_ERROR_CODES.includes(payloadError.code)) {
    return ExecutionState.AUTH_FAILED;
  }

  return oldState;
}

export function getExecutionEngineState<S extends ExecutionPayloadStatus | undefined, E extends unknown | undefined>({
  payloadError,
  payloadStatus,
  oldState,
}:
  | {payloadStatus: S; payloadError?: never; oldState: ExecutionState}
  | {payloadStatus?: never; payloadError: E; oldState: ExecutionState}): ExecutionState {
  const newState =
    payloadStatus === undefined
      ? getExecutionStateForPayloadError(payloadError, oldState)
      : getExecutionStateForPayloadStatus(payloadStatus);

  if (newState === oldState) return oldState;

  // The ONLINE is initial state and can reached from offline or auth failed error
  if (
    newState === ExecutionState.ONLINE &&
    !(oldState === ExecutionState.OFFLINE || oldState === ExecutionState.AUTH_FAILED)
  ) {
    return oldState;
  }

  return newState;
}
