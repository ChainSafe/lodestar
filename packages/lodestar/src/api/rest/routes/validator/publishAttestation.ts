import fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";


const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "object"
    },
  }
};

export const registerAttestationPublishEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post(
    "/attestation",
    opts,
    async (request, reply) => {
      try {
        const attestation = config.types.Attestation.fromJson(request.body);
        await api.validator.publishAttestation(
          attestation
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
