import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/lodestar";
import {ServerRoutes, getGenericJsonServer} from "./utils";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<Api, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
