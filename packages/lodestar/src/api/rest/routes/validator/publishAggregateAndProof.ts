import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultQuery} from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../interface";

interface IQuery extends DefaultQuery {
  "validator_pubkey": string;
  "slot_signature": string;
}

const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["validator_pubkey", "slot_signature"],
      properties: {
        "validator_pubkey": {
          type: "string"
        },
        "slot_signature": {
          type: "string"
        }
      }
    },
    body: {
      type: "object",
    },
  }
};

export const registerPublishAggregateAndProofEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post<IQuery>(
    "/aggregate",
    opts,
    async (request, reply) => {
      try {
        await api.validator.publishAggregatedAttestation(
          config.types.Attestation.fromJson(request.body),
          fromHexString(request.query.validator_pubkey),
          fromHexString(request.query.slot_signature)
        );
      } catch (e) {
        reply.code(500).send();
        return;
      }
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
