import {IChainForkConfig} from "@lodestar/config";
import {ClientOptions, generateGenericJsonClient, IHttpClient} from "../../utils/client/index.js";
import {ReturnTypes} from "../../utils/types.js";
import {Api, getReqSerializers, getReturnTypes, ReqTypes, routesData} from "../routes/config.js";
import {defaultClientOptions} from "./index.js";

/**
 * REST HTTP client for config routes
 */
export function getClient<ErrorAsResponse extends boolean = false>(
  config: IChainForkConfig,
  httpClient: IHttpClient,
  options?: ClientOptions<ErrorAsResponse>
): Api<ErrorAsResponse> {
  const reqSerializers = getReqSerializers();
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
