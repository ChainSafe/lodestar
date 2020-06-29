import {FastifyError, FastifyReply, FastifyRequest} from "fastify";
import {ServerResponse} from "http";

export function errorHandler(e: FastifyError, req: FastifyRequest, resp: FastifyReply<ServerResponse>): void {
  if(e.validation) {
    req.log.warn(`Request ${req.id} failed validation. Reason: ${e.message}`);
    resp.status(400).send(e.validation);
    return;
  }
  req.log.error(`Request ${req.id} failed with unexpected error: `, e.message, e.stack);
  resp.status(500).send(e);
}
