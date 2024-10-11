import {parse as parseQueryString} from "qs";
import {FastifyInstance, FastifyRequest, fastify, errorCodes} from "fastify";
import {fastifyCors} from "@fastify/cors";
import bearerAuthPlugin from "@fastify/bearer-auth";
import {addSszContentTypeParser} from "@lodestar/api/server";
import {ErrorAborted, Gauge, Histogram, Logger} from "@lodestar/utils";
import {isLocalhostIP} from "../../util/ip.js";
import {ApiError, FailureList, IndexedError, NodeIsSyncing} from "../impl/errors.js";
import {HttpActiveSocketsTracker, SocketMetrics} from "./activeSockets.js";

export type RestApiServerOpts = {
  port: number;
  cors?: string;
  address?: string;
  bearerToken?: string;
  headerLimit?: number;
  bodyLimit?: number;
  stacktraces?: boolean;
  swaggerUI?: boolean;
};

export type RestApiServerModules = {
  logger: Logger;
  metrics: RestApiServerMetrics | null;
};

export type RestApiServerMetrics = SocketMetrics & {
  requests: Gauge<{operationId: string}>;
  responseTime: Histogram<{operationId: string}>;
  errors: Gauge<{operationId: string}>;
};

/**
 * Error response body format as defined in beacon-api spec
 *
 * See https://github.com/ethereum/beacon-APIs/blob/v2.5.0/types/http.yaml
 */
type ErrorResponse = {
  code: number;
  message: string;
  stacktraces?: string[];
};

type IndexedErrorResponse = ErrorResponse & {
  failures?: FailureList;
};

/**
 * Error code used by Fastify if media type is not supported (415)
 */
const INVALID_MEDIA_TYPE_CODE = errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE().code;

/**
 * Error code used by Fastify if JSON schema validation failed
 */
const SCHEMA_VALIDATION_ERROR_CODE = errorCodes.FST_ERR_VALIDATION().code;

/**
 * REST API powered by `fastify` server.
 */
export class RestApiServer {
  protected readonly server: FastifyInstance;
  protected readonly logger: Logger;
  private readonly activeSockets: HttpActiveSocketsTracker;

