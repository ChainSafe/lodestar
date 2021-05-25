import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.config.Api
): ApiControllers<routes.config.Api, routes.config.ReqTypes> {
  return getGenericServer<routes.config.Api, routes.config.ReqTypes>(routes.config, config, api);
}
