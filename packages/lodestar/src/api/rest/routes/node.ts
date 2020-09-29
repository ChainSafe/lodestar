import {FastifyInstance} from "fastify";
import {getHealth, getNetworkIdentity, getPeer, getPeers, getSyncingStatus, getVersion} from "../controllers/node";

export function registerNodeRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getNetworkIdentity.url, getNetworkIdentity.opts, getNetworkIdentity.handler);
      fastify.get(getPeers.url, getPeers.opts, getPeers.handler);
      fastify.get(getPeer.url, getPeer.opts, getPeer.handler);
      fastify.get(getVersion.url, getVersion.opts, getVersion.handler);
      fastify.get(getSyncingStatus.url, getSyncingStatus.opts, getSyncingStatus.handler);
      fastify.get(getHealth.url, getHealth.opts, getHealth.handler);
    },
    {prefix: "/v1/node"}
  );
}
