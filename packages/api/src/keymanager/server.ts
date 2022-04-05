import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "./routes";
import {ServerRoutes, getGenericJsonServer} from "../server/utils";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<Api, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
