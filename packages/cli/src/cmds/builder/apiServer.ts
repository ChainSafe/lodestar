import {FastifyPluginAsync} from "fastify";
import {Endpoint} from "@lodestar/api";
import {BuilderApiMethods, getRoutes} from "@lodestar/api/builder/server";
import {ApiError, FastifyRoute, canSendResponse} from "@lodestar/api/server";
import {RestApiServer, RestApiServerModules, RestApiServerOpts} from "@lodestar/beacon-node";
import {BuilderApi, BuilderBidStreamApi, type OrderExposure} from "@lodestar/builder";
import {ChainForkConfig} from "@lodestar/config";
import {registerBidStream} from "./bidStream.js";
import {registerOrderExposure} from "./orderExposure.js";

export const builderRestApiServerOptsDefault: RestApiServerOpts = {
  address: "127.0.0.1",
  port: 18550,
  // Signed beacon blocks are the largest request body
  bodyLimit: 10 * 1024 * 1024, // 10MB
  stacktraces: false,
};

const USER_AGENT_HEADER = "user-agent";
const CF_CONNECTING_IP_HEADER = "cf-connecting-ip";
const FORWARDED_FOR_HEADER = "x-forwarded-for";
const DATE_MILLISECONDS_HEADER = "date-milliseconds";
const TIMEOUT_MS_HEADER = "x-timeout-ms";

export type BuilderRestApiServerModules = RestApiServerModules & {
  config: ChainForkConfig;
  api: BuilderApi;
  getBidStreamApi?: () => BuilderBidStreamApi | null;
  getOrderExposure?: () => OrderExposure | null;
};

/**
 * Builder API that can be served before the builder is initialized. Until then the builder is reported
 * as healthy, has no bids and does not accept requests it would have to validate.
 */
export function getBuilderApiBeforeInit(config: ChainForkConfig, getBuilderApi: () => BuilderApi | null): BuilderApi {
  return {
    async status(args, context) {
      return getBuilderApi()?.status(args, context);
    },

    async getExecutionPayloadBid(args, context) {
      return (
        getBuilderApi()?.getExecutionPayloadBid(args, context) ?? {
          data: undefined,
          meta: {version: config.getForkName(args.slot)},
          status: 204,
        }
      );
    },

    async submitSignedBeaconBlock(args, context) {
      const builderApi = getBuilderApi();
      if (builderApi === null) {
        throw new ApiError(503, "Builder is not ready");
      }
      return builderApi.submitSignedBeaconBlock(args, context);
    },

    async submitBuilderPreferences(args, context) {
      const builderApi = getBuilderApi();
      if (builderApi === null) {
        throw new ApiError(503, "Builder is not ready");
      }
      return builderApi.submitBuilderPreferences(args, context);
    },
  };
}

export type BuilderRestApiServerOpts = RestApiServerOpts & {
  bidStream?: boolean;
  bidStreamAdaptiveTiming?: boolean;
  orderExposureTokenFile?: string;
};

