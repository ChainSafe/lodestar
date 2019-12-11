import {IFastifyServer} from "../../../index";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {getEpochProposers} from "../../../../impl/validator";
import {toHex} from "@chainsafe/eth2.0-utils";

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
    "/duties/proposer/:epoch",
    opts,
    async (request, reply) => {
      const epochProposers = await getEpochProposers(
        modules.config,
        modules.db,
        request.params.epoch
      );
      const response: {[k: number]: string} = {};
      epochProposers.forEach((value, key) => {
        response[key] = toHex(value);
      });
      reply
        .code(200)
        .type("application/json")
        .send(response);
    }
  );
};