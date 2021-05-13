import {
  DefaultBody,
  DefaultHeaders,
  DefaultParams,
  DefaultQuery,
  HTTPMethod,
  RequestHandler,
  RouteShorthandOptions,
} from "fastify";
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {Stream} from "stream";
import {FastifyRequest} from "fastify";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {ServerOptions} from "fastify";
import fastifyCors from "fastify-cors";
import querystring from "querystring";
import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClientUpdater} from "../src/server/LightClientUpdater";
import {TreeBacked} from "@chainsafe/ssz";
import {altair} from "@chainsafe/lodestar-types";

const maxPeriodsPerRequest = 128;

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<TreeBacked<altair.BeaconState>>;
};

export type ServerOpts = {
  port: number;
  host: string;
};

export type ServerModules = {
  config: IBeaconConfig;
  lightClientUpdater: LightClientUpdater;
  logger: ILogger;
  stateRegen: IStateRegen;
};

export type ApiController<
  Query = DefaultQuery,
  Params = DefaultParams,
  Body = DefaultBody,
  Headers = DefaultHeaders
> = {
  url: string;
  method: HTTPMethod;
  handler: RequestHandler<IncomingMessage, ServerResponse, Query, Params, Headers, Body>;
  schema?: RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query, Params, Headers, Body>["schema"];
};

export async function startLightclientApiServer(
  opts: ServerOpts,
  modules: ServerModules
): Promise<fastify.FastifyInstance> {
  const server = fastify({
    logger: new FastifyLogger(modules.logger),
    ajv: {
      customOptions: {
        coerceTypes: "array",
      },
    },
    querystringParser: querystring.parse as ServerOptions["querystringParser"],
  });

  server.register(fastifyCors as any, {origin: "*"});
  registerRoutes(server, modules);
  await server.listen(opts.port, opts.host);
  return server;
}

function registerRoutes(server: fastify.FastifyInstance, modules: ServerModules): void {
  const {config, lightClientUpdater, stateRegen} = modules;

  const createProof: ApiController<null, {stateId: string}, {paths: (string | number)[][]}> = {
    url: "/proof/:stateId",
    method: "POST",

    handler: async function (req, resp) {
      const state = await stateRegen.getStateByRoot(req.params.stateId);
      // the body isn't already JSON parsed
      const body = JSON.parse((req.body as unknown) as string) as {paths: (string | number)[][]};
      const tree = config.types.altair.BeaconState.createTreeBackedFromStruct(state);
      const proof = tree.createProof(body.paths);
      const serialized = serializeProof(proof);
      return resp.status(200).header("Content-Type", "application/octet-stream").send(Buffer.from(serialized));
    },
  };

  const getBestUpdates: ApiController<null, {periods: string}> = {
    url: "/best_updates/:periods",
    method: "GET",

    handler: async function (req) {
      const periods = parsePeriods(req.params.periods);
      if (periods.length > maxPeriodsPerRequest) {
        throw Error("Too many periods requested");
      }
      const items = await lightClientUpdater.getBestUpdates(periods);
      return {
        data: items.map((item) => config.types.altair.LightClientUpdate.toJson(item, {case: "snake"})),
      };
    },
  };

  const getLatestUpdateFinalized: ApiController = {
    url: "/latest_update_finalized/",
    method: "GET",

    handler: async function () {
      const data = await lightClientUpdater.getLatestUpdateFinalized();
      if (!data) throw Error("No update available");
      return {
        data: config.types.altair.LightClientUpdate.toJson(data, {case: "snake"}),
      };
    },
  };

  const getLatestUpdateNonFinalized: ApiController = {
    url: "/latest_update_nonfinalized/",
    method: "GET",

    handler: async function () {
      const data = await lightClientUpdater.getLatestUpdateNonFinalized();
      if (!data) throw Error("No update available");
      return {
        data: config.types.altair.LightClientUpdate.toJson(data, {case: "snake"}),
      };
    },
  };

  const routes: ApiController<any, any>[] = [
    createProof,
    getBestUpdates,
    getLatestUpdateFinalized,
    getLatestUpdateNonFinalized,
  ];

  server.register(
    async function (fastify) {
      for (const route of routes) {
        fastify.route({
          url: route.url,
          method: route.method,
          handler: route.handler,
          schema: route.schema,
        });
      }
    },
    {prefix: "/eth/v1/lightclient"}
  );
}

/**
 * periods = 1 or = 1..4
 */
function parsePeriods(periodsArg: string): number[] {
  if (periodsArg.includes("..")) {
    const [fromStr, toStr] = periodsArg.split("..");
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    const periods: number[] = [];
    for (let i = from; i <= to; i++) periods.push(i);
    return periods;
  } else {
    const period = parseInt(periodsArg, 10);
    return [period];
  }
}

/**
 * Logs REST API request/response messages.
 */
export class FastifyLogger {
  readonly stream: Stream;

  readonly serializers = {
    req: (req: IncomingMessage & FastifyRequest): {msg: string} => {
      const url = req.url ? req.url.split("?")[0] : "-";
      return {msg: `Req ${req.id} ${req.ip} ${req.method}:${url}`};
    },
  };

  private log: ILogger;

  constructor(logger: ILogger) {
    this.log = logger;
    this.stream = ({
      write: this.handle,
    } as unknown) as Stream;
  }

  private handle = (chunk: string): void => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const log = JSON.parse(chunk);
    if (log.req) {
      this.log.debug(log.req.msg);
    } else if (log.res) {
      this.log.debug(`Res ${log.reqId} - ${log.res.statusCode} ${log.responseTime}`);
    }

    if (log.err) {
      if (log.level >= 50) {
        this.log.error(`Request ${log.reqId} status ${log.res.statusCode}`, {}, log.err);
      } else {
        this.log.warn(`Request ${log.reqId} status ${log.res.statusCode}`, {}, log.err);
      }
    }
  };
}
