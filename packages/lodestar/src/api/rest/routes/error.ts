import {FastifyError, FastifyReply, FastifyRequest} from "fastify";
import {ServerResponse} from "http";

export function errorHandler(e: FastifyError, req: FastifyRequest, resp: FastifyReply<ServerResponse>): void {
  if(e.validation) {
    resp.status(400).send(e.validation);
    return;
  }
  resp.status(500).send(e);
}
