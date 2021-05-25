import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {FetchFn, getFetchOptsSerializers, getGenericJsonClient} from "./utils";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/lightclient";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(config: IBeaconConfig, fetchFn: FetchFn): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes(config);

  // Some routes return JSON, use a client auto-generator
  const client = getGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, fetchFn);
  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,

    async getStateProof(stateId, paths) {
      const buffer = await fetchFn.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, paths));
      const proof = deserializeProof(new Uint8Array(buffer));
      return {data: proof};
    },
  };
}
