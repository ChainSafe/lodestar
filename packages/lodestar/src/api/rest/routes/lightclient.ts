import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.lightclient.Api
): ApiControllers<routes.lightclient.Api, routes.lightclient.ReqTypes> {
  return getGenericServer<routes.lightclient.Api, routes.lightclient.ReqTypes>(routes.lightclient, config, api);
}
