// Re-exporting beacon only for backwards compatibility
export * from "./beacon/index.js";
export * from "./interfaces.js";
export {HttpStatusCode} from "./utils/client/httpStatusCode.js";
export type {HttpErrorCodes, HttpSuccessCodes} from "./utils/client/httpStatusCode.js";
export {HttpClient, HttpError, ApiError, FetchError, isFetchError, fetch} from "./utils/client/index.js";
export type {IHttpClient, HttpClientOptions, HttpClientModules, Metrics} from "./utils/client/index.js";
export * from "./utils/routes.js";

// NOTE: Don't export server here so it's not bundled to all consumers
