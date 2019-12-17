import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {toJson} from "@chainsafe/eth2.0-utils";

interface IQuery extends DefaultQuery {
  epoch: number;
  // eslint-disable-next-line camelcase
  committee_index: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["epoch", "committee_index"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        },
        "committee_index": {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

export const registerGetWireAttestationEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<IQuery>(
    "/wire_attestations",
    opts,
    async (request, reply) => {
      const attestations =
          await modules.opPool.attestations.getCommiteeAttestations(request.query.epoch, request.query.committee_index);
      reply
        .code(200)
        .type("application/json")
        .send(attestations.map(toJson));
    }
  );
};