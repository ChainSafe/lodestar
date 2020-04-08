import * as fastify from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
// @ts-ignore
import {readable} from "it-to-stream";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

export const registerBlockStreamEndpoint: LodestarRestApiEndpoint = (server, {api, config}): void => {
  server.get<fastify.DefaultQuery, {}, unknown>(
    "/blocks/stream",
    {},
    async (request, reply) => {
      const source = api.beacon.getBlockStream();
      const transform = (source: AsyncIterable<SignedBeaconBlock>): AsyncIterable<string> => (async function*() {
        //opens stream
        yield "\n";
        for await (const block of source) {
          /**
             * Required event format:
             * id: <id>\n
             * data: <message>\n\n
             */
          yield "id: " + JSON.stringify(
            config.types.Root.toJson(
              config.types.SignedBeaconBlock.hashTreeRoot(block)
            )
          ) + "\n";
          //double new line ends message
          yield "data: " + JSON.stringify(config.types.SignedBeaconBlock.toJson(block)) + "\n\n";
        }
      })();
      //converts async iterable to stream (fastify doesn't handle async iterable) and transforms to event message format
      const stream = readable(transform(source));
      reply
        .type("text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .send(stream);
    });
};