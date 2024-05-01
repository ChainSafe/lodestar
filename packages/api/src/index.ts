// Re-exporting beacon only for backwards compatibility
export * from "./beacon/index.js";
export {HttpStatusCode} from "./utils/httpStatusCode.js";
export {WireFormat} from "./utils/headers.js";
export type {HttpErrorCodes, HttpSuccessCodes} from "./utils/httpStatusCode.js";
export {ApiResponse, HttpClient, FetchError, isFetchError, fetch} from "./utils/client/index.js";
export type {Endpoint} from "./utils/types.js";
export type {
  ApiClientMethods,
  IHttpClient,
  HttpClientOptions,
  HttpClientModules,
  Metrics,
} from "./utils/client/index.js";
export {ApiError} from "./utils/error.js";
// export * from "./utils/routes.js"; TODO: do we need those?

// NOTE: Don't export server here so it's not bundled to all consumers

// TODO: should not be exported here
export * from "./utils/server.js";
