import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ServerRoutes, getGenericJsonServer} from "./utils/index.js";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/config.js";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<Api, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
