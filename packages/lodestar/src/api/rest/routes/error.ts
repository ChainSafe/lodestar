import {FastifyError, FastifyReply, FastifyRequest} from "fastify";
import {ServerResponse} from "http";
import {ApiError} from "../../impl/errors";

export function errorHandler(e: Error, req: FastifyRequest, resp: FastifyReply<ServerResponse>): void {
  if ((e as FastifyError).validation) {
    req.log.warn(`Request ${req.id} failed validation. Reason: ${e.message}`);
    resp.status(400).send((e as FastifyError).validation);
    return;
  }
  const statusCode = e instanceof ApiError ? (e as ApiError).statusCode : 500;
  req.log.error(`Request ${req.id} failed with unexpected error: `, e.message, e.stack);
  resp.status(statusCode).send(e);
}
