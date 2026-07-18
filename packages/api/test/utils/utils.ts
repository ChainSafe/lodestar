import {FastifyInstance, fastify} from "fastify";
import {MockedObject, vi} from "vitest";
import {mapValues} from "@lodestar/utils";
import {Endpoint} from "../../src/utils/index.js";
import {ApplicationMethods, addSszContentTypeParser, parseRestQueryString} from "../../src/utils/server/index.js";

export function getTestServer(): {server: FastifyInstance; start: () => Promise<string>} {
  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    routerOptions: {
      querystringParser: parseRestQueryString,
    },
  });

  addSszContentTypeParser(server);

  server.addHook("onError", (_request, _reply, error, done) => {
    console.log(`onError: ${error.toString()}`);
    done();
  });

  const start = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      server.listen({port: 0}, (err, address) => {
        if (err != null) {
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
