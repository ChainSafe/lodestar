import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/node.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<ServerApi<Api>, ReqTypes> {
  const reqSerializers = getReqSerializers();

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
        const args = reqSerializers.getHealth.parseReq(req);
        // Note: This type casting is required as per route definition getHealth
        // does not return a value but since the internal API does not have access
        // to response object it is required to set the HTTP status code here.
        res.statusCode = (await api.getHealth(...args)) as unknown as number;
      },
    },
  };
}
