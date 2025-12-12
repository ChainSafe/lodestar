import {bigIntToBytes, bytesToBigInt, fromHex, fromHexInto, isErrorAborted, isFetchError, toHex} from "@lodestar/utils";
import {isQueueErrorAborted} from "../../util/queue/errors.js";
import {ExecutionEngineState, ExecutionPayloadStatus} from "./interface.js";
import {
  ErrorJsonRpcResponse,
  HttpRpcError,
  IJsonRpcHttpClient,
  JsonRpcHttpClientEvent,
  JsonRpcHttpClientEventEmitter,
} from "./jsonRpcHttpClient.js";

/** QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type QUANTITY = string;
/** DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type DATA = string;

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

export type IJson = string | number | boolean | undefined | IJson[] | {[key: string]: IJson};

export interface RpcPayload<P = IJson[]> {
  method: string;
  params: P;
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding QUANTITIES (integers, numbers): encode as hex, prefix with “0x”, the most compact representation (slight exception: zero should be represented as “0x0”). Examples:
 * - 0x41 (65 in decimal)
 * - 0x400 (1024 in decimal)
 * - WRONG: 0x (should always have at least one digit - zero is “0x0”)
 * - WRONG: 0x0400 (no leading zeroes allowed)
 * - WRONG: ff (must be prefixed 0x)
 */
export function numToQuantity(num: number | bigint): QUANTITY {
  return "0x" + num.toString(16);
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function quantityToNum(hex: QUANTITY, id = ""): number {
  const num = parseInt(hex, 16);
  if (Number.isNaN(num) || num < 0) throw Error(`Invalid hex decimal ${id} '${hex}'`);
  return num;
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Typesafe fn to convert hex string to bigint. The BigInt constructor param is any
 */
export function quantityToBigint(hex: QUANTITY, id = ""): bigint {
  try {
    return BigInt(hex);
  } catch (e) {
    throw Error(`Invalid hex bigint ${id} '${hex}': ${(e as Error).message}`);
  }
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 */
export function quantityToBytes(hex: QUANTITY): Uint8Array {
  const bn = quantityToBigint(hex);
  return bigIntToBytes(bn, 32, "le");
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Compress a 32 ByteVector into a QUANTITY
 */
export function bytesToQuantity(bytes: Uint8Array): QUANTITY {
  const bn = bytesToBigInt(bytes, "le");
  return numToQuantity(bn);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding UNFORMATTED DATA (byte arrays, account addresses, hashes, bytecode arrays): encode as hex, prefix with
 * “0x”, two hex digits per byte. Examples:
 *
 * - 0x41 (size 1, “A”)
 * - 0x004200 (size 3, “\0B\0”)
 * - 0x (size 0, “”)
 * - WRONG: 0xf0f0f (must be even number of digits)
 * - WRONG: 004200 (must be prefixed 0x)
 */
export function bytesToData(bytes: Uint8Array): DATA {
  return toHex(bytes);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function dataToBytes(hex: DATA, fixedLength: number | null): Uint8Array {
  try {
    const bytes = fromHex(hex);
    if (fixedLength != null && bytes.length !== fixedLength) {
      throw Error(`Wrong data length ${bytes.length} expected ${fixedLength}`);
    }
    return bytes;
  } catch (e) {
    (e as Error).message = `Invalid hex string: ${(e as Error).message}`;
    throw e;
  }
}

/**
 * Convert DATA into a preallocated buffer
 * fromHexInto will throw if buffer's length is not the same as the decoded hex length
 */
export function dataIntoBytes(hex: DATA, buffer: Uint8Array): Uint8Array {
  fromHexInto(hex, buffer);
  return buffer;
}

export type JsonRpcBackend = {
  // biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
  readonly handlers: Record<string, (...args: any[]) => any>;
};

export class ExecutionEngineMockJsonRpcClient implements IJsonRpcHttpClient {
  readonly emitter = new JsonRpcHttpClientEventEmitter();

  constructor(private readonly backend: JsonRpcBackend) {}

  async fetch<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    return this.wrapWithEvents(async () => {
      const handler = this.backend.handlers[payload.method];
      if (handler === undefined) {
        throw Error(`Unknown method ${payload.method}`);
      }
      // biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
      return handler(...(payload.params as any[])) as R;
    }, payload);
  }

  fetchWithRetries<R, P = IJson[]>(payload: RpcPayload<P>): Promise<R> {
    return this.fetch(payload);
  }

  fetchBatch<R>(rpcPayloadArr: RpcPayload<IJson[]>[]): Promise<R[]> {
    return Promise.all(rpcPayloadArr.map((payload) => this.fetch<R>(payload)));
  }

  private async wrapWithEvents<T>(func: () => Promise<T>, payload?: unknown): Promise<T> {
    try {
      const response = await func();
      this.emitter.emit(JsonRpcHttpClientEvent.RESPONSE, {payload, response});
      return response;
    } catch (error) {
      this.emitter.emit(JsonRpcHttpClientEvent.ERROR, {payload, error: error as Error});
      throw error;
    }
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
  targetState,
  oldState,
}:
  | {payloadStatus: S; payloadError?: never; targetState?: never; oldState: ExecutionEngineState}
  | {payloadStatus?: never; payloadError: E; targetState?: never; oldState: ExecutionEngineState}
  | {
      payloadStatus?: never;
      payloadError?: never;
      targetState: ExecutionEngineState;
      oldState: ExecutionEngineState;
    }): ExecutionEngineState {
  const newState =
    targetState !== undefined
      ? targetState
      : payloadStatus === undefined
        ? getExecutionEngineStateForPayloadError(payloadError, oldState)
        : getExecutionEngineStateForPayloadStatus(payloadStatus);

  if (newState === oldState) return oldState;

  // The ONLINE is initial state and can reached from offline or auth failed error
  if (
    newState === ExecutionEngineState.ONLINE &&
    !(oldState === ExecutionEngineState.OFFLINE || oldState === ExecutionEngineState.AUTH_FAILED)
  ) {
    return oldState;
  }

  return newState;
}
