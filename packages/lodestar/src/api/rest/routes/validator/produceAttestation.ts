/* eslint-disable camelcase */
import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultQuery} from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../interface";

interface IQuery extends DefaultQuery {
  validatorPubkey: string;
  slot: number;
  attestationCommitteeIndex: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["validatorPubkey", "slot", "attestationCommitteeIndex"],
      properties: {
        validatorPubkey: {
          type: "string"
        },
        attestationCommitteeIndex: {
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

export const registerAttestationProductionEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery>(
    "/attestation",
    opts,
    async (request, reply) => {
      const responseValue = await api.validator.produceAttestation(
        fromHexString(request.query.validatorPubkey),
        request.query.attestationCommitteeIndex,
        request.query.slot
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.Attestation.toJson(responseValue, {case: "snake"}));
    }
  );
};
