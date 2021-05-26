import fastify, {FastifyInstance} from "fastify";
import {fetch} from "cross-fetch";
import querystring from "querystring";
import qs from "qs";
import {FetchFn, FetchOpts} from "../../src/client/utils";
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
        if (err) reject(err);
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

export function getFetchFn(baseUrl: string): FetchFn {
  async function getRes(opts: FetchOpts): Promise<Response> {
    const url = urlJoin(baseUrl, opts.url) + (opts.query ? "?" + stringifyQuery(opts.query) : "");
    const bodyArgs = opts.body ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(opts.body)} : {};

    const res = await fetch(url, {method: opts.method, ...bodyArgs});

    if (!res.ok) {
      const errBody = await res.text();
      throw Error(`${res.statusText}: ${errBody}`);
    }

    return res;
  }

  return {
    async json<T>(opts: FetchOpts): Promise<T> {
      const res = await getRes(opts);
      return (await res.json()) as T;
    },

    async arrayBuffer(opts: FetchOpts): Promise<ArrayBuffer> {
      const res = await getRes(opts);
      return await res.arrayBuffer();
    },
  };
}

/**
 * Eth2.0 API requires the query with format:
 * - arrayFormat: repeat `topic=topic1&topic=topic2`
 */
export function stringifyQuery(query: unknown): string {
  return qs.stringify(query, {arrayFormat: "repeat"});
}

export function urlJoin(...args: string[]): string {
  return (
    args
      .join("/")
      .replace(/([^:]\/)\/+/g, "$1")
      // Remove duplicate slashes in the front
      .replace(/^(\/)+/, "/")
  );
}
