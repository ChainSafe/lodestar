import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/beacon/index.js";
import {IHttpClient, generateGenericJsonClient, ClientOptions} from "../../utils/client/index.js";
import {ReturnTypes} from "../../utils/types.js";
import {defaultClientOptions} from "./index.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient<ErrorAsResponse extends boolean = false>(
  config: IChainForkConfig,
  httpClient: IHttpClient,
  options?: ClientOptions<ErrorAsResponse>
): Api<ErrorAsResponse> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api<ErrorAsResponse>, ReqTypes, ErrorAsResponse>(
    routesData,
    reqSerializers,
    returnTypes as ReturnTypes<Api<ErrorAsResponse>>,
    httpClient,
    options ?? (defaultClientOptions as ClientOptions<ErrorAsResponse>)
  );
}
