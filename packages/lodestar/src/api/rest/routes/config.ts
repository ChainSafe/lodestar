import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "./util";
import {getForkSchedule} from "../controllers/config";
import {getDepositContract} from "../controllers/config/getDepositContract";
import {getSpec} from "../controllers/config/getSpec";

export function registerConfigRoutes(server: FastifyInstance): void {
  const routes = [getForkSchedule, getDepositContract, getSpec];
  registerRoutesToServer(server, routes, "/v1/config");
}
