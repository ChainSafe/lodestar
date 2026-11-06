import type {FastifyInstance} from "fastify";
import {AnyEndpoint} from "../../utils/codecs.js";
import {HttpHeader, MediaType} from "../../utils/headers.js";
import {
  ApplicationMethods,
  FastifyHandler,
  FastifyRoute,
  FastifyRoutes,
  createFastifyRoutes,
} from "../../utils/server/index.js";
import {Endpoints, getDefinitions} from "../routes.js";

export type SignerApiMethods = ApplicationMethods<Endpoints>;

export function getRoutes(methods: SignerApiMethods): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(), methods);
}

export function registerRoutes(server: FastifyInstance, methods: SignerApiMethods): void {
  const routes = getRoutes(methods);

  server.route(routes.upcheck as FastifyRoute<AnyEndpoint>);
  server.route(routes.listPublicKeys as FastifyRoute<AnyEndpoint>);
  server.route({...routes.sign, handler: withPlainTextSignature(routes.sign.handler)} as FastifyRoute<AnyEndpoint>);
}

const MEDIA_TYPE_TEXT = "text/plain";

/**
 * The remote signing API allows clients to request the signature as plain text instead of JSON
 */
function withPlainTextSignature(handler: FastifyHandler<Endpoints["sign"]>): FastifyHandler<Endpoints["sign"]> {
  return async function signHandler(this: FastifyInstance, req, reply) {
    if (!prefersPlainText(req.headers.accept)) {
      return handler.call(this, req, reply);
    }

    req.headers.accept = MediaType.json;
    const {signature} = (await handler.call(this, req, reply)) as {signature: string};
    void reply.header(HttpHeader.ContentType, MEDIA_TYPE_TEXT);
    return signature;
  };
}

/**
 * Mirrors Web3Signer, any accept header entry compatible with JSON results in a JSON response
 */
function prefersPlainText(accept?: string): boolean {
  if (!accept) {
    return false;
  }

  const mediaTypes = accept
    .toLowerCase()
    .split(",")
    .map((entry) => entry.split(";", 1)[0].trim());

  return !mediaTypes.includes(MediaType.json) && !mediaTypes.includes("*/*") && mediaTypes.includes(MEDIA_TYPE_TEXT);
}
