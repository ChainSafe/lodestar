import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes, StateFormat} from "../routes/debug.js";
import {IHttpClient, getFetchOptsSerializers, generateGenericJsonClient} from "../../utils/client/index.js";

// As Jul 2022, it takes up to 3 mins to download states so make this 5 mins for reservation
const GET_STATE_TIMEOUT_MS = 5 * 60 * 1000;

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
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getState(stateId, format),
          timeoutMs: GET_STATE_TIMEOUT_MS,
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getState(stateId, format);
      }
    },
    async getStateV2(stateId: string, format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getStateV2(stateId, format),
          timeoutMs: GET_STATE_TIMEOUT_MS,
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getStateV2(stateId, format);
      }
    },
  };
}
