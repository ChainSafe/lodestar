import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/lightclient.js";
import {IHttpClient, generateGenericJsonClient} from "../../utils/client/index.js";
import {ReturnTypes} from "../../utils/types.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): Api {
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
