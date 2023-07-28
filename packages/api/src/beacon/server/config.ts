import {ChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/config.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<ServerApi<Api>, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<ServerApi<Api>, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
