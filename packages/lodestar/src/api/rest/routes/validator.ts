import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.validator.Api
): {[K in keyof routes.validator.Api]: ApiController} {
  const reqsSerdes = routes.validator.getReqSerdes(config);
  const returnTypes = routes.validator.getReturnTypes(config);

  return getGenericServer<routes.validator.Api, routes.validator.ReqTypes>(
    routes.validator.routesData,
    reqsSerdes,
    returnTypes,
    api
  );
}
