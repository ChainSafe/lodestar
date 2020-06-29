import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromHexString} from "@chainsafe/ssz";

export interface IQuery {
  pubkey: string;
}

const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["pubkey"],
      properties: {
        "pubkey": {
          type: "string"
        }
      }
    },
  }
};

export const registerGetValidatorEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<IQuery, {}, unknown>(
    "/validators/{pubkey}",
    opts,
    async (request, reply) => {
      const validator = await api.beacon.getValidator(fromHexString(request.query.pubkey));
      reply
        .code(200)
        .type("application/json")
        .send(
          config.types.ValidatorResponse.toJson(
            validator, {case: "snake"}
          )
        );
    });
};
