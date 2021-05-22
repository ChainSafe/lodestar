import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.config.Api
): {[K in keyof routes.config.Api]: ApiController} {
  const reqsSerdes = routes.config.getReqSerdes();
  const returnTypes = routes.config.getReturnTypes(config);

  return getGenericServer<routes.config.Api, routes.config.ReqTypes>(
    routes.config.routesData,
    reqsSerdes,
    returnTypes,
    api
  );
}
