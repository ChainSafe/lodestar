import {MockedObject, vi} from "vitest";
import {parse as parseQueryString} from "qs";
import {FastifyInstance, fastify} from "fastify";
import {mapValues} from "@lodestar/utils";
import {ServerApi} from "../../src/interfaces.js";

export function getTestServer(): {server: FastifyInstance; start: () => Promise<string>} {
  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: (str) => parseQueryString(str, {comma: true, parseArrays: false}),
  });

  server.addHook("onError", (request, reply, error, done) => {
    // eslint-disable-next-line no-console
    console.log(`onError: ${error.toString()}`);
    done();
  });

  const start = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      server.listen({port: 0}, function (err, address) {
        if (err !== null && err != undefined) {
          reject(err);
        } else {
          resolve(address);
        }
      });
    });

  return {start, server};
}

export function getMockApi<Api extends Record<string, any>>(
  routeIds: Record<string, any>
): MockedObject<ServerApi<Api>> & ServerApi<Api> {
  return mapValues(routeIds, () => vi.fn()) as MockedObject<ServerApi<Api>> & ServerApi<Api>;
}
