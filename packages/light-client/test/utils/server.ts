import {parse as parseQueryString} from "qs";
import {FastifyInstance, fastify} from "fastify";
import {fastifyCors} from "@fastify/cors";
import {ApplicationMethods, Endpoints, addSszContentTypeParser} from "@lodestar/api";
import {AllBeaconMethods, registerRoutes} from "@lodestar/api/beacon/server";
import {ChainForkConfig} from "@lodestar/config";

export type ServerOpts = {
  port: number;
  host: string;
};

export type LightClientEndpoints = Pick<Endpoints, "lightclient" | "proof" | "events">;

export async function startServer(
  opts: ServerOpts,
  config: ChainForkConfig,
  methods: {[K in keyof LightClientEndpoints]: ApplicationMethods<LightClientEndpoints[K]>}
): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: (str) => parseQueryString(str, {comma: true, parseArrays: false}),
  });

  addSszContentTypeParser(server);

  registerRoutes(server, config, methods as AllBeaconMethods, ["lightclient", "proof", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen({port: opts.port, host: opts.host});
  return server;
}
