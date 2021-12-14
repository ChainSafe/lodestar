import {IHttpClient, generateGenericJsonClient} from "../client/utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "./routes";

export function getClient(httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
}
