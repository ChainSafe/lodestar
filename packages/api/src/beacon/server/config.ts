import {IChainForkConfig} from "@lodestar/config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/config.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<Api, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
