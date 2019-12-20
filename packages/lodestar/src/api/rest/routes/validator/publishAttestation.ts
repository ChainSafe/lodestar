import {IFastifyServer} from "../../index";
import fastify from "fastify";
import {IApiModules} from "../../../interface";
import {fromJson} from "@chainsafe/eth2.0-utils";
import {Attestation} from "@chainsafe/eth2.0-types";
import {publishAttestation} from "../../../impl/validator/publishAttestation";


const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "object"
    },
  }
};

export const registerAttestationPublishEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post(
    "/attestation",
    opts,
    async (request, reply) => {
      try {
        const attestation = fromJson<Attestation>(
          modules.config.types.Attestation,
          request.body
        );
        await publishAttestation(attestation, modules.network.gossip, modules.opPool.attestations);
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
