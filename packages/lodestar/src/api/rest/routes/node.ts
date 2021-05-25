import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.node.Api
): ApiControllers<routes.node.Api, routes.node.ReqTypes> {
  return getGenericServer<routes.node.Api, routes.node.ReqTypes>(routes.node, config, api);
}
