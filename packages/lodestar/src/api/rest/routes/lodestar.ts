import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {ApiController} from "../types";

export function getRoutes(api: routes.lodestar.Api): {[K in keyof routes.lodestar.Api]: ApiController} {
  const reqsSerdes = routes.lodestar.getReqSerdes();
  const returnTypes = routes.lodestar.getReturnTypes();

  return getGenericServer<routes.lodestar.Api, routes.lodestar.ReqTypes>(
    routes.lodestar.routesData,
    reqsSerdes,
    returnTypes,
    api
  );
}
