import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {Json} from "@chainsafe/ssz";

export const registerHeadEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/head",
    {},
    async (request, reply) => {
      const responseValue = await api.beacon.getHead();
      const response: Json = config.types.HeadResponse.toJson(responseValue);
      reply
        .code(200)
        .type("application/json")
        .send(
          response
        );
    });
};