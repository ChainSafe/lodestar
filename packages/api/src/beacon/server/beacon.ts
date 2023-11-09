import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/beacon/index.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();

  // Most of routes return JSON, use a server auto-generator
  const serverRoutes = getGenericJsonServer<ServerApi<Api>, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );
  return {
    ...serverRoutes,
    // Non-JSON routes. Return JSON or binary depending on "accept" header
    getBlock: {
      ...serverRoutes.getBlock,
      handler: async (req) => {
        const response = await api.getBlock(...reqSerializers.getBlock.parseReq(req));
        if (response instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          return returnTypes.getBlock.toJson(response);
        }
      },
    },
    getBlockV2: {
      ...serverRoutes.getBlockV2,
      handler: async (req) => {
        const response = await api.getBlockV2(...reqSerializers.getBlockV2.parseReq(req));
        if (response instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          return returnTypes.getBlockV2.toJson(response);
        }
      },
    },
  };
}
