import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, getDefinitions} from "../routes/beacon/index.js";

export function getRoutes(config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(config), methods);
}
