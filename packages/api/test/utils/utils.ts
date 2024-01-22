import {beforeAll, afterAll, MockedObject, vi} from "vitest";
import qs from "qs";
import fastify, {FastifyInstance} from "fastify";
import {mapValues} from "@lodestar/utils";
import {ServerApi} from "../../src/interfaces.js";

export function getTestServer(): {baseUrl: string; server: FastifyInstance} {
  const port = Math.floor(Math.random() * (65535 - 49152)) + 49152;
  const baseUrl = `http://localhost:${port}`;

  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: (str) => qs.parse(str, {comma: true, parseArrays: false}),
  });

  server.addHook("onError", (request, reply, error, done) => {
    // eslint-disable-next-line no-console
    console.log(`onError: ${error.toString()}`);
    done();
  });

  beforeAll(async () => {
    await new Promise((resolve, reject) => {
      server.listen({port}, function (err, address) {
        if (err !== null && err != undefined) {
          reject(err);
        } else {
          resolve(address);
        }
      });
    });
  });

  afterAll(async () => {
    await server.close();
  });

  return {baseUrl, server};
}

/** Type helper to get a Sinon mock object type with Api */
export function getMockApi<Api extends Record<string, any>>(
  routeIds: Record<string, any>
): MockedObject<ServerApi<Api>> & ServerApi<Api> {
  return mapValues(routeIds, () => vi.fn()) as MockedObject<ServerApi<Api>> & ServerApi<Api>;
}
