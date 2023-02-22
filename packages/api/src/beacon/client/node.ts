import {ChainForkConfig} from "@lodestar/config";
import {generateGenericJsonClient, IHttpClient} from "../../utils/client/index.js";
import {Api, getReqSerializers, getReturnTypes, ReqTypes, routesData} from "../routes/node.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
