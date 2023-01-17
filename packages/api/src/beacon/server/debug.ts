import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/debug.js";
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

    // Non-JSON routes. Return JSON or binary depending on "accept" header
    getState: {
      ...serverRoutes.getState,
      handler: async (req) => {
        const {response: res} = await api.getState(...reqSerializers.getState.parseReq(req));
        if (res.data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(res.data);
        } else {
          return returnTypes.getState.toJson(res);
        }
      },
    },
    getStateV2: {
      ...serverRoutes.getStateV2,
      handler: async (req) => {
        const {response: res} = await api.getStateV2(...reqSerializers.getStateV2.parseReq(req));
        if (res.data instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(res.data);
        } else {
          return returnTypes.getStateV2.toJson(res);
        }
      },
    },
  };
}