  constructor(
    protected readonly opts: RestApiServerOpts,
    modules: RestApiServerModules
  ) {
    // Apply opts defaults
    const {logger, metrics} = modules;

    const server = fastify({
      logger: false,
      ajv: {customOptions: {coerceTypes: "array"}},
      querystringParser: (str) =>
        parseQueryString(str, {
          // Array as comma-separated values must be supported to be OpenAPI spec compliant
          comma: true,
          // Drop support for array query strings like `id[0]=1&id[1]=2&id[2]=3` as those are not required to
          // be OpenAPI spec compliant and results are inconsistent, see https://github.com/ljharb/qs/issues/331.
          // The schema validation will catch this and throw an error as parsed query string results in an object.
          parseArrays: false,
        }),
      bodyLimit: opts.bodyLimit,
      http: {maxHeaderSize: opts.headerLimit},
    });

    addSszContentTypeParser(server);

    this.activeSockets = new HttpActiveSocketsTracker(server.server, metrics);

    // To parse our ApiError -> statusCode
    server.setErrorHandler((err, _req, res) => {
      const stacktraces = opts.stacktraces ? err.stack?.split("\n") : undefined;
      if (err.validation) {
        const {instancePath, message} = err.validation[0];
        const payload: ErrorResponse = {
          code: 400,
          message: `${instancePath.substring(instancePath.lastIndexOf("/") + 1)} ${message}`,
          stacktraces,
        };
        void res.status(400).send(payload);
      } else if (err instanceof IndexedError) {
        const payload: IndexedErrorResponse = {
          code: err.statusCode,
          message: err.message,
          failures: err.failures,
          stacktraces,
        };
        void res.status(err.statusCode).send(payload);
      } else {
        // Convert our custom ApiError into status code
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        const payload: ErrorResponse = {code: statusCode, message: err.message, stacktraces};
        void res.status(statusCode).send(payload);
      }
    });

    server.setNotFoundHandler((req, res) => {
      const message = `Route ${req.raw.method}:${req.raw.url} not found`;
      this.logger.warn(message);
      const payload: ErrorResponse = {code: 404, message};
      void res.code(404).send(payload);
    });

    if (opts.cors) {
      void server.register(fastifyCors, {origin: opts.cors});
    }

    if (opts.bearerToken) {
      void server.register(bearerAuthPlugin, {keys: new Set([opts.bearerToken])});
    }

    // Log all incoming request to debug (before parsing). TODO: Should we hook latter in the lifecycle? https://www.fastify.io/docs/latest/Lifecycle/
    // Note: Must be an async method so fastify can continue the release lifecycle. Otherwise we must call done() or the request stalls
    server.addHook("onRequest", async (req, _res) => {
      const operationId = getOperationId(req);
      this.logger.debug(`Req ${req.id} ${req.ip} ${operationId}`);
      metrics?.requests.inc({operationId});

      // Workaround to fix compatibility with go-eth2-client
      // See https://github.com/attestantio/go-eth2-client/issues/144
      if (
        // go-eth2-client supports handling SSZ data in response for these endpoints
        !["produceBlindedBlock", "produceBlockV3", "getBlockV2", "getStateV2"].includes(operationId) &&
        // Only Vouch seems to override default header
        ["go-eth2-client", "Go-http-client", "Vouch"].includes(req.headers["user-agent"]?.split("/")[0] ?? "")
      ) {
        // Override Accept header to force server to return JSON
        req.headers.accept = "application/json";
      }
    });

    server.addHook("preHandler", async (req, _res) => {
      const operationId = getOperationId(req);
      this.logger.debug(`Exec ${req.id} ${req.ip} ${operationId}`);
    });

    // Log after response
    server.addHook("onResponse", async (req, res) => {
      const operationId = getOperationId(req);
      this.logger.debug(`Res ${req.id} ${operationId} - ${res.raw.statusCode}`);
      metrics?.responseTime.observe({operationId}, res.elapsedTime / 1000);
    });

    server.addHook("onError", async (req, _res, err) => {
      // Don't log ErrorAborted errors, they happen on node shutdown and are not useful
      // Don't log NodeISSyncing errors, they happen very frequently while syncing and the validator polls duties
      if (err instanceof ErrorAborted || err instanceof NodeIsSyncing) return;

      const operationId = getOperationId(req);

      if (err instanceof ApiError || [INVALID_MEDIA_TYPE_CODE, SCHEMA_VALIDATION_ERROR_CODE].includes(err.code)) {
        this.logger.warn(`Req ${req.id} ${operationId} failed`, {reason: err.message});
      } else {
        this.logger.error(`Req ${req.id} ${operationId} error`, {}, err);
      }
      metrics?.errors.inc({operationId});
    });

    this.server = server;
    this.logger = logger;
  }

  /**
   * Start the REST API server.
   */
  async listen(): Promise<void> {
    try {
      const host = this.opts.address;
      const address = await this.server.listen({port: this.opts.port, host});
      this.logger.info("Started REST API server", {address});
      if (!host || !isLocalhostIP(host)) {
        this.logger.warn("REST API server is exposed, ensure untrusted traffic cannot reach this API");
      }
    } catch (e) {
      this.logger.error("Error starting REST api server", this.opts, e as Error);
      throw e;
    }
  }

  /**
   * Close the server instance and terminate all existing connections.
   */
  async close(): Promise<void> {
    // In NodeJS land calling close() only causes new connections to be rejected.
    // Existing connections can prevent .close() from resolving for potentially forever.
    // In Lodestar case when the BeaconNode wants to close we will attempt to gracefully
    // close all existing connections but forcefully terminate after timeout for a fast shutdown.
    // Inspired by https://github.com/gajus/http-terminator/
    await this.activeSockets.terminate();

    await this.server.close();

    this.logger.debug("REST API server closed");
  }

  /** For child classes to override */
  protected shouldIgnoreError(_err: Error): boolean {
    return false;
  }
}

function getOperationId(req: FastifyRequest): string {
  return req.routeOptions.schema?.operationId ?? "unknown";
}
