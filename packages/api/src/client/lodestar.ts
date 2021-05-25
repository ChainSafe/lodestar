import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {FetchFn, getGenericJsonClient} from "./utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/lodestar";

/**
 * REST HTTP client for lodestar routes
 */
export function getClient(_config: IBeaconConfig, fetchFn: FetchFn): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  return getGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, fetchFn);
}
