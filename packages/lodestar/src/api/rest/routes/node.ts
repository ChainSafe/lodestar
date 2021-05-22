import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController} from "../types";

export function getRoutes(config: IBeaconConfig, api: routes.node.Api): {[K in keyof routes.node.Api]: ApiController} {
  const reqsSerdes = routes.node.getReqSerdes();
  const returnTypes = routes.node.getReturnTypes(config);

  return getGenericServer<routes.node.Api, routes.node.ReqTypes>(routes.node.routesData, reqsSerdes, returnTypes, api);
}
