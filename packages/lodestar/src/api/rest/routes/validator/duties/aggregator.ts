import {IFastifyServer} from "../../../index";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {isAggregator} from "@chainsafe/eth2.0-state-transition";

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

export const registerIsAggregatorEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<IQuery, IParams>(
    "/duties/:slot/aggregator",
    opts,
    async (request, reply) => {
      const block = await modules.db.block.get(modules.chain.forkChoice.head());
      const state = await modules.db.state.get(block.stateRoot);
      const isAttestationAggregator = isAggregator(
        modules.config,
        state,
        request.params.slot,
        request.query.committee_index,
        Buffer.from(request.query.slot_signature.replace("0x", ""), "hex")
      );
      reply
        .code(200)
        .type("application/json")
        .send(isAttestationAggregator);
    }
  );
};