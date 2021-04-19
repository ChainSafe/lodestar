import {FastifyError, FastifyReply, FastifyRequest} from "fastify";
import {ServerResponse} from "http";
import {ErrorAborted} from "@chainsafe/lodestar-utils";
import {ApiError} from "../impl/errors";

export function errorHandler(e: Error, req: FastifyRequest, resp: FastifyReply<ServerResponse>): void {
  if ((e as FastifyError).validation) {
    req.log.warn(`Request ${req.id} failed validation. Reason: ${e.message}`);
    resp.status(400).send((e as FastifyError).validation);
    return;
  }

  // Don't log ErrorAborted errors, they happen on node shutdown and are not usefull
  if (!(e instanceof ErrorAborted)) {
    const config = (resp.context.config || {}) as {url: string};
    req.log.error(`Request ${req.id} ${config.url} failed with unexpected error: `, e.stack || e.message);
  }

  const statusCode = e instanceof ApiError ? (e as ApiError).statusCode : 500;
  resp.status(statusCode).send(e);
}
