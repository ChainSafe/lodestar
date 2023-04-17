import {ChainForkConfig} from "@lodestar/config";
import {IHttpClient, generateGenericJsonClient} from "../utils/client/index.js";
import {ReturnTypes} from "../utils/types.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "./routes.js";

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
