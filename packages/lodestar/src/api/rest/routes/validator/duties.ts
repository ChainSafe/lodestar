import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {Epoch, ValidatorDuty} from "@chainsafe/eth2.0-types";
import {getValidatorDuties} from "../../../impl/validator";
import {IncomingMessage, Server, ServerResponse} from "http";
import {toHex} from "../../../../util/bytes";

interface Query extends DefaultQuery {
  validator_pubkeys: string[];
  epoch: Epoch;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query> = {
  schema: {
    querystring: {
      type: 'object',
      required: ["validator_pubkeys", "epoch"],
      properties: {
        "validator_pubkeys": {
          type: 'array',
          maxItems: 5,
          items: {
            types: "string"
          }
        },
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

function formatJson(duty: ValidatorDuty): object {
  return {
    "validator_pubkey": toHex(duty.validatorPubkey),
    "attestation_slot": duty.attestationSlot,
    "attestation_shard": duty.attestationShard,
    "block_proposal_slot": duty.blockProductionSlot
  };
}

export const registerDutiesEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<Query>(
    '/duties',
    opts,
    async (request, reply) => {
      const duties = (await getValidatorDuties(
        modules.config,
        modules.db,
        request.query.validator_pubkeys.map(key => Buffer.from(key, 'hex')),
        request.query.epoch
      )).map(formatJson);
      reply
        .code(200)
        .type('application/json')
        .send(duties);
    }
  );
};