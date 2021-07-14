import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, generateGenericJsonClient} from "./utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/validator";

/**
 * REST HTTP client for validator routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
