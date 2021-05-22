import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.beacon.Api
): {[K in keyof routes.beacon.Api]: ApiController} {
  const reqsSerdes = routes.beacon.getReqSerdes(config);
  const returnTypes = routes.beacon.getReturnTypes(config);

  return getGenericServer<routes.beacon.Api, routes.beacon.ReqTypes>(
    routes.beacon.routesData,
    reqsSerdes,
    returnTypes,
    api
  );
}
