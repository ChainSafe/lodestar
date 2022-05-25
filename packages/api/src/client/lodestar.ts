import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, generateGenericJsonClient} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/lodestar.js";

/**
 * REST HTTP client for lodestar routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
