import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {toHexString} from "@chainsafe/ssz";

import {IFastifyServer} from "../../../index";
import {IApiModules} from "../../../../interface";
import {getEpochProposers} from "../../../../impl/validator";

interface IParams extends DefaultParams {
  epoch: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, DefaultQuery, IParams> = {
  schema: {
    params: {
      type: "object",
      required: ["epoch"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

export const registerProposerDutiesEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<DefaultQuery, IParams>(
    "/duties/:epoch/proposer",
    opts,
    async (request, reply) => {
      const epochProposers = await getEpochProposers(
        modules.config,
        modules.chain,
        modules.db,
        request.params.epoch
      );
      const response: {[k: number]: string} = {};
      epochProposers.forEach((value, key) => {
        response[key] = toHexString(value);
      });
      reply
        .code(200)
        .type("application/json")
        .send(response);
    }
  );
};
