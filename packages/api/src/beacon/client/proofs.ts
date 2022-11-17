import {IChainForkConfig} from "@lodestar/config";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes, routesData, getReqSerializers} from "../routes/proof.js";
import {IHttpClient, getFetchOptsSerializers} from "../../utils/client/index.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();

  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    async getStateProof(stateId, paths) {
      const buffer = await httpClient.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, paths));
      const proof = deserializeProof(new Uint8Array(buffer));
      return {data: proof};
    },
  };
}
