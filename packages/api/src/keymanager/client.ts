import {IChainForkConfig} from "@lodestar/config";
import {defaultClientOptions} from "../beacon/client/index.js";
import {IHttpClient, generateGenericJsonClient, ClientOptions} from "../utils/client/index.js";
import {ReturnTypes} from "../utils/types.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "./routes.js";

export function getClient<ErrorAsResponse extends boolean = false>(
  _config: IChainForkConfig,
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
