import {HttpStatusCode, HttpSuccessCodes} from "./utils/client/httpStatusCode.js";
import {Resolves} from "./utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */

export type APIClientHandler = (...args: any) => PromiseLike<ApiClientResponse>;
export type APIServerHandler = (...args: any) => PromiseLike<unknown>;

export type ApiClientResponse<
  S extends Partial<Record<HttpSuccessCodes, unknown>> = {[K in HttpSuccessCodes]: unknown},
  E extends Exclude<HttpStatusCode, HttpSuccessCodes> = Exclude<HttpStatusCode, HttpSuccessCodes>,
  IncludeErrorResponse extends boolean = true | false
> = IncludeErrorResponse extends false
  ? {[K in keyof S]: {ok: true; status: K; response: S[K]}}[keyof S]
  :
      | {[K in keyof S]: {ok: true; status: K; response: S[K]}}[keyof S]
      | {[K in E]: {ok: false; status: K; response: {code: K; message?: string}}}[E];

export type ApiClientResponseData<T extends ApiClientResponse> = T extends {ok: true; response: infer R} ? R : never;

export type ServerApi<T extends Record<string, APIClientHandler>> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<ApiClientResponseData<Resolves<T[K]>>>;
};

export type ClientApi<T extends Record<string, APIServerHandler>> = {
  [K in keyof T]: (
    ...args: Parameters<T[K]>
  ) => Promise<
    ApiClientResponse<{[HttpStatusCode.OK]: Resolves<T[K]>}, HttpStatusCode.INTERNAL_SERVER_ERROR, true | false>
  >;
};
