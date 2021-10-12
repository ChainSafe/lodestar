import fastify, {FastifyInstance} from "fastify";
import querystring from "querystring";
import {mapValues} from "@chainsafe/lodestar-utils";
import Sinon from "sinon";

export function getTestServer(): {baseUrl: string; server: FastifyInstance} {
  const port = Math.floor(Math.random() * (65535 - 49152)) + 49152;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse,
  });

  server.addHook("onError", (request, reply, error, done) => {
    // eslint-disable-next-line no-console
    console.log(error);
    done();
  });

  before("start server", async () => {
    await new Promise((resolve, reject) => {
      server.listen(port, function (err, address) {
        if (err !== null && err != undefined) reject(err);
        else resolve(address);
      });
    });
  });

  after("stop server", async () => {
    await server.close();
  });

  return {baseUrl, server};
}

/** Type helper to get a Sinon mock object type with Api */
export function getMockApi<Api extends Record<string, any>>(
  routeKeys: Record<string, any>
): Sinon.SinonStubbedInstance<Api> & Api {
  return mapValues(routeKeys, () => Sinon.stub()) as Sinon.SinonStubbedInstance<Api> & Api;
}
