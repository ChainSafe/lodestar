import {FastifyInstance} from "fastify";
import {getHealth, getNetworkIdentity, getPeer, getPeers, getSyncingStatus, getVersion} from "../controllers/node";


export function registerNodeRoutes(server: FastifyInstance): void {
  server.get(getNetworkIdentity.url, getNetworkIdentity.opts, getNetworkIdentity.handler);
  server.get(getPeers.url, getPeers.opts, getPeers.handler);
  server.get(getPeer.url, getPeer.opts, getPeer.handler);
  server.get(getVersion.url, getVersion.opts, getVersion.handler);
  server.get(getSyncingStatus.url, getSyncingStatus.opts, getSyncingStatus.handler);
  server.get(getHealth.url, getHealth.opts, getHealth.handler);
}
