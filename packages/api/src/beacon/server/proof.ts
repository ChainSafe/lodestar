import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/proof.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers();
  const serverRoutes = getGenericJsonServer<ServerApi<Api>, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    // Non-JSON routes. Return binary
    getStateProof: {
      ...serverRoutes.getStateProof,
      handler: async (req) => {
        const args = reqSerializers.getStateProof.parseReq(req);
        const apiRes = await api.getStateProof(...args);
        const data = "status" in apiRes ? apiRes.response?.data : apiRes.data;
        const leaves = (data as CompactMultiProof).leaves;
        const response = new Uint8Array(32 * leaves.length);
        for (let i = 0; i < leaves.length; i++) {
          response.set(leaves[i], i * 32);
        }
        // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
        return Buffer.from(response);
      },
    },
    getBlockProof: {
      ...serverRoutes.getBlockProof,
      handler: async (req) => {
        const args = reqSerializers.getBlockProof.parseReq(req);
        const apiRes = await api.getBlockProof(...args);
        const data = "status" in apiRes ? apiRes.response?.data : apiRes.data;
        const leaves = (data as CompactMultiProof).leaves;
        const response = new Uint8Array(32 * leaves.length);
        for (let i = 0; i < leaves.length; i++) {
          response.set(leaves[i], i * 32);
        }
        // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
        return Buffer.from(response);
      },
    },
  };
}
