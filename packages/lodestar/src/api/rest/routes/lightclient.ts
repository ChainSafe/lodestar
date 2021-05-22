import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.lightclient.Api
): {[K in keyof routes.lightclient.Api]: ApiController} {
  const reqsSerdes = routes.lightclient.getReqSerdes();
  const returnTypes = routes.lightclient.getReturnTypes(config);

  return getGenericServer<routes.lightclient.Api, routes.lightclient.ReqTypes>(
    routes.lightclient.routesData,
    reqsSerdes,
    returnTypes,
    api
  );
}
