import fastify, {DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {Json} from "@chainsafe/ssz";

type IBody = Json[];

const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "array"
    },
  }
};

export const registerAttestationPublishEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/attestation",
    opts,
    async (request, reply) => {
      try {
        await Promise.all([
          request.body.map((payload) => {
            return api.validator.publishAttestation(
              config.types.Attestation.fromJson(payload, {case: "snake"})
            );
          })
        ]);

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
