import {FastifyInstance} from "fastify";
import {registerBeaconRoutes} from "./beacon";

export * from "./beacon";
export * from "./validator";

export function registerRoutes(server: FastifyInstance): void {
  registerBeaconRoutes(server);
}
