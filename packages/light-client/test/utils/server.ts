import qs from "qs";
import fastify, {FastifyInstance} from "fastify";
import fastifyCors from "@fastify/cors";
import {Api, ServerApi} from "@lodestar/api";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {ChainForkConfig} from "@lodestar/config";

export type ServerOpts = {
  port: number;
  host: string;
};

export async function startServer(
  opts: ServerOpts,
  config: ChainForkConfig,
  api: {[K in keyof Api]: ServerApi<Api[K]>}
): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: (str) =>
      qs.parse(str, {
        // Array as comma-separated values must be supported to be OpenAPI spec compliant
        decoder: (str, defaultDecoder, charset, type) => {
          if (type === "key") {
            return defaultDecoder(str, defaultDecoder, charset);
          } else if (type === "value") {
            return decodeURIComponent(str).split(",");
          } else throw new Error(`Unexpected type: ${type}`);
        },
      }),
  });

  registerRoutes(server, config, api, ["lightclient", "proof", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen({port: opts.port, host: opts.host});
  return server;
}
