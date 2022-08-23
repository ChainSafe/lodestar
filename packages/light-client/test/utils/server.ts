import querystring from "querystring";
import fastify, {FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import {Api} from "@lodestar/api";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {IChainForkConfig} from "@lodestar/config";

export type ServerOpts = {
  port: number;
  host: string;
};

export async function startServer(opts: ServerOpts, config: IChainForkConfig, api: Api): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse,
  });

  registerRoutes(server, config, api, ["lightclient", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen(opts.port, opts.host);
  return server;
}
