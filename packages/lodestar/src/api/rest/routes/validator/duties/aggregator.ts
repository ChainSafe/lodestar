import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../../interface";

interface IParams extends DefaultParams {
  slot: number;
}

interface IQuery extends DefaultQuery {
  "slot_signature": string;
  "committee_index": number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery, IParams> = {
  schema: {
    params: {
      type: "object",
      required: ["slot"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
    querystring: {
      type: "object",
      required: ["slot_signature", "committee_index"],
      properties: {
        "slot_signature": {
          type: "string"
        },
        "committee_index": {
          type: "integer"
        }
      }
    },
  }
};

export const registerIsAggregatorEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery, IParams>(
    "/duties/:slot/aggregator",
    opts,
    async (request, reply) => {
      const responseValue = await api.validator.isAggregator(
        request.params.slot,
        request.query.committee_index,
        fromHexString(request.query.slot_signature)
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.Boolean.toJson(responseValue));
    }
  );
};
