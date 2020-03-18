import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";

export const registerVersionEndpoint: LodestarRestApiEndpoint 
    = (server, {api}): void => {
      server.get<fastify.DefaultQuery, {}, unknown>(
        "/version", 
        {}, 
        async (request, reply) => {
          reply.code(200).type("application/json").send(
            ((await api.beacon.getClientVersion()) as Buffer).toString("utf-8")
          );
        });
    };