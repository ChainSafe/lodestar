import qs from "qs";
import fastify, {FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
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
    querystringParser: (str) => qs.parse(str, {comma: true}),
  });

  registerRoutes(server, config, api, ["lightclient", "proof", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen(opts.port, opts.host);
  return server;
}
