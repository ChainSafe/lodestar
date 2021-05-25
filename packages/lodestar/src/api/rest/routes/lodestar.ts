import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.lodestar.Api
): ApiControllers<routes.lodestar.Api, routes.lodestar.ReqTypes> {
  return getGenericServer<routes.lodestar.Api, routes.lodestar.ReqTypes>(routes.lodestar, config, api);
}
