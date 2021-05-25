import fastify, {ServerOptions} from "fastify";
import {fetch} from "cross-fetch";
import querystring from "querystring";
import Sinon from "sinon";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  getGenericServer,
  RouteGeneric,
  ReqGeneric,
  RoutesData,
  RouteReqSerdes,
  ReturnTypes,
  FetchFn,
  FetchOpts,
  Resolves,
  RouteGroupDefinition,
  getGenericClient,
} from "../../src/utils";

type IgnoreVoid<T> = T extends void ? undefined : T;

export function getTestServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(routesGroupDef: RouteGroupDefinition<Api, ReqTypes>, config: IBeaconConfig, api: Api): {baseUrl: string} {
  const port = 10101;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse as ServerOptions["querystringParser"],
  });

  server.addHook("onError", (request, reply, error, done) => {
    // eslint-disable-next-line no-console
    console.log(error);
    done();
  });

  const genericServer = getGenericServer<Api, ReqTypes>(routesGroupDef, config, api);

  // Register all routes
  for (const serverRoute of Object.values(genericServer)) {
    server.route(serverRoute);
  }

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

  return {baseUrl};
}

export function getFetchFn(baseUrl: string): FetchFn {
  return async function <T>(opts: FetchOpts): Promise<T> {
    const url = baseUrl + (opts.query ? opts.url + "?" + querystring.encode(opts.query as any) : opts.url);
    const bodyArgs = opts.body ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(opts.body)} : {};

    const res = await fetch(url, {method: opts.method, ...bodyArgs});
    if (!res.ok) throw Error(res.statusText);
    return (await res.json()) as T;
  };
}
