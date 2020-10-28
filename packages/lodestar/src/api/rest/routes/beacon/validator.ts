import {fromHexString} from "@chainsafe/ssz";
import * as fastify from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {ValidatorResponse} from "../../../types/validator";
import {LodestarRestApiEndpoint} from "../../interface";

export interface IQuery {
  pubkey: string;
}

const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["pubkey"],
      properties: {
        pubkey: {
          type: "string",
        },
      },
    },
  },
};

export const registerGetValidatorEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<IQuery>("/validators/{pubkey}", opts, async (request, reply) => {
    const validator = await api.beacon.getValidator(fromHexString(request.query.pubkey));
    if (!validator) {
      return reply.code(404).send();
    }
    reply
      .code(200)
      .type("application/json")
      .send(ValidatorResponse(config).toJson(validator, {case: "snake"}));
  });
};
