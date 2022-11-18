import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/lightclient.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  const serverRoutes = getGenericJsonServer<Api, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    // Non-JSON routes. Return binary
    getBootstrap: {
      ...serverRoutes.getBootstrap,
      handler: async (req) => {
        const data = await api.getBootstrap(...reqSerializers.getBootstrap.parseReq(req));
        if (data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(data);
        } else {
          return returnTypes.getBootstrap.toJson(data);
        }
      },
    },
    getFinalityUpdate: {
      ...serverRoutes.getFinalityUpdate,
      handler: async (req) => {
        const data = await api.getFinalityUpdate(...reqSerializers.getFinalityUpdate.parseReq(req));
        if (data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(data);
        } else {
          return returnTypes.getFinalityUpdate.toJson(data);
        }
      },
    },
    getOptimisticUpdate: {
      ...serverRoutes.getOptimisticUpdate,
      handler: async (req) => {
        const data = await api.getOptimisticUpdate(...reqSerializers.getOptimisticUpdate.parseReq(req));
        if (data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(data);
        } else {
          return returnTypes.getOptimisticUpdate.toJson(data);
        }
      },
    },
    getUpdates: {
      ...serverRoutes.getUpdates,
      handler: async (req) => {
        const data = await api.getUpdates(...reqSerializers.getUpdates.parseReq(req));
        if (data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(data);
        } else {
          return returnTypes.getUpdates.toJson(data);
        }
      },
    },
  };
}
