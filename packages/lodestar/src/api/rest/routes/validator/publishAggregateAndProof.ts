import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromHex} from "@chainsafe/eth2.0-utils";

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

export const registerPublishAggregateAndProofEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post<IQuery>(
    "/aggregate",
    opts,
    async (request, reply) => {
      try {
        const aggregatedAttestation = modules.config.types.Attestation.fromJson(request.body);
        const aggregateAndProof: AggregateAndProof = {
          aggregate: aggregatedAttestation,
          selectionProof: fromHex(request.query.slot_signature),
          aggregatorIndex: await modules.db.getValidatorIndex(fromHex(request.query.validator_pubkey)),
        };
        await Promise.all([
          modules.network.gossip.publishAggregatedAttestation(
            aggregateAndProof
          ),
          modules.opPool.aggregateAndProofs.receive(aggregateAndProof)
        ]);
      } catch (e) {
        modules.logger.error(e.message);
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
