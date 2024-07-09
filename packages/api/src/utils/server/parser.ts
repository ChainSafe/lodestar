import type * as fastify from "fastify";
import {MediaType} from "../headers.js";

export function addSszContentTypeParser(server: fastify.FastifyInstance): void {
  // Cache body schema symbol, does not change per request
  let bodySchemaSymbol: symbol | undefined;

  server.addContentTypeParser(
    MediaType.ssz,
    {parseAs: "buffer"},
    async (request: fastify.FastifyRequest, payload: Buffer) => {
      if (bodySchemaSymbol === undefined) {
        // Get body schema symbol to be able to access validation function
        // https://github.com/fastify/fastify/blob/af2ccb5ff681c1d0ac22eb7314c6fa803f73c873/lib/symbols.js#L25
        bodySchemaSymbol = Object.getOwnPropertySymbols(request.context).find((s) => s.description === "body-schema");
      }
      // JSON schema validation will be applied to `Buffer` object, it is required to override validation function
      // See https://github.com/fastify/help/issues/1012, it is not possible right now to define a schema per content type
      (request.context as unknown as Record<symbol, unknown>)[bodySchemaSymbol as symbol] = () => true;

      // We could just return the `Buffer` here which is a subclass of `Uint8Array` but downstream code does not require it
      // and it's better to convert it here to avoid unexpected behavior such as `Buffer.prototype.slice` not copying memory
      // See https://github.com/nodejs/node/issues/41588#issuecomment-1016269584
      return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
  );
}
