import * as fastify from "fastify";
import {EventMessage} from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

export const registerBlockStreamEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/blocks/stream",
    {},
    async (request, reply) => {
      const source = api.beacon.getBlockStream();
      const transform = (source: AsyncIterable<SignedBeaconBlock>): AsyncIterable<EventMessage> => (async function*() {
        for await (const block of source) {
          const msg: EventMessage = {
            id: String(block.message.slot),
            data: JSON.stringify(config.types.SignedBeaconBlock.toJson(block, {case: "snake"}))
          };
          yield msg;
        }
      })();
      reply
        .type("text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .sse(transform(source));
    });
};
