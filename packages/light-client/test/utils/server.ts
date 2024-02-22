import {parse as parseQueryString} from "qs";
import {FastifyInstance, fastify} from "fastify";
import {fastifyCors} from "@fastify/cors";
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
    querystringParser: (str) => parseQueryString(str, {comma: true, parseArrays: false}),
  });

  registerRoutes(server, config, api, ["lightclient", "proof", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen({port: opts.port, host: opts.host});
  return server;
}
