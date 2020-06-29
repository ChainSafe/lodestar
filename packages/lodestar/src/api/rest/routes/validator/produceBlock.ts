import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHex} from "@chainsafe/lodestar-utils";

interface IQuery extends DefaultQuery {
  slot: number;
  // eslint-disable-next-line camelcase
  proposer_pubkey: string;
  // eslint-disable-next-line camelcase
  randao_reveal: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["slot", "proposer_pubkey", "randao_reveal"],
      properties: {
        slot: {
          type: "integer",
          minimum: 0
        },
        "proposer_pubkey": {
          type: "string",
        },
        "randao_reveal": {
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
        fromHex(request.query.proposer_pubkey),
        fromHex(request.query.randao_reveal)
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.BeaconBlock.toJson(block, {case: "snake"}));
    }
  );
};
