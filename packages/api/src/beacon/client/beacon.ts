import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReqSerializers, getReturnTypes, BlockId} from "../routes/beacon/index.js";
import {IHttpClient, generateGenericJsonClient, getFetchOptsSerializers} from "../../utils/client/index.js";
import {ResponseFormat} from "../../interfaces.js";
import {BlockResponse, BlockV2Response} from "../routes/beacon/block.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(config: ChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();
  // Some routes return JSON, use a client auto-generator
  const client = generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
  const fetchOptsSerializer = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,
    async getBlock<T extends ResponseFormat = "json">(blockId: BlockId, format?: T) {
      if (format === "ssz") {
        const res = await httpClient.arrayBuffer({
          ...fetchOptsSerializer.getBlock(blockId, format),
        });
        return {
          ok: true,
          response: new Uint8Array(res.body),
          status: res.status,
        } as BlockResponse<T>;
      }
      return client.getBlock(blockId, format);
    },
    async getBlockV2<T extends ResponseFormat = "json">(blockId: BlockId, format?: T) {
      if (format === "ssz") {
        const res = await httpClient.arrayBuffer({
          ...fetchOptsSerializer.getBlockV2(blockId, format),
        });
        return {
          ok: true,
          response: new Uint8Array(res.body),
          status: res.status,
        } as BlockV2Response<T>;
      }
      return client.getBlockV2(blockId, format);
    },
  };
}
