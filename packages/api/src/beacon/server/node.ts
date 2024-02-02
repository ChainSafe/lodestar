import {ApplicationMethods, FastifyRoutes, createFastifyRoutes} from "../../utils/server.js";
import {Endpoints, definitions} from "../routes/node.js";

export function getRoutes(methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(definitions, methods);
}
