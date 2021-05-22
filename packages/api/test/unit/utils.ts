import fastify, {ServerOptions} from "fastify";
import {fetch} from "cross-fetch";
import querystring from "querystring";
import {
  getGenericServer,
  getFastifySchema,
  RouteGeneric,
  ReqGeneric,
  RoutesData,
  RouteReqSerdes,
  ReturnTypes,
  FetchFn,
  FetchOpts,
} from "../../src/utils";

export function getTestServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  routesData: RoutesData<Api>,
  reqSerdes: RouteReqSerdes<Api, ReqTypes>,
  returnTypes: ReturnTypes<Api>,
  api: Api
): {baseUrl: string} {
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

  const sampleServer = getGenericServer<Api, ReqTypes>(routesData, reqSerdes, returnTypes, api);

  // Register all route
  for (const [key, routeData] of Object.entries(routesData)) {
    const routeId = key as keyof Api;
    const schema = reqSerdes[routeId].schema;

    server.route({
      url: routeData.url,
      method: routeData.method,
      handler: async (req) => (await sampleServer[routeId](req)) || {},
      schema: schema && getFastifySchema(schema),
    });
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
