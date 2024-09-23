import type * as fastify from "fastify";
import {MediaType} from "../headers.js";

export function addSszContentTypeParser(server: fastify.FastifyInstance): void {
  server.addContentTypeParser(
    MediaType.ssz,
    {parseAs: "buffer"},
    async (_request: fastify.FastifyRequest, payload: Buffer) => {
      // We could just return the `Buffer` here which is a subclass of `Uint8Array` but downstream code does not require it
      // and it's better to convert it here to avoid unexpected behavior such as `Buffer.prototype.slice` not copying memory
      // See https://github.com/nodejs/node/issues/41588#issuecomment-1016269584
      return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
  );
}
