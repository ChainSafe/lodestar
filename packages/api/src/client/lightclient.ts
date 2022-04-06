import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {IHttpClient, getFetchOptsSerializers, generateGenericJsonClient} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes} from "../routes/lightclient.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();

  // Some routes return JSON, use a client auto-generator
  const client = generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,

    async getStateProof(stateId, paths) {
      const buffer = await httpClient.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, paths));
      const proof = deserializeProof(new Uint8Array(buffer));
      return {data: proof};
    },
  };
}
