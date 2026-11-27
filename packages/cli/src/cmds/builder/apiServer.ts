import {Endpoint} from "@lodestar/api";
import {BuilderApiMethods, getRoutes} from "@lodestar/api/builder/server";
import {FastifyRoute} from "@lodestar/api/server";
import {RestApiServer, RestApiServerModules, RestApiServerOpts} from "@lodestar/beacon-node";
import {BuilderApi} from "@lodestar/builder";
import {ChainForkConfig} from "@lodestar/config";

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
};

export class BuilderRestApiServer extends RestApiServer {
  constructor(optsArg: Partial<RestApiServerOpts>, modules: BuilderRestApiServerModules) {
    const opts = {
      ...builderRestApiServerOptsDefault,
      // optsArg is a Partial type, any of its properties can be undefined
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };

    super(opts, modules);

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
        // Time the request took to arrive, based on the send time reported by the caller
        transitMs: Number.isFinite(dateMs) ? Math.round(Date.now() - res.elapsedTime - dateMs) : undefined,
        durationMs: Math.round(res.elapsedTime),
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
