import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {Json} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../interface";

type IBody = Json[];

const opts: fastify.RouteShorthandOptions<
Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, IBody
> = {
  schema: {
    body: {
      type: "array",
    },
  }
};

export const registerPublishAggregateAndProofEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/aggregate_and_proof",
    opts,
    async (request, reply) => {
      await Promise.all(
        request.body.map((payload) => {
          api.validator.publishAggregateAndProof(
            config.types.SignedAggregateAndProof.fromJson(payload, {case: "snake"})
          );
        })
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
