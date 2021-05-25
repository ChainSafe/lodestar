import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.validator.Api
): ApiControllers<routes.validator.Api, routes.validator.ReqTypes> {
  return getGenericServer<routes.validator.Api, routes.validator.ReqTypes>(routes.validator, config, api);
}
