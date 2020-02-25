import {IFastifyServer} from "../../index";
import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {Json} from "@chainsafe/ssz";

interface IBody extends DefaultBody {
  // eslint-disable-next-line camelcase
  beacon_block: Json;
}


//TODO: add validation
const opts: fastify.RouteShorthandOptions<
Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, IBody
>
    = {
      schema: {
        body: {
          type: "object",
          requiredKeys: ["beacon_block"],
          "beacon_block": {
            type: "object"
          }
        }
      }
    };

export const registerBlockPublishEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/block",
    opts,
    async (request, reply) => {
      await modules.chain.receiveBlock(
        modules.config.types.SignedBeaconBlock.fromJson(
          request.body.beacon_block
        )
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
