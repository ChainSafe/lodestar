import {MockedObject, vi} from "vitest";
import {parse as parseQueryString} from "qs";
import {FastifyInstance, fastify} from "fastify";
import {mapValues} from "@lodestar/utils";
import {Endpoint} from "../../src/utils/index.js";
import {ApplicationMethods, addSszContentTypeParser} from "../../src/utils/server/index.js";

export function getTestServer(): {server: FastifyInstance; start: () => Promise<string>} {
  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: (str) => parseQueryString(str, {comma: true, parseArrays: false}),
  });

  addSszContentTypeParser(server);

  server.addHook("onError", (_request, _reply, error, done) => {
    console.log(`onError: ${error.toString()}`);
    done();
  });

  const start = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      server.listen({port: 0}, function (err, address) {
        if (err !== null && err !== undefined) {
          reject(err);
        } else {
          resolve(address);
        }
      });
    });

  return {start, server};
}

export function getMockApi<Es extends Record<string, Endpoint>>(
  routeIds: Record<string, any>
): MockedObject<ApplicationMethods<Es>> & ApplicationMethods<Es> {
  return mapValues(routeIds, () => vi.fn()) as MockedObject<ApplicationMethods<Es>> & ApplicationMethods<Es>;
}
