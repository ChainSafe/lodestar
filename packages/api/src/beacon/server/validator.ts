import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/validator.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: IChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<ServerApi<Api>, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
