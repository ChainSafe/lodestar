import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {toRestJson} from "../../utils";
import {produceAttestation} from "../../../impl/validator";

interface Query extends DefaultQuery {
  validator_pubkey: string;
  poc_bit: number;
  slot: number;
  shard: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query> = {
  schema: {
    querystring: {
      type: 'object',
      required: ["validator_pubkey", "poc_bit", "slot", "shard"],
      properties: {
        "validator_pubkey": {
          type: "string"
        },
        "poc_bit": {
          type: "integer",
          minimum: 0
        },
        shard: {
          type: "integer",
          minimum: 0
        },
        slot: {
          type: "integer",
          minimum: 0
        },
      }
    },
  }
};

export const registerAttestationProductionEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<Query>(
    '/attestation',
    opts,
    async (request, reply) => {
      const attestation = await produceAttestation(
        {db: modules.db, chain: modules.chain, config: modules.config},
        Buffer.from(request.query.validator_pubkey.replace('0x', ''), 'hex'),
        request.query.shard,
        request.query.slot
      );
      reply
        .code(200)
        .type('application/json')
        .send(toRestJson(attestation));
    }
  );
};