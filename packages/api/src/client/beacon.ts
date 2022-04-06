import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, generateGenericJsonClient} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/beacon/index.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
