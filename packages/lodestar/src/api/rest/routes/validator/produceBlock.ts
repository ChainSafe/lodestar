import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHex} from "@chainsafe/lodestar-utils";

interface IQuery extends DefaultQuery {
  slot: number;
  proposerPubkey: string;
  randaoReveal: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["slot", "proposerPubkey", "randaoReveal"],
      properties: {
        slot: {
          type: "integer",
          minimum: 0
        },
        proposerPubkey: {
          type: "string",
        },
        randaoReveal: {
          type: "string"
        }
      }
    },
  }
};

export const registerBlockProductionEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery>(
    "/block",
    opts,
    async (request, reply) => {
      const block = await api.validator.produceBlock(
        request.query.slot,
        fromHex(request.query.proposerPubkey),
        fromHex(request.query.randaoReveal)
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.BeaconBlock.toJson(block, {case: "snake"}));
    }
  );
};
