import {Logger} from "@lodestar/logger";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../constants.js";
import {
  JsonRpcErrorPayload,
  JsonRpcNotificationPayload,
  JsonRpcRequestPayload,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResponseWithErrorPayload,
  JsonRpcResponseWithResultPayload,
  JsonRpcResponseOrBatch,
  JsonRpcBatchResponse,
  JsonRpcRequestOrBatch,
  JsonRpcBatchRequest,
} from "../types.js";
import {isNullish} from "./validation.js";

export function getResponseForRequest<P, R, E = unknown>(
  payload: JsonRpcRequest<P>,
  res?: R,
  error?: JsonRpcErrorPayload<E>
): JsonRpcResponse<R, E> {
  // If it's a notification
  if (!isRequest(payload)) {
    throw new Error("Cannot generate response for notification");
  }

  if (!isNullish(res) && isNullish(error)) {
    return {
      jsonrpc: payload.jsonrpc,
      id: payload.id,
      result: res,
    };
  }

  if (!isNullish(error)) {
    return {
      jsonrpc: payload.jsonrpc,
      id: payload.id,
      error,
    };
  }

  throw new Error("Either result or error must be defined.");
}

export function getVerificationFailedMessage(method: string): string {
  return `verification for '${method}' request failed.`;
}

export function isVerificationFailedError<P>(payload: JsonRpcResponseWithErrorPayload<P>): boolean {
  return !isValidResponsePayload(payload) && payload.error.code === VERIFICATION_FAILED_RESPONSE_CODE;
}

export function getErrorResponseForRequestWithFailedVerification<P, D = unknown>(
  payload: JsonRpcRequest<P>,
  message: string,
  data?: D
): JsonRpcResponseWithErrorPayload<D> {
  return isNullish(data)
    ? (getResponseForRequest(payload, undefined, {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message,
      }) as JsonRpcResponseWithErrorPayload<D>)
    : (getResponseForRequest(payload, undefined, {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message,
        data,
      }) as JsonRpcResponseWithErrorPayload<D>);
}

function isValidResponsePayload<R, E>(
  response: JsonRpcResponse<R, E> | undefined
): response is JsonRpcResponseWithResultPayload<R> {
  return !isNullish(response) && isNullish(response.error);
}

export function isValidResponse<R, E>(
  response: JsonRpcResponseOrBatch<R, E> | undefined
): response is JsonRpcResponseWithResultPayload<R> | JsonRpcResponseWithResultPayload<R>[] {
  return Array.isArray(response) ? response.every(isValidResponsePayload) : isValidResponsePayload(response);
}

export function isValidBatchResponse<R, E>(
  payload: JsonRpcBatchRequest,
  response: JsonRpcBatchResponse<R, E>
): response is JsonRpcBatchResponse<R, E> | JsonRpcResponseWithResultPayload<R>[] {
  for (const [index, req] of payload.entries()) {
    if (isRequest(req)) {
      if (response[index].id !== req.id || !isValidResponse(response[index])) return false;
    }
  }
  return true;
}

export function mergeBatchReqResp(
  payload: JsonRpcBatchRequest,
  response: JsonRpcBatchResponse
): {request: JsonRpcRequest; response: JsonRpcResponse}[] {
  const result = [];
  for (const [index, req] of payload.entries()) {
    if (isRequest(req)) {
      // Some providers return raw json-rpc response, some return only result
      // we need to just merge the result back based on the provider
      result.push({request: req, response: response[index]});
    }
  }
  return result;
}

export function isNotification<P>(payload: JsonRpcRequest<P>): payload is JsonRpcNotificationPayload<P> {
  return !("id" in payload);
}

export function isRequest<P>(payload: JsonRpcRequest<P>): payload is JsonRpcRequestPayload<P> {
  return "id" in payload;
}

export function isBatchRequest<P>(payload: JsonRpcRequestOrBatch<P>): payload is JsonRpcBatchRequest<P> {
  return Array.isArray(payload);
}

export function isBatchResponse<R>(response: JsonRpcResponseOrBatch<R>): response is JsonRpcBatchResponse<R> {
  return Array.isArray(response);
}

function logRequestPayload(payload: JsonRpcRequest, logger: Logger): void {
  logger.debug("PR -> EL", {
    id: isRequest(payload) ? payload.id : "notification",
    method: payload.method,
    params: JSON.stringify(payload.params),
  });
}

export function logRequest(payload: JsonRpcRequestOrBatch | undefined | null, logger: Logger): void {
  if (payload === undefined || payload === null) {
    return;
  }

  for (const p of isBatchRequest(payload) ? payload : [payload]) {
    logRequestPayload(p, logger);
  }
}

function logResponsePayload(response: JsonRpcResponse | null | undefined, logger: Logger): void {
  if (response === undefined || response === null) {
    logger.debug("PR <- EL (empty response)");
    return;
  }

  if (isValidResponse(response)) {
    logger.debug("PR <- EL", {
      id: response.id,
      result: JSON.stringify(response.result),
    });
  } else {
    logger.debug("PR <- E:", {
      id: response.id,
      error: JSON.stringify(response.error),
    });
  }
}

export function logResponse(response: JsonRpcResponseOrBatch | undefined, logger: Logger): void {
  if (response === undefined || response === null) {
    return;
  }

  for (const p of isBatchResponse(response) ? response : [response]) {
    logResponsePayload(p, logger);
  }
}
