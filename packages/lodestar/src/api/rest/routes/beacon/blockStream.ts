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
      console.log("creating stream");
      const source = api.beacon.getBlockStream();
      const transform = (source: AsyncIterable<SignedBeaconBlock>): AsyncIterable<string> => (async function*() {
        for await (const block of source) {
          yield "data:" + JSON.stringify(config.types.SignedBeaconBlock.toJson(block)) + "\n\n";
        }
      })();
      const stream = readable(transform(source));
      console.log(stream);
      reply
        .type("text/event-stream")
        .header("Content-Encoding", "identity")
        .header("Transfer-Encoding", "identity")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .send(stream);
    });
};