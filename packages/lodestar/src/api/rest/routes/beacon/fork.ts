import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";

export const registerForkEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/fork",
    {},
    async (request, reply) => {
      reply.code(200).type("application/json").send(
        config.types.ForkResponse.toJson(
          await api.beacon.getFork(), {case: "snake"}
        )
      );
    });
};
