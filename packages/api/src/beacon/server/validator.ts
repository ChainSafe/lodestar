import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, definitions} from "../routes/validator.js";

export function getRoutes(_config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(definitions, methods);
}
