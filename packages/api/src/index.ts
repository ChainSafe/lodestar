// Re-exporting beacon only for backwards compatibility
export * from "./beacon/index.js";
export {HttpStatusCode} from "./utils/httpStatusCode.js";
export {WireFormat} from "./utils/wireFormat.js";
export type {HttpErrorCodes, HttpSuccessCodes} from "./utils/httpStatusCode.js";
export {ApiResponse, HttpClient, FetchError, isFetchError, fetch, defaultInit} from "./utils/client/index.js";
export type {ApiRequestInit} from "./utils/client/request.js";
export type {Endpoint} from "./utils/types.js";
export type {
  ApiClientMethods,
  IHttpClient,
  HttpClientOptions,
  HttpClientModules,
  Metrics,
} from "./utils/client/index.js";
export {ApiError} from "./utils/client/error.js";

// NOTE: Don't export server here so it's not bundled to all consumers
