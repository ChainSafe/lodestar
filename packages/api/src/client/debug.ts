import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient, getFetchOptsSerializers, generateGenericJsonClient} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes, StateFormat} from "../routes/debug.js";

/**
 * REST HTTP client for debug routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // Some routes return JSON, use a client auto-generator
  const client = generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
  // For `getState()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,

    async getState(stateId: string, format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer(fetchOptsSerializers.getState(stateId, format));
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getState(stateId, format);
      }
    },
    async getStateV2(stateId: string, format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer(fetchOptsSerializers.getStateV2(stateId, format));
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getStateV2(stateId, format);
      }
    },
  };
}
