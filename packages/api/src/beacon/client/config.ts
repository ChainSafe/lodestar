import {ChainForkConfig} from "@lodestar/config";
import {generateGenericJsonClient, IHttpClient} from "../../utils/client/index.js";
import {ReturnTypes} from "../../utils/types.js";
import {Api, getReqSerializers, getReturnTypes, ReqTypes, routesData} from "../routes/config.js";

/**
 * REST HTTP client for config routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(
    routesData,
    reqSerializers,
    returnTypes as ReturnTypes<Api>,
    httpClient
  );
}
