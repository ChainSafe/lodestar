import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ServerRoutes, getGenericJsonServer} from "./utils";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/validator";

export function getRoutes(config: IBeaconConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<Api, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}
