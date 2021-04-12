import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "./util";
import {getHealth, getNetworkIdentity, getPeer, getPeers, getSyncingStatus, getVersion} from "../controllers/node";

export function registerNodeRoutes(server: FastifyInstance): void {
  const routes = [getNetworkIdentity, getPeers, getPeer, getVersion, getSyncingStatus, getHealth];
  registerRoutesToServer(server, routes, "/v1/node");
}
