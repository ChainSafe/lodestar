import {Logger} from "@lodestar/logger";
import {UNVERIFIED_RESPONSE_CODE} from "../constants.js";
import {ELResponseWithError} from "../types.js";
import {ELRequestPayload, ELResponse, ELResponseWithResult} from "../types.js";

export function generateRPCResponseForPayload<P, R, E = unknown>(
  payload: ELRequestPayload<P>,
  res?: R,
  error?: {
    readonly code?: number;
    readonly data?: E;
    readonly message: string;
  }
): ELResponse<R, E> {
  if (res !== undefined && error === undefined) {
    return {
      jsonrpc: payload.jsonrpc,
      id: payload.id,
      result: res,
    };
  }

  if (error !== undefined) {
    return {
      jsonrpc: payload.jsonrpc,
      id: payload.id,
      error,
    };
  }

  throw new Error("Either result or error must be defined.");
}

export function generateVerifiedResponseForPayload<D, P>(
  payload: ELRequestPayload<P>,
  res: D
): ELResponseWithResult<D> {
  return {
    jsonrpc: payload.jsonrpc,
    id: payload.id,
    result: res,
  };
}

export function generateUnverifiedResponseForPayload<P, D = unknown>(
  payload: ELRequestPayload<P>,
  message: string,
  data?: D
): ELResponseWithError<D> {
  return data !== undefined || data !== null
    ? {
        jsonrpc: payload.jsonrpc,
        id: payload.id,
        error: {
          code: UNVERIFIED_RESPONSE_CODE,
          message,
        },
      }
    : {
        jsonrpc: payload.jsonrpc,
        id: payload.id,
        error: {
          code: UNVERIFIED_RESPONSE_CODE,
          message,
          data,
        },
      };
}

export function isValidResponse<R, E>(response: ELResponse<R, E> | undefined): response is ELResponseWithResult<R> {
  return response !== undefined && response.error === undefined;
}

export function logRequest(payload: ELRequestPayload, logger: Logger): void {
  logger.debug("PR -> EL", {
    id: payload.id,
    method: payload.method,
    params: JSON.stringify(payload.params),
  });
}

export function logResponse(response: ELResponse | null | undefined, logger: Logger): void {
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
