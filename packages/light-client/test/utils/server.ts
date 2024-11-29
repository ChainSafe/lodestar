import {fastifyCors} from "@fastify/cors";
import {Endpoints} from "@lodestar/api";
import {BeaconApiMethods, registerRoutes} from "@lodestar/api/beacon/server";
import {ApplicationMethods, addSszContentTypeParser} from "@lodestar/api/server";
import {ChainForkConfig} from "@lodestar/config";
import {FastifyInstance, fastify} from "fastify";
import {parse as parseQueryString} from "qs";

export type ServerOpts = {
  port: number;
  host: string;
};

type LightClientEndpoints = Pick<Endpoints, "lightclient" | "proof" | "events">;

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

  registerRoutes(server, config, methods as BeaconApiMethods, ["lightclient", "proof", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen({port: opts.port, host: opts.host});
  return server;
}
