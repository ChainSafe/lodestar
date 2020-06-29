import fastify, {DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {Json} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../interface";

type IBody = Json;


//TODO: add validation
const opts: fastify.RouteShorthandOptions<
Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, IBody
>
    = {
      schema: {
        body: {
          type: "object"
        }
      }
    };

export const registerBlockPublishEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/block",
    opts,
    async (request, reply) => {
      await api.validator.publishBlock(
        config.types.SignedBeaconBlock.fromJson(
          request.body, {case: "snake"}
        )
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
