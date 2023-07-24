import {isFetchError} from "@lodestar/api";
import {isErrorAborted} from "@lodestar/utils";
import {IJson, RpcPayload} from "../../eth1/interface.js";
import {IJsonRpcHttpClient, ErrorJsonRpcResponse, HttpRpcError} from "../../eth1/provider/jsonRpcHttpClient.js";
import {isQueueErrorAborted} from "../../util/queue/errors.js";
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

function getExecutionEngineStateForPayloadStatus(payloadStatus: ExecutePayloadStatus): ExecutionEngineState {
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

    // In case we can't determine the state, we assume it's online
    // This assumption is better than considering offline, because the offline state may trigger some notifications
    default:
      return ExecutionEngineState.ONLINE;
  }
}

function getExecutionEngineStateForPayloadError(
  payloadError: unknown,
  oldState: ExecutionEngineState
): ExecutionEngineState | undefined {
  if (isErrorAborted(payloadError) || isQueueErrorAborted(payloadError)) {
    return oldState;
  }

  // Originally this case was handled with {status: ExecutePayloadStatus.ELERROR}
  if (payloadError instanceof HttpRpcError || payloadError instanceof ErrorJsonRpcResponse) {
    return ExecutionEngineState.SYNCING;
  }

  if (payloadError && isFetchError(payloadError) && fatalErrorCodes.includes(payloadError.code)) {
    return ExecutionEngineState.OFFLINE;
  }

  if (payloadError && isFetchError(payloadError) && connectionErrorCodes.includes(payloadError.code)) {
    return ExecutionEngineState.AUTH_FAILED;
  }

  return undefined;
}

export function getExecutionEngineState<
  S extends ExecutePayloadStatus | undefined,
  E extends unknown | undefined,
  R = S extends undefined ? ExecutionEngineState | undefined : ExecutionEngineState,
>({
  payloadError,
  payloadStatus,
  oldState,
}:
  | {payloadStatus: S; payloadError?: never; oldState: ExecutionEngineState}
  | {payloadStatus?: never; payloadError: E; oldState: ExecutionEngineState}): R {
  const newState =
    payloadStatus === undefined
      ? getExecutionEngineStateForPayloadError(payloadError, oldState)
      : getExecutionEngineStateForPayloadStatus(payloadStatus);

  // The `payloadError` is something based on which we can't determine the state of execution engine
  if (newState === undefined) return undefined as R;

  // The ONLINE is initial state and can reached from offline or auth failed error
  if (
    newState === ExecutionEngineState.ONLINE &&
    !(oldState === ExecutionEngineState.OFFLINE || oldState === ExecutionEngineState.AUTH_FAILED)
  ) {
    return oldState as R;
  }

  return newState as R;
}
