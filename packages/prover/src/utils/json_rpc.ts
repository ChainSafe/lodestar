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
  return {
    jsonrpc: payload.jsonrpc,
    id: payload.id,
    result: res,
    error,
  };
}

export function generateUnverifiedResponseForPayload<P, D = unknown>(
  payload: ELRequestPayload<P>,
  message: string,
  data?: D
): ELResponse<never, D> {
  return {
    jsonrpc: payload.jsonrpc,
    id: payload.id,
    error: {
      code: UNVERIFIED_RESPONSE_CODE,
      message,
      data,
    },
  };
}
