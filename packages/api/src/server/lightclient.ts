import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {ServerRoutes, getGenericJsonServer} from "./utils";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/lightclient";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers();
  const serverRoutes = getGenericJsonServer<Api, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    // Non-JSON routes. Return binary
    getStateProof: {
      ...serverRoutes.getStateProof,
      handler: async (req) => {
        const args = reqSerializers.getStateProof.parseReq(req);
        const {data: proof} = await api.getStateProof(...args);
        // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
        return Buffer.from(serializeProof(proof));
      },
    },
    // Non-JSON route. Return binary
    getInitProof: {
      ...serverRoutes.getInitProof,
      handler: async (req) => {
        const args = reqSerializers.getInitProof.parseReq(req);
        const {data: proof} = await api.getInitProof(...args);
        // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
        return Buffer.from(serializeProof(proof));
      },
    },
  };
}
