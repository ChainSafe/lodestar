import {UNVERIFIED_RESPONSE_CODE} from "../constants.js";
import {ELRequestPayload, ELResponse} from "../types.js";

export function generateRPCResponseForPayload<P, R, E = unknown>(
  payload: ELRequestPayload<P>,
  res?: R,
  error?: {
    readonly code?: number;
    readonly data?: E;
    readonly message: string;
  }
): ELResponse<R> {
  return error
    ? {
        jsonrpc: payload.jsonrpc,
        id: payload.id,
        error,
      }
    : {
        jsonrpc: payload.jsonrpc,
        id: payload.id,
        result: res,
      };
}

export function generateUnverifiedResponseForPayload<P, D = unknown>(
  payload: ELRequestPayload<P>,
  message: string,
  data?: D
): ELResponse<never, D> {
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

export function isValidResponse<R, E>(response: ELResponse<R, E>): response is ELResponse<R, never> {
  return response.error === undefined;
}
