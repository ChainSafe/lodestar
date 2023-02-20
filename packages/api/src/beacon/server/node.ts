import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/node.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<ServerApi<Api>, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  const serverRoutes = getGenericJsonServer<ServerApi<Api>, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    getHealth: {
      ...serverRoutes.getHealth,
      handler: async (req, res) => {
        try {
          await api.getHealth();
          res.raw.writeHead(HttpStatusCode.OK);
          res.raw.end();
        } catch (e) {
          res.raw.writeHead(HttpStatusCode.INTERNAL_SERVER_ERROR);
          res.raw.end();
        }
      },
    },
  };
}
