import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {FetchFn, getGenericJsonClient} from "./utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/config";

/**
 * REST HTTP client for config routes
 */
export function getClient(config: IBeaconConfig, fetchFn: FetchFn): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes(config);
  // All routes return JSON, use a client auto-generator
  return getGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, fetchFn);
}
