import {HttpStatusCode, HttpSuccessCodes} from "./utils/client/httpStatusCode.js";
import {Resolves} from "./utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */

export type APIClientHandler = (...args: any) => PromiseLike<ApiClientResponse>;
export type APIServerHandler = (...args: any) => PromiseLike<unknown>;

export type ApiClientResponse<
  S extends Partial<Record<HttpSuccessCodes, unknown>> = {[K in HttpSuccessCodes]: unknown},
  E extends Exclude<HttpStatusCode, HttpSuccessCodes> = Exclude<HttpStatusCode, HttpSuccessCodes>
> =
  | {[K in keyof S]: {ok: true; status: K; response: S[K]; error?: never}}[keyof S]
  | {[K in E]: {ok: false; status: K; error: {code: K; message?: string}; response?: never}}[E]
  | {
      ok: false;
      status: HttpStatusCode.INTERNAL_SERVER_ERROR;
      error: {code: HttpStatusCode.INTERNAL_SERVER_ERROR; message?: string};
      response?: never;
    };

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
