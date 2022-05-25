import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ServerRoutes, getGenericJsonServer} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/node.js";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  const serverRoutes = getGenericJsonServer<Api, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    getHealth: {
      ...serverRoutes.getHealth,
      handler: async (req, res) => {
        const healthCode = await api.getHealth();
        res.raw.writeHead(healthCode);
        res.raw.write(String(healthCode));
        res.raw.end();
      },
    },
  };
}
