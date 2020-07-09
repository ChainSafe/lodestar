import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";

export const registerPeersEndpoint: LodestarRestApiEndpoint = (server, {api}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/peers",
    {},
    async (request, reply) => {
      const responseValue = await api.beacon.getPeers();
      reply
        .code(200)
        .type("application/json")
        .send(responseValue.map((id) => id.toB58String()));
    });
};