import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {assembleBlock} from "../../../../chain/factory/block";
import {toJson} from "@chainsafe/eth2.0-utils";

interface IQuery extends DefaultQuery {
  slot: number;
  // eslint-disable-next-line camelcase
  randao_reveal: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["slot", "randao_reveal"],
      properties: {
        slot: {
          type: "integer",
          minimum: 0
        },
        "randao_reveal": {
          type: "string"
        }
      }
    },
  }
};

export const registerBlockProductionEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<IQuery>(
    "/block",
    opts,
    async (request, reply) => {
      const block = await assembleBlock(
        modules.config,
        modules.db,
        modules.opPool,
        modules.eth1,
        request.query.slot,
        Buffer.from(request.query.randao_reveal)
      );
      reply
        .code(200)
        .type("application/json")
        .send(toJson(block));
    }
  );
};