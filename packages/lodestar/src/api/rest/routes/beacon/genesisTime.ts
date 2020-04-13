import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";

export const registerGenesisTimeEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/genesis_time",
    {},
    async (request, reply) => {
      reply
        .code(200)
        .type("application/json")
        .send(
          config.types.Uint64.toJson(
            BigInt(await api.beacon.getGenesisTime())
          )
        );
    });
};