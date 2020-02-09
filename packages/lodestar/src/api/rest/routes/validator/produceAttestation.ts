/* eslint-disable camelcase */
import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultQuery} from "fastify";
import {fromHexString} from "@chainsafe/ssz";

import {IFastifyServer} from "../../index";
import {IApiModules} from "../../../interface";
import {produceAttestation} from "../../../impl/validator";

interface IQuery extends DefaultQuery {
  validator_pubkey: string;
  poc_bit: number;
  slot: number;
  shard: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["validator_pubkey", "poc_bit", "slot", "committee_index"],
      properties: {
        "validator_pubkey": {
          type: "string"
        },
        "poc_bit": {
          type: "integer",
          minimum: 0
        },
        "committee_index": {
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
  fastify.get<IQuery>(
    "/attestation",
    opts,
    async (request, reply) => {
      const attestation = await produceAttestation(
        {db: modules.db, chain: modules.chain, config: modules.config},
        fromHexString(request.query.validator_pubkey),
        request.query.committee_index,
        request.query.slot
      );
      reply
        .code(200)
        .type("application/json")
        .send(modules.config.types.Attestation.toJson(attestation));
    }
  );
};
