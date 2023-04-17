import {ChainForkConfig} from "@lodestar/config";
import {IHttpClient, generateGenericJsonClient} from "../utils/client/index.js";
import {ReturnTypes} from "../utils/types.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "./routes.js";

/**
 * REST HTTP client for builder routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(
    routesData,
    reqSerializers,
    returnTypes as ReturnTypes<Api>,
    httpClient
  );
}
