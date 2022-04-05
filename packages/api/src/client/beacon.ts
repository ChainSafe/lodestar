import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/beacon";
import {IHttpClient, generateGenericJsonClient} from "./utils";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
