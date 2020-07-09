import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";

export const registerHeadEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/head",
    {},
    async (request, reply) => {
      const responseValue = await api.beacon.getHead();
      reply
        .code(200)
        .type("application/json")
        .send(
          config.types.HeadResponse.toJson(responseValue, {case: "snake"})
        );
    });
};