import type * as fastify from "fastify";
import {parse as parseQueryString} from "qs";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {MediaType} from "../headers.js";
import {BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS} from "../schema.js";

export {BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS};

/**
 * Cap for array query params, set to the largest array any beacon-API query can carry:
 * a full data-column custody set (`getDebugDataColumnSidecars` `indices`). `qs` turns
 * longer arrays into an object, which then fails schema validation.
 */
export const QUERY_STRING_ARRAY_LIMIT = NUMBER_OF_COLUMNS;

/**
 * Shared REST querystring parser used by the production Fastify server and API test harness.
 * Must stay OpenAPI-compliant for comma-separated arrays (`?id=a,b,c`).
 */
export function parseRestQueryString(str: string): Record<string, unknown> {
  return parseQueryString(str, {
    // Array as comma-separated values must be supported to be OpenAPI spec compliant
    comma: true,
    // Drop support for array query strings like `id[0]=1&id[1]=2&id[2]=3` as those are not required to
    // be OpenAPI spec compliant and results are inconsistent, see https://github.com/ljharb/qs/issues/331.
    // The schema validation will catch this and throw an error as parsed query string results in an object.
    parseArrays: false,
    arrayLimit: QUERY_STRING_ARRAY_LIMIT,
  }) as Record<string, unknown>;
}

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