export class BuilderRestApiServer extends RestApiServer {
  constructor(optsArg: Partial<BuilderRestApiServerOpts>, modules: BuilderRestApiServerModules) {
    const opts: BuilderRestApiServerOpts = {
      ...builderRestApiServerOptsDefault,
      // optsArg is a Partial type, any of its properties can be undefined
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
      bidStreamAdaptiveTiming: optsArg.bidStreamAdaptiveTiming === true,
    };
    if (opts.bidStreamAdaptiveTiming && !opts.bidStream) {
      throw Error("bidStreamAdaptiveTiming requires bidStream");
    }

    super(opts, modules);

    const arrivals = new WeakMap<object, {unixMs: number; monotonicMs: number}>();

    // Bid eligibility is short-lived. Intermediaries must never replay an
    // earlier response after the constructor has fenced its order generation.
    this.server.addHook("onRequest", async (req, res) => {
      arrivals.set(req, {unixMs: Date.now(), monotonicMs: performance.now()});
      res.header("Cache-Control", "no-store");
    });
    this.server.addHook("onSend", (_req, res, payload, done) => {
      if (!canSendResponse(res)) {
        res.code(204);
        res.removeHeader("Content-Length");
        done(null, null);
      } else done(null, payload);
    });

    if (opts.bidStream) {
      // Upgrade sockets no longer have Node's HTTP timeouts. Successful streams
      // hijack the response; every ordinary or rejected route must close its socket.
      this.server.addHook("onResponse", async (request) => {
        if (request.headers.upgrade !== undefined) request.raw.socket.destroy();
      });
      const bidStreamPlugin: FastifyPluginAsync = async (server) => {
        await registerBidStream(
          server,
          modules.getBidStreamApi ?? (() => null),
          this.logger,
          modules.config.SLOT_DURATION_MS,
          opts.bidStreamAdaptiveTiming
        );
      };
      void this.server.register(bidStreamPlugin);
    }

    if (opts.orderExposureTokenFile)
      registerOrderExposure(this.server, opts.orderExposureTokenFile, modules.getOrderExposure ?? (() => null));

    // Only the routes implemented by the builder are registered, routes of earlier forks are not served
    const routes = getRoutes(modules.config, modules.api as BuilderApiMethods);
    for (const operationId of Object.keys(modules.api) as (keyof BuilderApi)[]) {
      this.server.route(routes[operationId] as FastifyRoute<Endpoint>);
    }

    // Requests of proposers are logged with the details of the caller, the builder itself only sees their content
    this.server.addHook("onResponse", async (req, res) => {
      const {operationId} = (req.routeOptions.schema ?? {}) as {operationId?: string};
      // Requests to unknown routes are logged by the not found handler
      if (operationId === undefined) {
        return;
      }

      const {slot, proposer_pubkey: proposer} = (req.params ?? {}) as {slot?: number; proposer_pubkey?: string};
      const dateMs = Number(req.headers[DATE_MILLISECONDS_HEADER]);
      const timeoutMs = Number(req.headers[TIMEOUT_MS_HEADER]);
      const arrival = arrivals.get(req);
      const durationMs = arrival ? performance.now() - arrival.monotonicMs : res.elapsedTime;
      const requestAgeMs = arrival && Number.isFinite(dateMs) ? arrival.unixMs - dateMs : undefined;
      // Routes without path params or timing headers only log the fields they have
      const logCtx = removeUndefined({
        operationId,
        status: res.statusCode,
        slot,
        proposer,
        userAgent: req.headers[USER_AGENT_HEADER],
        // The proxies in front of the builder API pass on the address of the caller
        ip: firstHeaderValue(req.headers[CF_CONNECTING_IP_HEADER] ?? req.headers[FORWARDED_FOR_HEADER]) ?? req.ip,
        timeoutMs: firstHeaderValue(req.headers[TIMEOUT_MS_HEADER]),
        // This cross-clock age includes connection setup, queues and clock offset. Edge headers do not replace it.
        transitMs: requestAgeMs,
        requestAgeMs,
        // Remaining client budget at the origin's response completion, before the unmeasured return path.
        responseDeadlineRemainingMs:
          requestAgeMs !== undefined && Number.isFinite(timeoutMs)
            ? Math.round(timeoutMs - requestAgeMs - durationMs)
            : undefined,
        durationMs: Math.round(durationMs),
      });

      if (operationId === "getExecutionPayloadBid" || operationId === "submitSignedBeaconBlock") {
        this.logger.info("Builder API request", logCtx);
      } else {
        this.logger.debug("Builder API request", logCtx);
      }
    });
  }

  /** Unlike the other REST API servers, the builder API is meant to be reachable by untrusted proposers */
  async listen(): Promise<void> {
    try {
      await this.server.listen({port: this.opts.port, host: this.opts.address});
      const {address, port} = this.server.addresses()[0];
      this.logger.info("Started builder API server", {address: `http://${address}:${port}`});
    } catch (e) {
      this.logger.error("Error starting builder API server", this.opts, e as Error);
      throw e;
    }
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(",")[0].trim();
}

function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, value]) => value !== undefined)) as Partial<T>;
}
