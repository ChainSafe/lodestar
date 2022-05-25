import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, generateGenericJsonClient} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/node.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
