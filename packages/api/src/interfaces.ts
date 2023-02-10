import {HttpStatusCode, HttpSuccessCodes} from "./utils/client/httpStatusCode.js";
import {Resolves} from "./utils/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type APIClientHandler = (...args: any) => PromiseLike<ApiClientResponse>;
export type APIServerHandler = (...args: any) => PromiseLike<unknown>;

export type ApiClientSuccessResponse<S extends keyof any, T> = {ok: true; status: S; response: T; error?: never};
export type ApiClientSErrorResponse<S extends Exclude<HttpStatusCode, HttpSuccessCodes>> = {
  ok: false;
  status: S;
  response?: never;
  error: {code: S; operationId: string; message?: string};
};
export type ApiClientResponse<
  S extends Partial<{[K in HttpSuccessCodes]: unknown}> = {[K in HttpSuccessCodes]: unknown},
  E extends Exclude<HttpStatusCode, HttpSuccessCodes> = Exclude<HttpStatusCode, HttpSuccessCodes>
> =
  | {[K in keyof S]: ApiClientSuccessResponse<K, S[K]>}[keyof S]
  | {[K in E]: ApiClientSErrorResponse<K>}[E]
  | ApiClientSErrorResponse<HttpStatusCode.INTERNAL_SERVER_ERROR>;

export type ApiClientResponseData<T extends ApiClientResponse> = T extends {ok: true; response: infer R} ? R : never;

export type GenericRequestObject = Record<string, unknown>;
export type GenericResponseObject = {code: (code: number) => void};

export type ServerApi<T extends Record<string, APIClientHandler>> = {
  [K in keyof T]: (
    ...args: [...args: Parameters<T[K]>, req?: GenericRequestObject, res?: GenericResponseObject]
  ) => Promise<ApiClientResponseData<Resolves<T[K]>>>;
};

export type ClientApi<T extends Record<string, APIServerHandler>> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<ApiClientResponse<{[HttpStatusCode.OK]: Resolves<T[K]>}>>;
};
