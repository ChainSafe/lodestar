import {IFastifyServer} from "../../index";
import fastify from "fastify";
import {IApiModules} from "../../../interface";
import {fromJson} from "@chainsafe/eth2.0-utils";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";


const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
    },
  }
};

export const registerPublishAggregateAndProofEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post(
    "/aggregate",
    opts,
    async (request, reply) => {
      try {
        const aggregateAndProof = fromJson<AggregateAndProof>(
          request.body,
          modules.config.types.AggregateAndProof
        );
        await Promise.all([
          modules.network.gossip.publishAggregatedAttestation(
            aggregateAndProof
          ),
          modules.opPool.attestations.receiveAggregatedAttestation(aggregateAndProof)
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