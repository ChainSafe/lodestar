import {IChainForkConfig} from "@lodestar/config";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {SyncPeriod} from "@lodestar/types";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes, StateFormat} from "../routes/lightclient.js";
import {IHttpClient, getFetchOptsSerializers, generateGenericJsonClient} from "../../utils/client/index.js";

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
    async getBootstrap(blockRoot, format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getBootstrap(blockRoot, format),
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getBootstrap(blockRoot, format);
      }
    },
    async getFinalityUpdate(format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getFinalityUpdate(format),
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getFinalityUpdate(format);
      }
    },
    async getOptimisticUpdate(format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getOptimisticUpdate(format),
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getOptimisticUpdate(format);
      }
    },
    async getUpdates(startPeriod: SyncPeriod, count: number, format?: StateFormat) {
      if (format === "ssz") {
        const buffer = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getUpdates(startPeriod, count, format),
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return new Uint8Array(buffer) as any;
      } else {
        return client.getUpdates(startPeriod, count, format);
      }
    },
  };
}
