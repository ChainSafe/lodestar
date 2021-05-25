import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.beacon.Api
): ApiControllers<routes.beacon.Api, routes.beacon.ReqTypes> {
  return getGenericServer<routes.beacon.Api, routes.beacon.ReqTypes>(routes.beacon, config, api);
}
